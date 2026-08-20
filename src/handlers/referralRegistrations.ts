import { ethers } from 'ethers'

import {
  GOV_SET_CODE_OWNER_TOPIC,
  REGISTER_CODE_TOPIC,
  SET_CODE_OWNER_TOPIC,
  SET_TRADER_REFERRAL_CODE_TOPIC,
} from '../processor'
import { ReferralCode, ReferredTrader } from '../model'
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
    reassign(codes, referredTraders, code as string, (newAccount as string).toLowerCase(), timestampSeconds, ctx.block.height)
    return
  }

  if (topic0 === GOV_SET_CODE_OWNER_TOPIC) {
    const [code, newAccount] = abiCoder.decode(['bytes32', 'address'], data)
    reassign(codes, referredTraders, code as string, (newAccount as string).toLowerCase(), timestampSeconds, ctx.block.height)
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
  code: string,
  newOwner: string,
  timestampSeconds: number,
  blockNumber: number,
) {
  upsertCode(codes, code, newOwner, timestampSeconds, blockNumber)

  for (const [id, row] of [...referredTraders.entries()]) {
    if (row.referralCode !== code || row.affiliate === newOwner) continue
    referredTraders.delete(id)
    const nextId = `${newOwner}-${row.trader}`
    row.id = nextId
    row.affiliate = newOwner
    referredTraders.set(nextId, row)
  }
}
