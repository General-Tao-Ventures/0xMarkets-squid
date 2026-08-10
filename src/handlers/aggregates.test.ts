import { describe, it, expect, beforeEach } from 'vitest'
import { VolumeInfo } from '../model'
import { DecodedEventData } from '../decoding/eventDecoder'
import { EventContext } from './orders'
import { handleVolumeFromPositionEvent } from './aggregates'

const MARKET = '0x35ecCBcAb7963Ea442D25aF1c405f8Cea27D8cF7'
const MARKET_LOWER = MARKET.toLowerCase()

function makeCtx(timestampMs: number): EventContext {
  return {
    store: {} as any,
    block: { height: 100, timestamp: timestampMs },
    log: { id: '100-0', transactionHash: '0xdeadbeef' },
  }
}

function makePositionSizeEvent(
  eventName: 'PositionIncrease' | 'PositionDecrease',
  market: string,
  sizeDeltaUsd: bigint,
): DecodedEventData {
  return {
    eventName,
    msgSender: '0x1111111111111111111111111111111111111111',
    addressItems: new Map([['market', market]]),
    addressArrayItems: new Map(),
    uintItems: new Map([['sizeDeltaUsd', sizeDeltaUsd]]),
    uintArrayItems: new Map(),
    intItems: new Map(),
    intArrayItems: new Map(),
    boolItems: new Map(),
    boolArrayItems: new Map(),
    bytes32Items: new Map(),
    bytes32ArrayItems: new Map(),
    bytesItems: new Map(),
    bytesArrayItems: new Map(),
    stringItems: new Map(),
    stringArrayItems: new Map(),
  }
}

describe('handleVolumeFromPositionEvent', () => {
  let volumeInfos: Map<string, VolumeInfo>
  const hourStartMs = 1_700_000_000_000 // fixed wall clock for deterministic hour bucket
  const hourTs = Math.floor(hourStartMs / 1000 / 3600) * 3600

  beforeEach(() => {
    volumeInfos = new Map()
  })

  it('creates hourly + total VolumeInfo rows from PositionIncrease', () => {
    const ctx = makeCtx(hourStartMs + 60_000)
    const data = makePositionSizeEvent('PositionIncrease', MARKET, 1_500n)

    handleVolumeFromPositionEvent(ctx, data, volumeInfos)

    const hourlyId = `${MARKET_LOWER}-1h-${hourTs}`
    const totalId = `${MARKET_LOWER}-total-0`

    expect(volumeInfos.size).toBe(2)
    expect(volumeInfos.get(hourlyId)).toMatchObject({
      id: hourlyId,
      market: MARKET_LOWER,
      period: '1h',
      volumeUsd: 1_500n,
      timestamp: hourTs,
    })
    expect(volumeInfos.get(totalId)).toMatchObject({
      id: totalId,
      market: MARKET_LOWER,
      period: 'total',
      volumeUsd: 1_500n,
      timestamp: 0,
    })
  })

  it('accumulates sizeDeltaUsd into the same hourly bucket', () => {
    const ctx = makeCtx(hourStartMs + 120_000)
    handleVolumeFromPositionEvent(
      ctx,
      makePositionSizeEvent('PositionIncrease', MARKET, 1_000n),
      volumeInfos,
    )
    handleVolumeFromPositionEvent(
      ctx,
      makePositionSizeEvent('PositionDecrease', MARKET, 250n),
      volumeInfos,
    )

    const hourlyId = `${MARKET_LOWER}-1h-${hourTs}`
    expect(volumeInfos.get(hourlyId)?.volumeUsd).toBe(1_250n)
    expect(volumeInfos.get(`${MARKET_LOWER}-total-0`)?.volumeUsd).toBe(1_250n)
  })

  it('ignores non-position events and zero size deltas', () => {
    const ctx = makeCtx(hourStartMs)
    handleVolumeFromPositionEvent(
      ctx,
      makePositionSizeEvent('PositionIncrease', MARKET, 0n),
      volumeInfos,
    )
    handleVolumeFromPositionEvent(
      ctx,
      {
        ...makePositionSizeEvent('PositionIncrease', MARKET, 100n),
        eventName: 'OrderExecuted',
      },
      volumeInfos,
    )

    expect(volumeInfos.size).toBe(0)
  })
})
