import {
  AffiliateStat,
  PeriodAffiliateStat,
  ReferredTrader,
  AffiliateReward,
  Transaction,
} from '../model'
import {
  DecodedEventData,
  getAddress,
  getUint,
  getBytes32,
} from '../decoding/eventDecoder'
import * as eventKeys from '../decoding/eventKeys'
import { EventContext } from './orders'

// Fee amounts arrive in collateral token units. Oracle prices are already scaled by
// 10^(30 - tokenDecimals), so `amount * price` IS 30-decimal USD — there is no further division.
// Verified against real Base mainnet events, which emit both `borrowingFeeAmount` and the
// contract's own `borrowingFeeUsd`: amount * price reproduces it to within the rounding of the
// integer token amount (<0.15%).
//
// NOTE: aggregates.ts:98-100,167-168 divides by 10**24 here and is wrong by that factor. Left
// alone deliberately — correcting it changes live FeesInfo/AprSnapshot figures and needs a re-sync.

const DAY_SECONDS = 86400

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

/**
 * Attribute a fill to the affiliate whose code the trader is attached to.
 *
 * Reads PositionFeesCollected, which carries `affiliate`, `trader` and `referralCode`
 * unconditionally (zero/empty when the trade is unreferred), plus `referral.*` amounts only when a
 * rebate actually applied.
 *
 * Two things worth preserving if this is ever edited:
 *
 *  1. The event-name guard must stay exact. PositionFeesInfo carries a byte-identical payload, so
 *     accepting both would double every affiliate's volume. (orders.ts deliberately accepts both —
 *     do not copy that guard here.)
 *  2. The rebate is taken from the event, never recomputed as volume x feeRate x currentRate. The
 *     event records the rate that applied at that fill, so a mid-window tier promotion stays
 *     correctly priced on both sides of the change.
 */
export function handleReferralFromPositionFeesEvent(
  ctx: EventContext,
  data: DecodedEventData,
  affiliateStats: Map<string, AffiliateStat>,
  periodAffiliateStats: Map<string, PeriodAffiliateStat>,
  referredTraders: Map<string, ReferredTrader>,
): void {
  if (data.eventName !== eventKeys.POSITION_FEES_COLLECTED) return

  const affiliateRaw = getAddress(data, 'affiliate')
  if (!affiliateRaw) return
  const affiliate = affiliateRaw.toLowerCase()
  // Unreferred flow: the contract resolves an unowned or absent code to the zero address.
  if (affiliate === ZERO_ADDRESS) return

  const traderRaw = getAddress(data, 'trader')
  if (!traderRaw) return
  const trader = traderRaw.toLowerCase()

  // Priced in the same event, so no external price lookup is needed.
  const collateralTokenPriceMin = getUint(data, 'collateralTokenPrice.min')
  if (!collateralTokenPriceMin || collateralTokenPriceMin === 0n) return

  const referralCode = getBytes32(data, 'referralCode') || ZERO_BYTES32
  // tradeSizeUsd is already 30-decimal USD; the fee amounts are not.
  const volumeUsd = getUint(data, 'tradeSizeUsd') ?? 0n
  const positionFeeAmount = getUint(data, 'positionFeeAmount') ?? 0n
  // Absent from the event entirely when totalRebateFactor == 0, hence the ?? 0n.
  const affiliateRewardAmount = getUint(data, 'referral.affiliateRewardAmount') ?? 0n
  const totalRebateAmount = getUint(data, 'referral.totalRebateAmount') ?? 0n
  const traderDiscountAmount = getUint(data, 'referral.traderDiscountAmount') ?? 0n

  const feesGeneratedUsd = positionFeeAmount * collateralTokenPriceMin
  const affiliateRewardUsd = affiliateRewardAmount * collateralTokenPriceMin
  const totalRebateUsd = totalRebateAmount * collateralTokenPriceMin
  const traderDiscountUsd = traderDiscountAmount * collateralTokenPriceMin

  const timestampSeconds = Math.floor(ctx.block.timestamp / 1000)
  const dayTs = Math.floor(timestampSeconds / DAY_SECONDS) * DAY_SECONDS

  // The trader link first: whether it already existed decides if this is a new funded referral.
  const traderId = `${affiliate}-${trader}`
  const existingTrader = referredTraders.get(traderId)
  const isNewReferredTrader = !existingTrader

  if (existingTrader) {
    existingTrader.volumeUsd += volumeUsd
    existingTrader.tradesCount += 1
    existingTrader.feesPaidUsd += feesGeneratedUsd
    existingTrader.rebateGeneratedUsd += affiliateRewardUsd
    existingTrader.lastTradeTimestamp = timestampSeconds
  } else {
    referredTraders.set(
      traderId,
      new ReferredTrader({
        id: traderId,
        affiliate,
        trader,
        referralCode,
        firstTradeTimestamp: timestampSeconds,
        lastTradeTimestamp: timestampSeconds,
        volumeUsd,
        tradesCount: 1,
        feesPaidUsd: feesGeneratedUsd,
        rebateGeneratedUsd: affiliateRewardUsd,
      }),
    )
  }

  const existingStat = affiliateStats.get(affiliate)
  if (existingStat) {
    existingStat.volumeUsd += volumeUsd
    existingStat.tradesCount += 1
    // Counts distinct traders, not trades — only bump it the first time a trader appears.
    if (isNewReferredTrader) existingStat.referredTradersCount += 1
    existingStat.feesGeneratedUsd += feesGeneratedUsd
    existingStat.totalRebateUsd += totalRebateUsd
    existingStat.affiliateRewardUsd += affiliateRewardUsd
    existingStat.traderDiscountUsd += traderDiscountUsd
    existingStat.lastTradeTimestamp = timestampSeconds
  } else {
    affiliateStats.set(
      affiliate,
      new AffiliateStat({
        id: affiliate,
        affiliate,
        volumeUsd,
        tradesCount: 1,
        referredTradersCount: 1,
        feesGeneratedUsd,
        totalRebateUsd,
        affiliateRewardUsd,
        traderDiscountUsd,
        firstTradeTimestamp: timestampSeconds,
        lastTradeTimestamp: timestampSeconds,
      }),
    )
  }

  // Daily bucket. Callers MUST preload recent buckets before the batch, because store.upsert
  // replaces whole rows — an unloaded bucket is overwritten rather than incremented.
  const periodId = `${affiliate}-1d-${dayTs}`
  const existingPeriod = periodAffiliateStats.get(periodId)
  if (existingPeriod) {
    existingPeriod.volumeUsd += volumeUsd
    existingPeriod.tradesCount += 1
    existingPeriod.feesGeneratedUsd += feesGeneratedUsd
    existingPeriod.affiliateRewardUsd += affiliateRewardUsd
  } else {
    periodAffiliateStats.set(
      periodId,
      new PeriodAffiliateStat({
        id: periodId,
        affiliate,
        periodStart: dayTs,
        volumeUsd,
        tradesCount: 1,
        feesGeneratedUsd,
        affiliateRewardUsd,
      }),
    )
  }
}

/**
 * Ledger of affiliate reward credits and claims.
 *
 * Both events emit SCALAR items (market/token/affiliate/delta/nextValue). The generic distribution
 * handler reads ARRAY items, so it stored empty arrays and silently dropped every amount — there is
 * no usable affiliate reward history in the database today. AffiliateRewardClaimed was not handled
 * at all.
 */
export function handleAffiliateRewardEvent(
  ctx: EventContext,
  data: DecodedEventData,
): { reward: AffiliateReward; transaction: Transaction } | null {
  const isUpdate = data.eventName === eventKeys.AFFILIATE_REWARD_UPDATED
  const isClaim = data.eventName === eventKeys.AFFILIATE_REWARD_CLAIMED
  if (!isUpdate && !isClaim) return null

  const affiliate = getAddress(data, 'affiliate')
  if (!affiliate) return null

  const timestampSeconds = Math.floor(ctx.block.timestamp / 1000)
  const txHash = ctx.log.transactionHash

  const transaction = new Transaction({
    id: txHash,
    hash: txHash,
    blockNumber: ctx.block.height,
    timestamp: timestampSeconds,
  })

  // Updated carries the credit as `delta`; Claimed carries the withdrawn sum as `amount`.
  const delta = (isClaim ? getUint(data, 'amount') : getUint(data, 'delta')) ?? 0n
  // Claimed reports only the pool total, so the per-affiliate balance is not available there.
  const nextValue = getUint(data, 'nextValue') ?? 0n

  const reward = new AffiliateReward({
    id: ctx.log.id,
    affiliate: affiliate.toLowerCase(),
    market: (getAddress(data, 'market') || '').toLowerCase(),
    token: (getAddress(data, 'token') || '').toLowerCase(),
    delta,
    nextValue,
    isClaim,
    transaction,
    timestamp: timestampSeconds,
  })

  return { reward, transaction }
}
