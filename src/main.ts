import 'dotenv/config'
import { Between, In, MoreThanOrEqual } from 'typeorm'
import { Store } from '@subsquid/typeorm-store'
import { processor, db, EVENT_EMITTER_ADDRESS, EVENT_LOG1_TOPIC, EVENT_LOG2_TOPIC, REFERRAL_STORAGE_ADDRESS } from './processor'
import { decodeEventLog, DecodedEventData } from './decoding/eventDecoder'
import { handleOrderEvent, handlePositionEvent, handlePositionFeesEvent, PositionFeeData, EventContext } from './handlers/orders'
import { handlePositionAndAccountStats, handleDepositAccountStats, COMPETITION_PERIODS } from './handlers/accountStats'
import * as eventKeys from './decoding/eventKeys'
import { handlePriceFromPositionEvent, handlePriceFromOracleEvent, handlePlatformStatFromDeposit } from './handlers/analytics'
import { handleDistributionEvent } from './handlers/distributions'
import { handleReferralFromPositionFeesEvent, handleAffiliateRewardEvent } from './handlers/referrals'
import { handleReferralStorageLog } from './handlers/referralRegistrations'
import { handleMarketEvent, handleMarketCreated, handleConfigEvent } from './handlers/markets'
import { handleVolumeFromPositionEvent, handleFeesFromPositionFeesEvent, handleAprSnapshotFromFees, finalizeAprSnapshots } from './handlers/aggregates'
import { TradeAction, Transaction, Price, PlatformStat, Distribution, MarketInfo, Position, AccountStat, PeriodAccountStat, VolumeInfo, FeesInfo, AprSnapshot, AffiliateStat, PeriodAffiliateStat, ReferredTrader, AffiliateReward, ReferralCode, PeriodAffiliateTrader } from './model'
import { generateLogId } from './utils/ids'

processor.run(db, async (ctx) => {
  // Collect entities to batch insert
  const transactions: Map<string, Transaction> = new Map()
  const tradeActions: TradeAction[] = []
  const prices: Map<string, Price> = new Map()
  const platformStats: Map<string, PlatformStat> = new Map()
  const distributions: Distribution[] = []
  const marketInfos: Map<string, MarketInfo> = new Map()

  // Account stats aggregation maps
  const positions: Map<string, Position> = new Map()
  const accountStats: Map<string, AccountStat> = new Map()
  const periodAccountStats: Map<string, PeriodAccountStat> = new Map()

  // Aggregate analytics maps
  const volumeInfos: Map<string, VolumeInfo> = new Map()
  const feesInfos: Map<string, FeesInfo> = new Map()
  const aprSnapshots: Map<string, AprSnapshot> = new Map()

  // Referral attribution maps
  const affiliateStats: Map<string, AffiliateStat> = new Map()
  const periodAffiliateStats: Map<string, PeriodAffiliateStat> = new Map()
  const referredTraders: Map<string, ReferredTrader> = new Map()
  // Rows whose id changed because a code was transferred. Re-keying alone leaves the old
  // primary key in the database, so these are deleted explicitly after the upserts.
  const removedTraderIds: Set<string> = new Set()
  const affiliateRewards: AffiliateReward[] = []
  const referralCodes: Map<string, ReferralCode> = new Map()
  const periodAffiliateTraders: Map<string, PeriodAffiliateTrader> = new Map()

  // Tracking maps for cross-event enrichment
  const positionEventsByOrderKey: Map<string, TradeAction> = new Map()
  const orderCreatedByOrderKey: Map<string, TradeAction> = new Map()
  const feesByOrderKey: Map<string, PositionFeeData> = new Map()

  // Track unique depositors across this batch.
  // On first batch, load existing count from DB to seed the set size.
  const seenDepositors = new Set<string>()
  const existingStat = await ctx.store.findOneBy(PlatformStat, { id: 'total' })
  if (existingStat) {
    // Seed the set with placeholder entries so .size reflects prior count.
    // Actual dedup within this batch still works since real addresses are added.
    for (let i = 0; i < existingStat.depositedUsers; i++) {
      seenDepositors.add(`__existing_${i}`)
    }
  }

  // Pre-load existing MarketInfo entities so event handlers can update them
  const existingMarketInfos = await ctx.store.find(MarketInfo)
  for (const mi of existingMarketInfos) {
    marketInfos.set(mi.id, mi)
  }

  // Pre-load existing Position, AccountStat, PeriodAccountStat entities
  const existingPositions = await ctx.store.find(Position, { where: { isSnapshot: false }, relations: { accountStat: true } })
  for (const p of existingPositions) {
    positions.set(p.id, p)
  }
  const existingAccountStats = await ctx.store.find(AccountStat)
  for (const s of existingAccountStats) {
    accountStats.set(s.id, s)
  }
  // Load all-time period stats
  const existingPeriodStats = await ctx.store.find(PeriodAccountStat, { where: { periodStart: 0 } })
  for (const s of existingPeriodStats) {
    periodAccountStats.set(s.id, s)
  }
  // Load competition period stats
  for (const period of COMPETITION_PERIODS) {
    const compPeriodStats = await ctx.store.find(PeriodAccountStat, {
      where: { periodStart: period.start, periodEnd: period.end }
    })
    for (const s of compPeriodStats) {
      periodAccountStats.set(s.id, s)
    }
  }

  // Pre-load existing "total" VolumeInfo and FeesInfo so we accumulate on top
  const existingTotalVolumes = await ctx.store.find(VolumeInfo, { where: { period: 'total' } })
  for (const v of existingTotalVolumes) {
    volumeInfos.set(v.id, v)
  }
  const existingTotalFees = await ctx.store.findOneBy(FeesInfo, { id: 'total' })
  if (existingTotalFees) {
    feesInfos.set(existingTotalFees.id, existingTotalFees)
  }

  // Pre-load referral state. This is REQUIRED, not an optimisation: store.upsert replaces whole
  // rows, so any bucket not loaded here would be overwritten by this batch instead of incremented.
  // Affiliate and trader rows are all-time and few, so they load wholesale; daily buckets only need
  // the ones a batch can still be writing to (today, plus yesterday to survive a rollover).
  const existingAffiliateStats = await ctx.store.find(AffiliateStat, {})
  for (const a of existingAffiliateStats) {
    affiliateStats.set(a.id, a)
  }
  const existingReferredTraders = await ctx.store.find(ReferredTrader, {})
  for (const t of existingReferredTraders) {
    referredTraders.set(t.id, t)
  }
  const existingCodes = await ctx.store.find(ReferralCode, {})
  for (const c of existingCodes) {
    referralCodes.set(c.id, c)
  }

  // Daily buckets are keyed by BLOCK time, so the preload window must come from the batch, not the
  // wall clock. Using Date.now() only ever matched when indexing the chain tip: during an initial
  // sync, a catch-up after downtime, or a BLOCK_FROM re-sync, the day being written was never
  // preloaded, and store.upsert then replaced the row with this batch's increments alone — silently
  // losing the rest of that day. 30-day volume feeds tier promotion, so it undercounted.
  const blockDays = ctx.blocks.map((b) => Math.floor(Math.floor(b.header.timestamp / 1000) / 86400) * 86400)
  if (blockDays.length > 0) {
    const firstDay = Math.min(...blockDays)
    const lastDay = Math.max(...blockDays)
    const existingPeriodAffiliateStats = await ctx.store.find(PeriodAffiliateStat, {
      where: { periodStart: Between(firstDay, lastDay) },
    })
    for (const p of existingPeriodAffiliateStats) {
      periodAffiliateStats.set(p.id, p)
    }
    const existingParticipation = await ctx.store.find(PeriodAffiliateTrader, {
      where: { periodStart: Between(firstDay, lastDay) },
    })
    for (const p of existingParticipation) {
      periodAffiliateTraders.set(p.id, p)
    }
  }

  for (const block of ctx.blocks) {
    for (let i = 0; i < block.logs.length; i++) {
      const log = block.logs[i]

      // ReferralStorage: plain Solidity events, decoded separately from the EventEmitter format.
      if (log.address.toLowerCase() === REFERRAL_STORAGE_ADDRESS) {
        try {
          handleReferralStorageLog(
            { store: ctx.store, block: { height: block.header.height, timestamp: block.header.timestamp }, log: { id: generateLogId(block.header.height, log.logIndex), transactionHash: log.transactionHash } } as any,
            log.topics[0].toLowerCase(),
            log.data,
            referralCodes,
            referredTraders,
            affiliateStats,
            removedTraderIds,
          )
        } catch (err) {
          ctx.log.warn(`Failed to handle ReferralStorage log at ${block.header.height}: ${err}`)
        }
        continue
      }

      // Only process EventEmitter logs
      if (log.address.toLowerCase() !== EVENT_EMITTER_ADDRESS) {
        continue
      }

      // Determine if EventLog1 or EventLog2
      const isEventLog2 = log.topics[0] === EVENT_LOG2_TOPIC

      try {
        // Decode the generic event
        const decoded = decodeEventLog(log.topics, log.data, isEventLog2)

        // Create event context
        const eventCtx: EventContext = {
          store: ctx.store,
          block: {
            height: block.header.height,
            timestamp: block.header.timestamp,
          },
          log: {
            id: generateLogId(block.header.height, i),
            transactionHash: log.transactionHash,
          },
        }

        // Route to appropriate handler based on event name
        await processEvent(eventCtx, decoded, {
          transactions,
          tradeActions,
          prices,
          platformStats,
          distributions,
          marketInfos,
          positions,
          accountStats,
          periodAccountStats,
          volumeInfos,
          feesInfos,
          aprSnapshots,
          affiliateStats,
          periodAffiliateStats,
          referredTraders,
          periodAffiliateTraders,
          affiliateRewards,
          seenDepositors,
          positionEventsByOrderKey,
          orderCreatedByOrderKey,
          feesByOrderKey,
        })
      } catch (err) {
        ctx.log.error({ err, blockHeight: block.header.height, logIndex: i }, 'Failed to decode event')
      }
    }
  }

  // Enrich OrderExecuted/Cancelled/Updated/Frozen with data from related events
  await enrichTradeActions(ctx.store, tradeActions, positionEventsByOrderKey, orderCreatedByOrderKey, feesByOrderKey)

  // Finalize APR snapshots (convert accumulated fees to annualized rates)
  finalizeAprSnapshots(aprSnapshots, marketInfos)

  // Batch insert all entities - transactions first due to foreign key
  if (transactions.size > 0) {
    await ctx.store.upsert([...transactions.values()])
    ctx.log.info(`Upserted ${transactions.size} transactions`)
  }

  if (tradeActions.length > 0) {
    await ctx.store.insert(tradeActions)
    ctx.log.info(`Inserted ${tradeActions.length} trade actions`)
  }

  if (prices.size > 0) {
    await ctx.store.upsert([...prices.values()])
    ctx.log.info(`Upserted ${prices.size} price snapshots`)
  }

  if (platformStats.size > 0) {
    await ctx.store.upsert([...platformStats.values()])
    ctx.log.info(`Upserted ${platformStats.size} platform stats`)
  }

  if (distributions.length > 0) {
    await ctx.store.insert(distributions)
    ctx.log.info(`Inserted ${distributions.length} distributions`)
  }

  if (marketInfos.size > 0) {
    await ctx.store.upsert([...marketInfos.values()])
    ctx.log.info(`Upserted ${marketInfos.size} market infos`)
  }

  // Upsert account stats entities in FK order: AccountStats → Positions → PeriodAccountStats
  if (accountStats.size > 0) {
    await ctx.store.upsert([...accountStats.values()])
    ctx.log.info(`Upserted ${accountStats.size} account stats`)
  }

  if (positions.size > 0) {
    await ctx.store.upsert([...positions.values()])
    ctx.log.info(`Upserted ${positions.size} positions`)
  }

  if (periodAccountStats.size > 0) {
    await ctx.store.upsert([...periodAccountStats.values()])
    ctx.log.info(`Upserted ${periodAccountStats.size} period account stats`)
  }

  // Upsert aggregate analytics entities
  if (volumeInfos.size > 0) {
    await ctx.store.upsert([...volumeInfos.values()])
    ctx.log.info(`Upserted ${volumeInfos.size} volume infos`)
  }

  if (feesInfos.size > 0) {
    await ctx.store.upsert([...feesInfos.values()])
    ctx.log.info(`Upserted ${feesInfos.size} fees infos`)
  }

  if (aprSnapshots.size > 0) {
    await ctx.store.upsert([...aprSnapshots.values()])
    ctx.log.info(`Upserted ${aprSnapshots.size} APR snapshots`)
  }

  // Referral entities. AffiliateReward has a Transaction relation, so it must land after the
  // transactions upsert above.
  if (affiliateStats.size > 0) {
    await ctx.store.upsert([...affiliateStats.values()])
    ctx.log.info(`Upserted ${affiliateStats.size} affiliate stats`)
  }

  if (referralCodes.size > 0) {
    await ctx.store.upsert([...referralCodes.values()])
    ctx.log.info(`Upserted ${referralCodes.size} referral codes`)
  }

  if (referredTraders.size > 0) {
    await ctx.store.upsert([...referredTraders.values()])
    ctx.log.info(`Upserted ${referredTraders.size} referred traders`)
  }

  // Strictly after the referred-trader upsert: a code transfer re-keys the row, so the new primary
  // key must be written before the old one is deleted. Interrupted between the two, this leaves a
  // duplicate — recoverable — rather than losing the trader entirely.
  if (removedTraderIds.size > 0) {
    const stale = await ctx.store.find(ReferredTrader, { where: { id: In([...removedTraderIds]) } })
    if (stale.length > 0) {
      await ctx.store.remove(stale)
      ctx.log.info(`Removed ${stale.length} referred traders re-keyed by a code transfer`)
    }
  }

  if (periodAffiliateTraders.size > 0) {
    await ctx.store.upsert([...periodAffiliateTraders.values()])
  }

  if (periodAffiliateStats.size > 0) {
    await ctx.store.upsert([...periodAffiliateStats.values()])
    ctx.log.info(`Upserted ${periodAffiliateStats.size} affiliate period stats`)
  }

  if (affiliateRewards.length > 0) {
    await ctx.store.insert(affiliateRewards)
    ctx.log.info(`Inserted ${affiliateRewards.length} affiliate rewards`)
  }
})

interface EntityCollectors {
  transactions: Map<string, Transaction>
  tradeActions: TradeAction[]
  prices: Map<string, Price>
  platformStats: Map<string, PlatformStat>
  distributions: Distribution[]
  marketInfos: Map<string, MarketInfo>
  positions: Map<string, Position>
  accountStats: Map<string, AccountStat>
  periodAccountStats: Map<string, PeriodAccountStat>
  volumeInfos: Map<string, VolumeInfo>
  feesInfos: Map<string, FeesInfo>
  aprSnapshots: Map<string, AprSnapshot>
  affiliateStats: Map<string, AffiliateStat>
  periodAffiliateStats: Map<string, PeriodAffiliateStat>
  referredTraders: Map<string, ReferredTrader>
  periodAffiliateTraders: Map<string, PeriodAffiliateTrader>
  affiliateRewards: AffiliateReward[]
  seenDepositors: Set<string>
  // Tracking maps for cross-event enrichment
  positionEventsByOrderKey: Map<string, TradeAction>
  orderCreatedByOrderKey: Map<string, TradeAction>
  feesByOrderKey: Map<string, PositionFeeData>
}

async function processEvent(
  ctx: EventContext,
  data: DecodedEventData,
  collectors: EntityCollectors
): Promise<void> {
  // Try market events (pool amounts, open interest, impact pools)
  // These don't return early — a single transaction can emit both
  // market events AND order/position events
  handleMarketCreated(ctx, data, collectors.marketInfos)
  handleMarketEvent(ctx, data, collectors.marketInfos)

  // Try config events (SetUint — collateral factors, funding params, fee factors, etc.)
  handleConfigEvent(ctx, data, collectors.marketInfos)

  // Oracle price updates — also non-exclusive (emitted alongside deposits/orders)
  const oraclePrice = handlePriceFromOracleEvent(ctx, data)
  if (oraclePrice) {
    collectors.prices.set(oraclePrice.id, oraclePrice)
  }

  // Try position events FIRST — they must go to the tracking map for enrichment,
  // NOT to tradeActions. Must be checked before handleOrderEvent because
  // TRADE_EVENT_NAMES includes PositionIncrease/Decrease.
  const positionResult = await handlePositionEvent(ctx, data)
  if (positionResult) {
    collectors.transactions.set(positionResult.transaction.id, positionResult.transaction)
    // Store position data for enriching OrderExecuted/Cancelled
    collectors.positionEventsByOrderKey.set(positionResult.tradeAction.orderKey, positionResult.tradeAction)

    // Aggregate position & account stats for leaderboard
    // Look up fee data from PositionFeesCollected (emitted earlier in same tx)
    const orderKeyForFees = positionResult.tradeAction.orderKey
    const feeDataForStats = orderKeyForFees ? collectors.feesByOrderKey.get(orderKeyForFees) : undefined
    handlePositionAndAccountStats(
      ctx, data,
      collectors.positions,
      collectors.accountStats,
      collectors.periodAccountStats,
      feeDataForStats
    )

    // Still extract price snapshot from position event
    const price = handlePriceFromPositionEvent(ctx, data)
    if (price) {
      collectors.prices.set(price.id, price)
    }

    // Aggregate volume from position events
    handleVolumeFromPositionEvent(ctx, data, collectors.volumeInfos)
    return
  }

  // Try PositionFeesCollected/PositionFeesInfo events — fee data for enrichment
  const feesResult = handlePositionFeesEvent(ctx, data)
  if (feesResult) {
    collectors.feesByOrderKey.set(feesResult.orderKey, feesResult.fees)

    // Aggregate fees and APR snapshots from fee events
    handleFeesFromPositionFeesEvent(ctx, data, collectors.feesInfos)
    handleAprSnapshotFromFees(ctx, data, collectors.aprSnapshots, collectors.marketInfos)

    // Referral attribution. Must sit inside this block: the branch returns, so a handler placed
    // after it would never see PositionFeesCollected. The handler applies its own exact event-name
    // guard, because handlePositionFeesEvent above also accepts PositionFeesInfo — an identical
    // payload that would otherwise double every affiliate's volume.
    handleReferralFromPositionFeesEvent(
      ctx,
      data,
      collectors.affiliateStats,
      collectors.periodAffiliateStats,
      collectors.referredTraders,
      collectors.periodAffiliateTraders,
    )
    return
  }

  // Try order events (OrderCreated, OrderExecuted, OrderCancelled, etc.)
  const orderResult = await handleOrderEvent(ctx, data)
  if (orderResult) {
    collectors.transactions.set(orderResult.transaction.id, orderResult.transaction)
    collectors.tradeActions.push(orderResult.tradeAction)

    // Track OrderCreated for same-batch enrichment of OrderExecuted/Cancelled
    if (data.eventName === eventKeys.ORDER_CREATED) {
      collectors.orderCreatedByOrderKey.set(orderResult.tradeAction.orderKey, orderResult.tradeAction)
    }
    return
  }

  // Try deposit events for platform stats + account deposit tracking
  const platformStatResult = handlePlatformStatFromDeposit(ctx, data, collectors.seenDepositors)
  if (platformStatResult) {
    collectors.transactions.set(platformStatResult.transaction.id, platformStatResult.transaction)
    collectors.platformStats.set(platformStatResult.platformStat.id, platformStatResult.platformStat)

    // Track totalDepositedUsd0 per account
    handleDepositAccountStats(ctx, data, collectors.accountStats, collectors.periodAccountStats)
    return
  }

  // Affiliate reward ledger. Must precede the distribution branch below: AffiliateRewardUpdated
  // currently falls through to it and is stored as an empty-array Distribution row, silently
  // dropping the amount.
  const affiliateRewardResult = handleAffiliateRewardEvent(ctx, data)
  if (affiliateRewardResult) {
    collectors.transactions.set(affiliateRewardResult.transaction.id, affiliateRewardResult.transaction)
    collectors.affiliateRewards.push(affiliateRewardResult.reward)
    return
  }

  // Try distribution events
  const distributionResult = handleDistributionEvent(ctx, data)
  if (distributionResult) {
    collectors.transactions.set(distributionResult.transaction.id, distributionResult.transaction)
    collectors.distributions.push(distributionResult.distribution)
    return
  }

  // Event not handled - this is fine, we don't need to index everything
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const ENRICHABLE_EVENTS = new Set([
  eventKeys.ORDER_EXECUTED,
  eventKeys.ORDER_CANCELLED,
  eventKeys.ORDER_UPDATED,
  eventKeys.ORDER_FROZEN,
])

/**
 * Enrich OrderExecuted/Cancelled/Updated/Frozen with data from related events.
 *
 * These lifecycle events carry minimal data (key, account, secondaryOrderType).
 * We merge in fields from:
 *   1. PositionIncrease/Decrease (same batch) — execution-time fields
 *   2. OrderCreated (same batch) — order-intent fields
 *   3. OrderCreated (DB fallback) — for cross-batch lookups
 */
async function enrichTradeActions(
  store: Store,
  tradeActions: TradeAction[],
  positionEventsByOrderKey: Map<string, TradeAction>,
  orderCreatedByOrderKey: Map<string, TradeAction>,
  feesByOrderKey: Map<string, PositionFeeData>,
): Promise<void> {
  for (const ta of tradeActions) {
    if (!ENRICHABLE_EVENTS.has(ta.eventName)) continue

    const orderKey = ta.orderKey
    if (!orderKey) continue

    // 1. Merge from PositionIncrease/Decrease (execution-time data)
    const positionEvent = positionEventsByOrderKey.get(orderKey)
    if (positionEvent) {
      mergeFields(ta, positionEvent)
    }

    // 2. Merge fee data from PositionFeesCollected
    const fees = feesByOrderKey.get(orderKey)
    if (fees) {
      if (ta.positionFeeAmount == null) ta.positionFeeAmount = fees.positionFeeAmount
      if (ta.borrowingFeeAmount == null) ta.borrowingFeeAmount = fees.borrowingFeeAmount
      if (ta.fundingFeeAmount == null) ta.fundingFeeAmount = fees.fundingFeeAmount
      if (ta.liquidationFeeAmount == null) ta.liquidationFeeAmount = fees.liquidationFeeAmount
      if (ta.collateralTotalCostAmount == null) ta.collateralTotalCostAmount = fees.totalCostAmount
    }

    // 3. Merge from OrderCreated (same batch — order-intent data)
    const orderCreated = orderCreatedByOrderKey.get(orderKey)
    if (orderCreated) {
      mergeFields(ta, orderCreated)
    }

    // 4. DB fallback if still missing core fields
    if (!ta.marketAddress) {
      const dbOrderCreated = await store.findOneBy(TradeAction, {
        eventName: eventKeys.ORDER_CREATED,
        orderKey,
      })
      if (dbOrderCreated) {
        mergeFields(ta, dbOrderCreated)
      }
    }
  }
}

/**
 * Merge fields from source into target, only overwriting null/undefined/zero values.
 */
function mergeFields(target: TradeAction, source: TradeAction): void {
  if (!target.marketAddress) target.marketAddress = source.marketAddress
  if (target.orderType === 0 && source.orderType !== 0) target.orderType = source.orderType
  if (target.isLong == null) target.isLong = source.isLong

  if (target.initialCollateralTokenAddress === ZERO_ADDRESS && source.initialCollateralTokenAddress !== ZERO_ADDRESS) {
    target.initialCollateralTokenAddress = source.initialCollateralTokenAddress
  }
  if (target.initialCollateralDeltaAmount === 0n && source.initialCollateralDeltaAmount) {
    target.initialCollateralDeltaAmount = source.initialCollateralDeltaAmount
  }

  // Size
  if (target.sizeDeltaUsd == null) target.sizeDeltaUsd = source.sizeDeltaUsd
  if (target.sizeDeltaInTokens == null) target.sizeDeltaInTokens = source.sizeDeltaInTokens

  // Prices
  if (target.executionPrice == null) target.executionPrice = source.executionPrice
  if (target.acceptablePrice == null) target.acceptablePrice = source.acceptablePrice
  if (target.triggerPrice == null) target.triggerPrice = source.triggerPrice
  if (target.contractTriggerPrice == null) target.contractTriggerPrice = source.contractTriggerPrice
  if (target.indexTokenPriceMin == null) target.indexTokenPriceMin = source.indexTokenPriceMin
  if (target.indexTokenPriceMax == null) target.indexTokenPriceMax = source.indexTokenPriceMax
  if (target.collateralTokenPriceMin == null) target.collateralTokenPriceMin = source.collateralTokenPriceMin
  if (target.collateralTokenPriceMax == null) target.collateralTokenPriceMax = source.collateralTokenPriceMax

  // Output
  if (target.minOutputAmount == null) target.minOutputAmount = source.minOutputAmount
  if (target.executionAmountOut == null) target.executionAmountOut = source.executionAmountOut

  // Fees
  if (target.positionFeeAmount == null) target.positionFeeAmount = source.positionFeeAmount
  if (target.borrowingFeeAmount == null) target.borrowingFeeAmount = source.borrowingFeeAmount
  if (target.fundingFeeAmount == null) target.fundingFeeAmount = source.fundingFeeAmount
  if (target.liquidationFeeAmount == null) target.liquidationFeeAmount = source.liquidationFeeAmount
  if (target.collateralTotalCostAmount == null) target.collateralTotalCostAmount = source.collateralTotalCostAmount

  // PnL & Impact
  if (target.pnlUsd == null) target.pnlUsd = source.pnlUsd
  if (target.basePnlUsd == null) target.basePnlUsd = source.basePnlUsd
  if (target.priceImpactUsd == null) target.priceImpactUsd = source.priceImpactUsd
  if (target.priceImpactDiffUsd == null) target.priceImpactDiffUsd = source.priceImpactDiffUsd
  if (target.priceImpactAmount == null) target.priceImpactAmount = source.priceImpactAmount
  if (target.swapImpactUsd == null) target.swapImpactUsd = source.swapImpactUsd

  // Swap path
  if (target.swapPath.length === 0 && source.swapPath.length > 0) target.swapPath = source.swapPath

  // Metadata
  if (target.shouldUnwrapNativeToken == null) target.shouldUnwrapNativeToken = source.shouldUnwrapNativeToken
}
