import { ethers } from 'ethers'
import { beforeEach, describe, expect, it } from 'vitest'

import { AffiliateStat, ReferralCode, ReferredTrader } from '../model'
import { handleReferralStorageLog } from './referralRegistrations'

const abiCoder = ethers.AbiCoder.defaultAbiCoder()

const OLD_OWNER = '0x1111111111111111111111111111111111111111'
const NEW_OWNER = '0x2222222222222222222222222222222222222222'
const TRADER = '0x3333333333333333333333333333333333333333'
const CODE = ethers.encodeBytes32String('GULF')

const SET_CODE_OWNER_TOPIC = ethers.id('SetCodeOwner(address,address,bytes32)')

const ctx = { block: { timestamp: 1_700_000_000_000, height: 100 } } as any

function affiliate(id: string, referredTradersCount: number) {
  return new AffiliateStat({
    id,
    affiliate: id,
    volumeUsd: 0n,
    tradesCount: 0,
    referredTradersCount,
    feesGeneratedUsd: 0n,
    totalRebateUsd: 0n,
    affiliateRewardUsd: 0n,
    traderDiscountUsd: 0n,
    firstTradeTimestamp: 0,
    lastTradeTimestamp: 0,
  })
}

describe('handleReferralStorageLog — code transfer', () => {
  let codes: Map<string, ReferralCode>
  let referredTraders: Map<string, ReferredTrader>
  let affiliateStats: Map<string, AffiliateStat>
  let removedTraderIds: Set<string>

  beforeEach(() => {
    codes = new Map()
    referredTraders = new Map()
    affiliateStats = new Map([
      [OLD_OWNER, affiliate(OLD_OWNER, 1)],
      [NEW_OWNER, affiliate(NEW_OWNER, 0)],
    ])
    removedTraderIds = new Set()

    referredTraders.set(
      `${OLD_OWNER}-${TRADER}`,
      new ReferredTrader({
        id: `${OLD_OWNER}-${TRADER}`,
        affiliate: OLD_OWNER,
        trader: TRADER,
        referralCode: CODE,
        isFunded: true,
        volumeUsd: 100n,
        tradesCount: 1,
        feesPaidUsd: 1n,
        rebateGeneratedUsd: 1n,
      }),
    )
  })

  function transfer() {
    handleReferralStorageLog(
      ctx,
      SET_CODE_OWNER_TOPIC,
      abiCoder.encode(['address', 'address', 'bytes32'], [OLD_OWNER, NEW_OWNER, CODE]),
      codes,
      referredTraders,
      affiliateStats,
      removedTraderIds,
    )
  }

  it('re-keys the trader onto the new owner', () => {
    transfer()
    expect(referredTraders.has(`${NEW_OWNER}-${TRADER}`)).toBe(true)
    expect(referredTraders.get(`${NEW_OWNER}-${TRADER}`)!.affiliate).toBe(NEW_OWNER)
  })

  it('marks the old primary key for deletion so it cannot come back as a ghost', () => {
    transfer()
    // Dropping it from the map is not enough — the row still exists in the database and the next
    // batch would preload it, crediting the previous owner forever.
    expect(referredTraders.has(`${OLD_OWNER}-${TRADER}`)).toBe(false)
    expect([...removedTraderIds]).toEqual([`${OLD_OWNER}-${TRADER}`])
  })

  it('moves the funded-referral count between the two affiliates', () => {
    transfer()
    // This count is a tier input, so leaving it on the old owner inflates their promotion progress
    // and starves the new one.
    expect(affiliateStats.get(OLD_OWNER)!.referredTradersCount).toBe(0)
    expect(affiliateStats.get(NEW_OWNER)!.referredTradersCount).toBe(1)
  })

  it('creates a scoreboard row when the new owner has never had a fill', () => {
    // A code can be transferred to someone with no AffiliateStat yet. Skipping the increment there
    // loses it permanently, because the trader row is already isFunded and no later fill re-counts.
    affiliateStats.delete(NEW_OWNER)
    transfer()
    expect(affiliateStats.get(NEW_OWNER)!.referredTradersCount).toBe(1)
    expect(affiliateStats.get(NEW_OWNER)!.volumeUsd).toBe(0n)
  })

  it('a round trip inside one batch leaves the trader on the original owner', () => {
    // A -> B then B -> A in the same batch vacates OLD_OWNER's key and then re-creates it. Deleting
    // on "was vacated at some point" would drop the row that was just rewritten.
    transfer()
    handleReferralStorageLog(
      ctx,
      SET_CODE_OWNER_TOPIC,
      abiCoder.encode(['address', 'address', 'bytes32'], [NEW_OWNER, OLD_OWNER, CODE]),
      codes,
      referredTraders,
      affiliateStats,
      removedTraderIds,
    )

    expect(referredTraders.has(`${OLD_OWNER}-${TRADER}`)).toBe(true)
    expect(referredTraders.get(`${OLD_OWNER}-${TRADER}`)!.affiliate).toBe(OLD_OWNER)
    // main.ts must not delete a key that is live again, so the surviving id is excluded there.
    const orphaned = [...removedTraderIds].filter((id) => !referredTraders.has(id))
    expect(orphaned).toEqual([`${NEW_OWNER}-${TRADER}`])
    expect(affiliateStats.get(OLD_OWNER)!.referredTradersCount).toBe(1)
    expect(affiliateStats.get(NEW_OWNER)!.referredTradersCount).toBe(0)
  })

  it('does not move the count for a trader that never traded', () => {
    referredTraders.get(`${OLD_OWNER}-${TRADER}`)!.isFunded = false
    affiliateStats.set(OLD_OWNER, affiliate(OLD_OWNER, 0))
    transfer()
    expect(affiliateStats.get(OLD_OWNER)!.referredTradersCount).toBe(0)
    expect(affiliateStats.get(NEW_OWNER)!.referredTradersCount).toBe(0)
  })
})
