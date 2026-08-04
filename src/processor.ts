import { EvmBatchProcessor } from '@subsquid/evm-processor'
import { TypeormDatabase } from '@subsquid/typeorm-store'

const CHAIN_ID = parseInt(process.env.CHAIN_ID || '8453', 10)

type ChainConfig = {
  gateway: string
  defaultRpc: string
  eventEmitter: string
  from: number
}

/** Base mainnet (8453) + Base Sepolia (84532) for future testnet redeploy */
const CHAIN_CONFIG: Record<number, ChainConfig> = {
  8453: {
    gateway: 'https://v2.archive.subsquid.io/network/base-mainnet',
    defaultRpc: 'https://mainnet.base.org',
    // deployments/base/EventEmitter.json
    eventEmitter: '0xc989488Ef678529b81F38acE354F8027EdfB742c',
    from: 49_359_429,
  },
  84532: {
    gateway: 'https://v2.archive.subsquid.io/network/base-sepolia',
    defaultRpc: 'https://sepolia.base.org',
    eventEmitter: '0x68001935Ec7C2e3980f99435db3CabC89dea602B',
    from: 37_000_000,
  },
}

const chain = CHAIN_CONFIG[CHAIN_ID]
if (!chain) {
  throw new Error(`Unsupported CHAIN_ID=${CHAIN_ID}. Supported: ${Object.keys(CHAIN_CONFIG).join(', ')}`)
}

export const EVENT_EMITTER_ADDRESS = chain.eventEmitter.toLowerCase()

// EventLog1 and EventLog2 topic hashes
// EventLog1(address,string,string,tuple)
export const EVENT_LOG1_TOPIC = '0x137a44067c8961cd7e1d876f4754a5a3a75989b4552f1843fc69c3b372def160'
// EventLog2(address,string,string,string,tuple)
export const EVENT_LOG2_TOPIC = '0x468a25a7ba624ceea6e540ad6f49171b52495b648417ae91bca21676d8a24dc5'

export const processor = new EvmBatchProcessor()
  .setGateway(chain.gateway)
  .setRpcEndpoint({
    url: process.env.RPC_URL || chain.defaultRpc,
    rateLimit: parseInt(process.env.RPC_RATE_LIMIT || '50', 10),
  })
  .setFinalityConfirmation(10)
  .setBlockRange({
    from: chain.from
  })
  .addLog({
    address: [EVENT_EMITTER_ADDRESS],
    topic0: [EVENT_LOG1_TOPIC, EVENT_LOG2_TOPIC],
    transaction: true
  })
  .setFields({
    log: {
      topics: true,
      data: true,
      transactionHash: true
    },
    block: {
      timestamp: true
    },
    transaction: {
      hash: true,
      from: true
    }
  })

// Database connection uses environment variables:
// DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS
// Hot blocks disabled: accumulative operations (realizedPnl += X) are not
// idempotent — reprocessing during reorgs causes double-counting.
// With setFinalityConfirmation(10), we wait ~20s for finality which is
// fine for leaderboard data.
export const db = new TypeormDatabase({ supportHotBlocks: false })
