import { ethers } from 'ethers'

import {
  GOV_SET_CODE_OWNER_TOPIC,
  REGISTER_CODE_TOPIC,
  SET_CODE_OWNER_TOPIC,
  SET_TRADER_REFERRAL_CODE_TOPIC,
} from '../processor'
import { AffiliateStat, ReferralCode, ReferredTrader } from '../model'
import { EventContext } from './orders'

const abiCoder = ethers.AbiCoder.defaultAbiCoder()

/**
 * ReferralStorage events.
 *
 * These do NOT go through the EventEmitter — they are ordinary Solidity events with their own
 * topic0 and positional ABI-encoded data, so they are decoded directly rather than through
 * eventDecoder.
 *
 * Indexing them is what makes "registered but not funded" knowable. A trader attaches a code
 * long before they trade, and until they trade no PositionFeesCollected exists to name their
 * affiliate. Without these events a partner cannot see who signed up and never funded.
 */
export function handleReferralStorageLog(
  ctx: EventContext,
  topic0: string,
  data: string,
  codes: Map<string, ReferralCode>,
  referredTraders: Map<string, ReferredTrader>,
  affiliateStats: Map<string, AffiliateStat>,
  removedTraderIds: Set<string>,
): void {
  const timestampSeconds = Math.floor(ctx.block.timestamp / 1000)

  if (topic0 === REGISTER_CODE_TOPIC) {
    const [account, code] = abiCoder.decode(['address', 'bytes32'], data)
    upsertCode(codes, code as string, (account as string).toLowerCase(), timestampSeconds, ctx.block.height)
    return
  }

  // Ownership can move after registration; the trader's affiliate must follow it.
  if (topic0 === SET_CODE_OWNER_TOPIC) {
    const [, newAccount, code] = abiCoder.decode(['address', 'address', 'bytes32'], data)
    reassign(codes, referredTraders, affiliateStats, removedTraderIds, code as string, (newAccount as string).toLowerCase(), timestampSeconds, ctx.block.height)
    return
  }

  if (topic0 === GOV_SET_CODE_OWNER_TOPIC) {
    const [code, newAccount] = abiCoder.decode(['bytes32', 'address'], data)
    reassign(codes, referredTraders, affiliateStats, removedTraderIds, code as string, (newAccount as string).toLowerCase(), timestampSeconds, ctx.block.height)
    return
  }

  if (topic0 === SET_TRADER_REFERRAL_CODE_TOPIC) {
    const [accountRaw, codeRaw] = abiCoder.decode(['address', 'bytes32'], data)
    const trader = (accountRaw as string).toLowerCase()
    const code = codeRaw as string

    const owner = codes.get(code)?.owner
    // A code registered before the indexer's start block has no ReferralCode row, so the affiliate
    // is unknown here. The trader is still picked up on their first fill, which carries it.
    if (!owner) return

    const id = `${owner}-${trader}`
    const existing = referredTraders.get(id)
    if (existing) {
      existing.referralCode = code
      if (existing.registeredAt === undefined || existing.registeredAt === null) {
        existing.registeredAt = timestampSeconds
      }
      return
    }

    referredTraders.set(
      id,
      new ReferredTrader({
        id,
        affiliate: owner,
        trader,
        referralCode: code,
        isFunded: false,
        registeredAt: timestampSeconds,
        firstTradeTimestamp: null,
        lastTradeTimestamp: null,
        volumeUsd: 0n,
        tradesCount: 0,
        feesPaidUsd: 0n,
        rebateGeneratedUsd: 0n,
      }),
    )
  }
}

function upsertCode(
  codes: Map<string, ReferralCode>,
  code: string,
  owner: string,
  timestampSeconds: number,
  blockNumber: number,
) {
  const existing = codes.get(code)
  if (existing) {
    existing.owner = owner
    return
  }
  codes.set(code, new ReferralCode({ id: code, code, owner, registeredAt: timestampSeconds, blockNumber }))
}

/**
 * Move a code to a new owner and re-key every trader attached to it. The row id encodes the
 * affiliate, so a transfer means deleting the old pairing and creating the new one; leaving the
 * old row would credit the previous owner forever.
 */
function reassign(
  codes: Map<string, ReferralCode>,
  referredTraders: Map<string, ReferredTrader>,
  affiliateStats: Map<string, AffiliateStat>,
  removedTraderIds: Set<string>,
  code: string,
  newOwner: string,
  timestampSeconds: number,
  blockNumber: number,
) {
  upsertCode(codes, code, newOwner, timestampSeconds, blockNumber)

  for (const [id, row] of [...referredTraders.entries()]) {
    if (row.referralCode !== code || row.affiliate === newOwner) continue

    const previousOwner = row.affiliate
    referredTraders.delete(id)
    // Dropping it from the map is not enough: the row still exists in the database under its old
    // primary key, and the next batch preloads it straight back as a ghost that credits the former
    // owner forever. Record it so main.ts can remove it for real.
    removedTraderIds.add(id)

    const nextId = `${newOwner}-${row.trader}`
    row.id = nextId
    row.affiliate = newOwner
    referredTraders.set(nextId, row)

    // Funded-referral counts are a tier input, so they have to move with the trader.
    if (row.isFunded) {
      const from = affiliateStats.get(previousOwner)
      if (from && from.referredTradersCount > 0) from.referredTradersCount -= 1
      // The new owner may have no scoreboard row yet — a code can be transferred to someone who has
      // never had a fill. Skipping the increment there would lose it permanently: the trader row is
      // already isFunded, so no later fill re-counts them.
      const to = affiliateStats.get(newOwner)
      if (to) {
        to.referredTradersCount += 1
      } else {
        affiliateStats.set(
          newOwner,
          new AffiliateStat({
            id: newOwner,
            affiliate: newOwner,
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
      }
    }
  }
}
