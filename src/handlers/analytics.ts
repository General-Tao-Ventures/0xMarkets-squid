import { Price, PlatformStat, DepositAction, Transaction } from '../model'
import {
  DecodedEventData,
  getAddress,
  getUint,
} from '../decoding/eventDecoder'
import * as eventKeys from '../decoding/eventKeys'
import { generatePriceId } from '../utils/ids'

export interface EventContext {
  store: import('@subsquid/typeorm-store').Store
  block: {
    height: number
    timestamp: number  // milliseconds
  }
  log: {
    id: string
    transactionHash: string
  }
}

/**
 * Handle PositionIncrease/Decrease events to extract price snapshots.
 * Snaps to hourly intervals so we get at most one entry per token per hour.
 * Uses the market address as the token identifier (matches frontend query pattern).
 */
export function handlePriceFromPositionEvent(
  ctx: EventContext,
  data: DecodedEventData
): Price | null {
  const eventName = data.eventName

  if (eventName !== eventKeys.POSITION_INCREASE && eventName !== eventKeys.POSITION_DECREASE) {
    return null
  }

  const market = getAddress(data, 'market')
  const indexPriceMin = getUint(data, 'indexTokenPrice.min')
  const indexPriceMax = getUint(data, 'indexTokenPrice.max')

  if (!market || indexPriceMin === undefined || indexPriceMax === undefined) {
    return null
  }

  const timestampSeconds = Math.floor(ctx.block.timestamp / 1000)
  const hourTs = Math.floor(timestampSeconds / 3600) * 3600

  const id = generatePriceId(market, hourTs)

  return new Price({
    id,
    token: market.toLowerCase(),
    minPrice: indexPriceMin,
    maxPrice: indexPriceMax,
    snapshotTimestamp: hourTs,
    isSnapshot: true,
    type: 'trade',
  })
}

/**
 * Handle OraclePriceUpdate — per-token min/max prices emitted on every oracle setPrices.
 * Snaps to hourly intervals (at most one entry per token per hour).
 * These power long/short token returns for Uniswap-V2-style pool performance.
 */
export function handlePriceFromOracleEvent(
  ctx: EventContext,
  data: DecodedEventData,
): Price | null {
  if (data.eventName !== eventKeys.ORACLE_PRICE_UPDATE) {
    return null
  }

  const token = getAddress(data, 'token')
  const minPrice = getUint(data, 'minPrice')
  const maxPrice = getUint(data, 'maxPrice')

  if (!token || minPrice === undefined || maxPrice === undefined) {
    return null
  }

  const timestampSeconds = Math.floor(ctx.block.timestamp / 1000)
  const hourTs = Math.floor(timestampSeconds / 3600) * 3600
  const id = generatePriceId(token, hourTs)

  return new Price({
    id,
    token: token.toLowerCase(),
    minPrice,
    maxPrice,
    snapshotTimestamp: hourTs,
    isSnapshot: true,
    type: 'oracle',
  })
}

/**
 * Handle DepositExecuted events to track unique depositors.
 * Maintains a running count of unique depositor accounts.
 */
export function handlePlatformStatFromDeposit(
  ctx: EventContext,
  data: DecodedEventData,
  seenDepositors: Set<string>
): { platformStat: PlatformStat; transaction: Transaction } | null {
  if (data.eventName !== eventKeys.DEPOSIT_EXECUTED) {
    return null
  }

  const account = getAddress(data, 'account') || data.msgSender
  if (!account) return null

  const normalizedAccount = account.toLowerCase()
  seenDepositors.add(normalizedAccount)

  const timestampSeconds = Math.floor(ctx.block.timestamp / 1000)
  const txHash = ctx.log.transactionHash

  const transaction = new Transaction({
    id: txHash,
    hash: txHash,
    blockNumber: ctx.block.height,
    timestamp: timestampSeconds,
  })

  const platformStat = new PlatformStat({
    id: 'total',
    depositedUsers: seenDepositors.size,
    timestamp: timestampSeconds,
  })

  return { platformStat, transaction }
}
