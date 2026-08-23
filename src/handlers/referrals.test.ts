import { describe, it, expect, beforeEach } from 'vitest'
import { AffiliateStat, PeriodAffiliateStat, PeriodAffiliateTrader, ReferredTrader } from '../model'
import { DecodedEventData } from '../decoding/eventDecoder'
import { EventContext } from './orders'
import { handleReferralFromPositionFeesEvent, handleAffiliateRewardEvent } from './referrals'

const AFFILIATE = '0xAAAA000000000000000000000000000000000001'
const AFFILIATE_LOWER = AFFILIATE.toLowerCase()
const TRADER = '0xBBBB000000000000000000000000000000000002'
const TRADER_LOWER = TRADER.toLowerCase()
const TRADER2 = '0xCCCC000000000000000000000000000000000003'
const MARKET = '0x35ecCBcAb7963Ea442D25aF1c405f8Cea27D8cF7'
const TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const CODE = '0x0000000000000000000000000000000000000000000000000000000000abcdef'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// USDC has 6 decimals, so its oracle price is scaled by 10^(30-6) = 10^24. Multiplying a raw token
// amount by this price yields 30-decimal USD directly — 10^6 raw units * 10^24 = 10^30 == $1.
// There is NO further division; see the note in referrals.ts.
const UNIT_PRICE = 10n ** 24n

function makeCtx(timestampMs: number, logId = '100-0'): EventContext {
  return {
    store: {} as any,
    block: { height: 100, timestamp: timestampMs },
    log: { id: logId, transactionHash: '0xdeadbeef' },
  }
}

/** All 16 map fields must be present; this fills the empties so tests only state what matters. */
function makeDecodedEvent(partial: {
  eventName: string
  addressItems?: [string, string][]
  uintItems?: [string, bigint][]
  bytes32Items?: [string, string][]
}): DecodedEventData {
  return {
    eventName: partial.eventName,
    msgSender: '0x1111111111111111111111111111111111111111',
    addressItems: new Map(partial.addressItems ?? []),
    addressArrayItems: new Map(),
    uintItems: new Map(partial.uintItems ?? []),
    uintArrayItems: new Map(),
    intItems: new Map(),
    intArrayItems: new Map(),
    boolItems: new Map(),
    boolArrayItems: new Map(),
    bytes32Items: new Map(partial.bytes32Items ?? []),
    bytes32ArrayItems: new Map(),
    bytesItems: new Map(),
    bytesArrayItems: new Map(),
    stringItems: new Map(),
    stringArrayItems: new Map(),
  }
}

function makeFeesEvent(over: {
  eventName?: string
  affiliate?: string
  trader?: string
  tradeSizeUsd?: bigint
  positionFeeAmount?: bigint
  affiliateRewardAmount?: bigint | null
  price?: bigint | null
} = {}): DecodedEventData {
  const uints: [string, bigint][] = [
    ['tradeSizeUsd', over.tradeSizeUsd ?? 1_000n],
    ['positionFeeAmount', over.positionFeeAmount ?? 100n],
  ]
  if (over.price !== null) uints.push(['collateralTokenPrice.min', over.price ?? UNIT_PRICE])
  // The contract omits every referral.* uint when totalRebateFactor == 0, so `null` models a real
  // on-chain shape rather than a synthetic one.
  if (over.affiliateRewardAmount !== null) {
    uints.push(['referral.affiliateRewardAmount', over.affiliateRewardAmount ?? 20n])
    uints.push(['referral.totalRebateAmount', 30n])
    uints.push(['referral.traderDiscountAmount', 10n])
  }
  return makeDecodedEvent({
    eventName: over.eventName ?? 'PositionFeesCollected',
    addressItems: [
      ['affiliate', over.affiliate ?? AFFILIATE],
      ['trader', over.trader ?? TRADER],
      ['market', MARKET],
    ],
    uintItems: uints,
    bytes32Items: [['referralCode', CODE]],
  })
}

describe('handleReferralFromPositionFeesEvent', () => {
  let affiliateStats: Map<string, AffiliateStat>
  let periodAffiliateStats: Map<string, PeriodAffiliateStat>
  let referredTraders: Map<string, ReferredTrader>
  let periodAffiliateTraders: Map<string, PeriodAffiliateTrader>
  const dayStartMs = 1_700_000_000_000
  const dayTs = Math.floor(dayStartMs / 1000 / 86400) * 86400

  beforeEach(() => {
    affiliateStats = new Map()
    periodAffiliateStats = new Map()
    referredTraders = new Map()
    periodAffiliateTraders = new Map()
  })

  function run(ctx: EventContext, data: DecodedEventData) {
    handleReferralFromPositionFeesEvent(ctx, data, affiliateStats, periodAffiliateStats, referredTraders, periodAffiliateTraders)
  }

  it('stamps firstTradeTimestamp on the first fill of a row created by a code transfer', () => {
    // A transfer creates the scoreboard row before its owner has ever traded, so the field starts
    // at zero. Only the fill path can fill it in, and it previously updated lastTradeTimestamp
    // alone — leaving these partners stuck at epoch forever.
    affiliateStats.set(
      AFFILIATE_LOWER,
      new AffiliateStat({
        id: AFFILIATE_LOWER,
        affiliate: AFFILIATE_LOWER,
        volumeUsd: 0n,
        tradesCount: 0,
        referredTradersCount: 1,
        feesGeneratedUsd: 0n,
        totalRebateUsd: 0n,
        affiliateRewardUsd: 0n,
        traderDiscountUsd: 0n,
        firstTradeTimestamp: 0,
        lastTradeTimestamp: 0,
      }),
    )

    run(makeCtx(dayStartMs), makeFeesEvent())

    const stat = affiliateStats.get(AFFILIATE_LOWER)!
    const expected = Math.floor(dayStartMs / 1000)
    expect(stat.firstTradeTimestamp).toBe(expected)
    expect(stat.lastTradeTimestamp).toBe(expected)
  })

  it('does not move firstTradeTimestamp once it is set', () => {
    run(makeCtx(dayStartMs), makeFeesEvent())
    const first = affiliateStats.get(AFFILIATE_LOWER)!.firstTradeTimestamp

    run(makeCtx(dayStartMs + 3_600_000), makeFeesEvent())
    const stat = affiliateStats.get(AFFILIATE_LOWER)!
    expect(stat.firstTradeTimestamp).toBe(first)
    expect(stat.lastTradeTimestamp).toBe(Math.floor((dayStartMs + 3_600_000) / 1000))
  })

  it('creates all three rows with the expected ids and converted USD amounts', () => {
    run(makeCtx(dayStartMs), makeFeesEvent())

    expect(affiliateStats.get(AFFILIATE_LOWER)).toMatchObject({
      id: AFFILIATE_LOWER,
      affiliate: AFFILIATE_LOWER,
      volumeUsd: 1_000n,
      tradesCount: 1,
      referredTradersCount: 1,
      // amount * price, no division: 100 raw USDC units at $1/10^6 units = $0.0001
      feesGeneratedUsd: 100n * UNIT_PRICE,
      affiliateRewardUsd: 20n * UNIT_PRICE,
      totalRebateUsd: 30n * UNIT_PRICE,
      traderDiscountUsd: 10n * UNIT_PRICE,
    })
    expect(periodAffiliateStats.get(`${AFFILIATE_LOWER}-1d-${dayTs}`)).toMatchObject({
      periodStart: dayTs,
      volumeUsd: 1_000n,
      tradesCount: 1,
    })
    expect(referredTraders.get(`${AFFILIATE_LOWER}-${TRADER_LOWER}`)).toMatchObject({
      affiliate: AFFILIATE_LOWER,
      trader: TRADER_LOWER,
      referralCode: CODE,
      firstTradeTimestamp: Math.floor(dayStartMs / 1000),
      volumeUsd: 1_000n,
    })
  })

  it('accumulates repeat trades into the same rows', () => {
    run(makeCtx(dayStartMs), makeFeesEvent())
    run(makeCtx(dayStartMs + 60_000), makeFeesEvent())

    expect(affiliateStats.get(AFFILIATE_LOWER)).toMatchObject({ volumeUsd: 2_000n, tradesCount: 2 })
    expect(periodAffiliateStats.get(`${AFFILIATE_LOWER}-1d-${dayTs}`)).toMatchObject({ volumeUsd: 2_000n })
    expect(referredTraders.size).toBe(1)
  })

  it('counts distinct traders, not trades', () => {
    run(makeCtx(dayStartMs), makeFeesEvent())
    run(makeCtx(dayStartMs), makeFeesEvent())          // same trader again
    run(makeCtx(dayStartMs), makeFeesEvent({ trader: TRADER2 }))

    expect(affiliateStats.get(AFFILIATE_LOWER)!.tradesCount).toBe(3)
    expect(affiliateStats.get(AFFILIATE_LOWER)!.referredTradersCount).toBe(2)
    expect(referredTraders.size).toBe(2)
  })

  it('separates days into their own buckets', () => {
    run(makeCtx(dayStartMs), makeFeesEvent())
    run(makeCtx(dayStartMs + 86_400_000), makeFeesEvent())

    expect(periodAffiliateStats.size).toBe(2)
    expect(periodAffiliateStats.get(`${AFFILIATE_LOWER}-1d-${dayTs}`)!.volumeUsd).toBe(1_000n)
    expect(periodAffiliateStats.get(`${AFFILIATE_LOWER}-1d-${dayTs + 86400}`)!.volumeUsd).toBe(1_000n)
  })

  // The double-count guard: PositionFeesInfo carries a byte-identical payload.
  it('ignores PositionFeesInfo', () => {
    run(makeCtx(dayStartMs), makeFeesEvent({ eventName: 'PositionFeesInfo' }))
    expect(affiliateStats.size).toBe(0)
    expect(referredTraders.size).toBe(0)
  })

  it('ignores unreferred flow (zero-address affiliate)', () => {
    run(makeCtx(dayStartMs), makeFeesEvent({ affiliate: ZERO_ADDRESS }))
    expect(affiliateStats.size).toBe(0)
    expect(periodAffiliateStats.size).toBe(0)
  })

  it('records the trade but no reward when the referral amounts are absent', () => {
    // Real on-chain shape when totalRebateFactor == 0: the referral.* uints are not emitted at all.
    run(makeCtx(dayStartMs), makeFeesEvent({ affiliateRewardAmount: null }))

    expect(affiliateStats.get(AFFILIATE_LOWER)).toMatchObject({
      volumeUsd: 1_000n,
      tradesCount: 1,
      affiliateRewardUsd: 0n,
      totalRebateUsd: 0n,
    })
  })

  it('skips when the collateral price is missing, rather than recording a zero-value trade', () => {
    run(makeCtx(dayStartMs), makeFeesEvent({ price: null }))
    expect(affiliateStats.size).toBe(0)
  })
})

describe('handleAffiliateRewardEvent', () => {
  const tsMs = 1_700_000_000_000

  it('captures a credit from AffiliateRewardUpdated scalars', () => {
    const data = makeDecodedEvent({
      eventName: 'AffiliateRewardUpdated',
      addressItems: [['market', MARKET], ['token', TOKEN], ['affiliate', AFFILIATE]],
      uintItems: [['delta', 500n], ['nextValue', 1_500n], ['nextPoolValue', 9_000n]],
    })

    const result = handleAffiliateRewardEvent(makeCtx(tsMs), data)

    expect(result).not.toBeNull()
    expect(result!.reward).toMatchObject({
      affiliate: AFFILIATE_LOWER,
      market: MARKET.toLowerCase(),
      token: TOKEN.toLowerCase(),
      delta: 500n,
      nextValue: 1_500n,
      isClaim: false,
    })
  })

  it('captures a withdrawal from AffiliateRewardClaimed, whose amount key differs', () => {
    const data = makeDecodedEvent({
      eventName: 'AffiliateRewardClaimed',
      addressItems: [['market', MARKET], ['token', TOKEN], ['affiliate', AFFILIATE], ['receiver', TRADER]],
      uintItems: [['amount', 750n], ['nextPoolValue', 8_250n]],
    })

    const result = handleAffiliateRewardEvent(makeCtx(tsMs), data)

    expect(result!.reward).toMatchObject({ delta: 750n, isClaim: true })
  })

  it('ignores unrelated events', () => {
    const data = makeDecodedEvent({ eventName: 'PositionFeesCollected' })
    expect(handleAffiliateRewardEvent(makeCtx(tsMs), data)).toBeNull()
  })
})
