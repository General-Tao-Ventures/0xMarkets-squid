import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeEventLog, DecodedEventData } from '../decoding/eventDecoder'
import { EventContext } from './orders'
import { handleReferralFromPositionFeesEvent } from './referrals'
import { AffiliateStat, PeriodAffiliateStat, PeriodAffiliateTrader, ReferredTrader } from '../model'

/**
 * Replay of REAL Base mainnet logs, captured from the EventEmitter around block 50.11-50.15M.
 *
 * The pure unit tests in referrals.test.ts build their own DecodedEventData, so they can only prove
 * the handler is self-consistent — if a key were misspelled, the handler would silently record
 * nothing and those tests would still pass. These run genuine on-chain bytes through the real
 * decoder, which is the only way to prove the decoder/handler key contract actually holds.
 *
 * No network access: the payloads are committed in __fixtures__.
 */
const LOGS: Array<{ topics: string[]; data: string; isEventLog2: boolean; blockNumber: number }> =
  JSON.parse(readFileSync(join(__dirname, '__fixtures__/mainnet-position-fees.json'), 'utf8'))

const decoded: DecodedEventData[] = LOGS.map(l => decodeEventLog(l.topics, l.data, l.isEventLog2))
const collected = decoded.filter(d => d.eventName === 'PositionFeesCollected')
const feesInfo = decoded.filter(d => d.eventName === 'PositionFeesInfo')

const ZERO = '0x0000000000000000000000000000000000000000'
const ctxAt = (seconds: number, height: number): EventContext =>
  ({ store: {} as any, block: { height, timestamp: seconds * 1000 }, log: { id: `${height}-0`, transactionHash: '0xreplay' } })

function replay(events: DecodedEventData[], patchAffiliate?: string) {
  const affiliateStats = new Map<string, AffiliateStat>()
  const periodAffiliateStats = new Map<string, PeriodAffiliateStat>()
  const referredTraders = new Map<string, ReferredTrader>()
  const periodAffiliateTraders = new Map<string, PeriodAffiliateTrader>()
  events.forEach((e, i) => {
    const event = patchAffiliate
      ? { ...e, addressItems: new Map(e.addressItems).set('affiliate', patchAffiliate) }
      : e
    handleReferralFromPositionFeesEvent(ctxAt(1_770_000_000 + i, i), event, affiliateStats, periodAffiliateStats, referredTraders, periodAffiliateTraders)
  })
  return { affiliateStats, periodAffiliateStats, referredTraders }
}

describe('referral handler against real Base mainnet payloads', () => {
  it('the fixture holds both event shapes', () => {
    expect(collected.length).toBeGreaterThan(0)
    // PositionFeesInfo carries a byte-identical payload — its presence is what makes the
    // exact-name guard load-bearing rather than theoretical.
    expect(feesInfo.length).toBeGreaterThan(0)
  })

  it('every key the handler reads exists on a real event', () => {
    for (const f of collected) {
      for (const k of ['affiliate', 'trader']) expect(f.addressItems.has(k), `addressItems.${k}`).toBe(true)
      expect(f.bytes32Items.has('referralCode'), 'bytes32Items.referralCode').toBe(true)
      for (const k of ['tradeSizeUsd', 'positionFeeAmount', 'collateralTokenPrice.min'])
        expect(f.uintItems.has(k), `uintItems.${k}`).toBe(true)
    }
  })

  // The referral.* amounts are the one thing NO mainnet event can show us: the contract omits them
  // unless a rebate applied, and no mainnet trade has ever carried a referral code. So we prove the
  // next best thing — that the deployed contract is this exact revision of emitPositionFeesCollected.
  // Its 25 unconditional keys are emitted in a fixed index order; if they match the source
  // one-for-one, the conditional branch that follows (indices 25+) is that source's too, and the
  // referral.* spellings the handler reads are correct by construction.
  //
  // Source: 0xmarkets_contract/contracts/position/PositionEventUtils.sol, setItem(0..24).
  it('deployed contract matches the source revision the referral key names come from', () => {
    const STATIC_UINT_KEYS = [
      'collateralTokenPrice.min', 'collateralTokenPrice.max', 'tradeSizeUsd', 'fundingFeeAmount',
      'claimableLongTokenAmount', 'claimableShortTokenAmount', 'latestFundingFeeAmountPerSize',
      'latestLongTokenClaimableFundingAmountPerSize', 'latestShortTokenClaimableFundingAmountPerSize',
      'borrowingFeeUsd', 'borrowingFeeAmount', 'positionFeeFactor', 'protocolFeeAmount',
      'positionFeeVeAlphaFactor', 'veAlphaFeeAmount', 'positionFeeTreasuryFactor', 'treasuryFeeAmount',
      'positionFeeBuybackFactor', 'buybackFeeAmount', 'feeAmountForPool', 'positionFeeAmountForPool',
      'positionFeeAmount', 'totalCostAmount', 'uiFeeReceiverFactor', 'uiFeeAmount',
    ]
    for (const f of collected) {
      // Insertion order of the decoded Map is emission order.
      expect([...f.uintItems.keys()].slice(0, STATIC_UINT_KEYS.length)).toEqual(STATIC_UINT_KEYS)
    }
    // No mainnet trade has used a code, so the conditional block is genuinely absent — which is
    // also why the handler must tolerate the keys being missing (the ?? 0n path).
    expect(collected.every(f => !f.uintItems.has('referral.affiliateRewardAmount'))).toBe(true)
  })

  it('amount * price IS 30-decimal USD — the contract emits both sides of the conversion', () => {
    // borrowingFeeAmount is in token units and borrowingFeeUsd is the contract's own USD figure, so
    // the pair pins the conversion. Any extra division (an earlier draft divided by 10**24, as
    // aggregates.ts still does) misses by that whole factor.
    let checked = 0
    for (const f of collected) {
      const amount = f.uintItems.get('borrowingFeeAmount')!
      const usd = f.uintItems.get('borrowingFeeUsd')!
      if (!amount || !usd) continue
      checked++
      const price = f.uintItems.get('collateralTokenPrice.min')!
      // Drift is only the rounding of the integer token amount.
      expect(Math.abs(Number(amount * price - usd) / Number(usd))).toBeLessThan(0.01)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('NEGATIVE CONTROL: real unreferred trades create nothing', () => {
    expect(collected.every(f => f.addressItems.get('affiliate') === ZERO)).toBe(true)
    const { affiliateStats, periodAffiliateStats, referredTraders } = replay(decoded)
    expect(affiliateStats.size).toBe(0)
    expect(periodAffiliateStats.size).toBe(0)
    expect(referredTraders.size).toBe(0)
  })

  it('POSITIVE CONTROL: with an affiliate attached, totals match the chain and ignore PositionFeesInfo', () => {
    const AFF = '0x1111111111111111111111111111111111111111'
    const { affiliateStats, referredTraders } = replay(decoded, AFF)

    const stat = affiliateStats.get(AFF)!
    expect(affiliateStats.size).toBe(1)

    // Counts only PositionFeesCollected. Were the guard to accept PositionFeesInfo too, this would
    // read collected.length + feesInfo.length and every affiliate's volume would be inflated.
    expect(stat.tradesCount).toBe(collected.length)

    const expectedVolume = collected.reduce((sum, f) => sum + (f.uintItems.get('tradeSizeUsd') ?? 0n), 0n)
    expect(stat.volumeUsd).toBe(expectedVolume)

    // Distinct traders, not trades — the fixture has repeat traders.
    const distinct = new Set(collected.map(f => f.addressItems.get('trader')!.toLowerCase()))
    expect(stat.referredTradersCount).toBe(distinct.size)
    expect(referredTraders.size).toBe(distinct.size)
    expect(distinct.size).toBeLessThan(collected.length)

    // Fees land in a believable band. The pre-fix code produced ~1e-24 % here.
    const feeBps = Number(stat.feesGeneratedUsd) / Number(stat.volumeUsd) * 10_000
    expect(feeBps).toBeGreaterThan(0.1)
    expect(feeBps).toBeLessThan(50)

    // Mainnet has no rebates, so referral.* is absent from every payload — the ?? 0n path.
    expect(stat.affiliateRewardUsd).toBe(0n)
    expect(stat.totalRebateUsd).toBe(0n)
  })
})
