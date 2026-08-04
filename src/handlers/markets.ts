import { ethers } from 'ethers'
import { MarketInfo } from '../model'
import {
  DecodedEventData,
  getAddress,
  getUint,
  getInt,
  getBool,
  getBytes32,
} from '../decoding/eventDecoder'
import * as eventKeys from '../decoding/eventKeys'

const abiCoder = ethers.AbiCoder.defaultAbiCoder()

/**
 * Precomputed keccak256(abi.encode("KEY_NAME")) hashes for config keys.
 * These match the bytes32 constants in contracts/data/Keys.sol.
 */
const CONFIG_KEYS = {
  // data = abi.encode(market)
  MIN_COLLATERAL_FACTOR: '0x9fc265ee9783e670a7a731141f58b59bca5a260ba3eb3f893412fb613dc559f7',
  FUNDING_FACTOR: '0x8d25c5b55501c0bb1657a27730a272059c9a87bbf03ea76434f679bfef179e73',
  FUNDING_EXPONENT_FACTOR: '0x769527e09152c8f6c2369c579559e9b754b40a814f8d7aca18ab79ffef6c3a02',
  FUNDING_INCREASE_FACTOR_PER_SECOND: '0xf107e6afaae3407c99cd46b4f6b09eab1eb038afa0327733a30098b8781f5019',
  FUNDING_DECREASE_FACTOR_PER_SECOND: '0xeab049d89d71d8196c610801d3de2720496d1313dd5f0fdd4c5e6be3752d51a7',
  MIN_FUNDING_FACTOR_PER_SECOND: '0x368afb51b32c3d33dfca82b9cf2acb7189260668d74581e720aba5782e57cd14',
  MAX_FUNDING_FACTOR_PER_SECOND: '0xbeb1b2c6c23ef59c950f3194c435435cc060a612328d7b143074e6309e18e282',
  THRESHOLD_FOR_STABLE_FUNDING: '0x183bdff2eb59d396a4199bf4641673c64ce0e2a6229c72f8a07dccbe95d57d11',
  THRESHOLD_FOR_DECREASE_FUNDING: '0x6eca37816aa74c2687a4153398ea1ad6d8174b8118dbb94527279eb35673ef30',
  ATOMIC_SWAP_FEE_FACTOR: '0xde72bcc3246e0d5d632117733986ff91c7efefa5ae54a84e77a311a9b3e1bb60',

  // data = abi.encode(market, bool isLong)
  RESERVE_FACTOR: '0xeb6dbcc031d84cf5bcdec21aafd7b4ea59618b0863960405767329a7ad41889a',
  OPEN_INTEREST_RESERVE_FACTOR: '0xfb0e1c66a0f6d31a6b27a57ad9f57c3a0afb198688ed6d5930c60914530f220a',
  MAX_OPEN_INTEREST: '0x00468cb3aa9036ff00a31f90887485d87e1ee0299e9c1e1a838fe5110c4fbafb',
  MIN_COLLATERAL_FACTOR_FOR_OPEN_INTEREST_MULTIPLIER: '0xdc48ea96f9c72892c8db4fdc046f04409cdef6b91e71b660bce5b8302ce8a9bb',

  // data = abi.encode(market, bool forPositiveImpact)
  POSITION_FEE_FACTOR: '0x3999256650a6ebfea3dfbd4d56990f4d9048943a0e38ea6aabfc65122556c342',
  SWAP_FEE_FACTOR: '0x94d46da9c8a5f890b6b58c1e6e78b27ac6d05b5b488adb426ef137d5eb0f3599',

  // data = abi.encode(market, address token)
  MAX_POOL_AMOUNT: '0xe88b5773e3873a6265fa6e9e8dc016218fbded41751726542157f40b640a2083',
  MAX_POOL_USD_FOR_DEPOSIT: '0x2db5d586da17dbbdf405b386a76cc03dc4e25079c306e3af459ce5f7241f90b3',

  // data = abi.encode(pnlFactorType, market, bool isLong)
  MAX_PNL_FACTOR_FOR_TRADERS: '0xab15365d3aa743e766355e2557c230d8f943e195dc84d9b2b05928a07b635ee1',
} as const

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

// Collateral factor defaults by asset class (30-decimal precision).
// FX: 0.001333 → 500x, Commodities: 0.003333 → 200x, Crypto: 0.006666 → 100x
const MCF_FX = 1333000000000000000000000000n
const MCF_COMM = 3333000000000000000000000000n
const MCF_CRYPTO = 6666000000000000000000000000n

/**
 * Known market configurations for Base mainnet (8453) and Base Sepolia (84532).
 * Used to create MarketInfo entities when first encountered,
 * since MarketCreated events often predate the squid's start block.
 * Includes default minCollateralFactor so it's never 0 even if
 * the Config.setUint events predate the squid's start block.
 */
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USD0 = '0x3ae4474579d24a743c9016F017e76185A834d837'

const KNOWN_MARKETS: Record<string, {
  indexTokenAddress: string
  longTokenAddress: string
  shortTokenAddress: string
  minCollateralFactor: bigint
}> = {
  // ── Base mainnet (USDC-USDC) ──────────────────────────────────────────
  // EUR/USD
  '0xf8eef96d4af581d60d394afd613ea75c502945dc': {
    indexTokenAddress: '0x2C6bdB9ab7d2d48710B7dd3349Ba099cdAB3B328',
    longTokenAddress: USDC,
    shortTokenAddress: USDC,
    minCollateralFactor: MCF_FX,
  },
  // GBP/USD
  '0x518b8ceea7831a02143ceade3b68b0724964e0c8': {
    indexTokenAddress: '0x915327F0726eC569107C1B3F38c8e0Cf87eC9e72',
    longTokenAddress: USDC,
    shortTokenAddress: USDC,
    minCollateralFactor: MCF_FX,
  },
  // JPY/USD
  '0x516de27eeb84cd7f86035a03f29187ac3b3448f4': {
    indexTokenAddress: '0xF40d284eF3F79451E19D500A57539F753dd79Dbf',
    longTokenAddress: USDC,
    shortTokenAddress: USDC,
    minCollateralFactor: MCF_FX,
  },
  // GOLD/USD
  '0x2d5832ac0553752444d8c0dcfa654105da9897c4': {
    indexTokenAddress: '0x82aB51eb790D1C5f1B1434057A215Eb8cF360Da5',
    longTokenAddress: USDC,
    shortTokenAddress: USDC,
    minCollateralFactor: MCF_COMM,
  },
  // XAG/USD
  '0x73cc35ac21c6675ef5204078cab42cb5fb6c0f23': {
    indexTokenAddress: '0xA927aA364535ba04d88Fc5326D0773CC05d92c08',
    longTokenAddress: USDC,
    shortTokenAddress: USDC,
    minCollateralFactor: MCF_COMM,
  },
  // WBTC/USD
  '0x7d44b88a68c6222693c6aba6e7f4fd0a23393179': {
    indexTokenAddress: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
    longTokenAddress: USDC,
    shortTokenAddress: USDC,
    minCollateralFactor: MCF_CRYPTO,
  },
  // WETH/USD
  '0x35eccbcab7963ea442d25af1c405f8cea27d8cf7': {
    indexTokenAddress: '0x4200000000000000000000000000000000000006',
    longTokenAddress: USDC,
    shortTokenAddress: USDC,
    minCollateralFactor: MCF_CRYPTO,
  },
  // TAO/USD
  '0xbc711da54efd90dd424000b8fdfa886dbffbde9d': {
    indexTokenAddress: '0x53c87230E2A4640D4C200797147261300E7C284A',
    longTokenAddress: USDC,
    shortTokenAddress: USDC,
    minCollateralFactor: MCF_CRYPTO,
  },

  // ── Base Sepolia (USD0-USD0) ──────────────────────────────────────────
  // EUR/USD
  '0x7054eb596acf4fc1c0686c9b2cdac4ae6c6d0f33': {
    indexTokenAddress: '0x18909CC26672376e8FDF1fa54Fc5B892dd6E2b0C',
    longTokenAddress: USD0,
    shortTokenAddress: USD0,
    minCollateralFactor: MCF_FX,
  },
  // GBP/USD
  '0xa09b59adf15b4ed98a099441b84ff1eabf71b548': {
    indexTokenAddress: '0xf7255EAb2968Fb6B8b6226eB25c6EDC2F1CcE60a',
    longTokenAddress: USD0,
    shortTokenAddress: USD0,
    minCollateralFactor: MCF_FX,
  },
  // GOLD/USD
  '0x89c3b33bee4b9cd1b246be44adced870f74637a3': {
    indexTokenAddress: '0xf4ac308123764edFB7453a7446D01277D7DEa1A7',
    longTokenAddress: USD0,
    shortTokenAddress: USD0,
    minCollateralFactor: MCF_COMM,
  },
  // XAG/USD
  '0xf95b646d40bb4bc5e1b7a60c3d79ff5aa41bf967': {
    indexTokenAddress: '0x25f79151C3E00ba7710EcF02192836994E36b440',
    longTokenAddress: USD0,
    shortTokenAddress: USD0,
    minCollateralFactor: MCF_COMM,
  },
  // USD/JPY
  '0xd847a999face1f862120117c33ae8faba768fd4b': {
    indexTokenAddress: '0x7836DF766375f02D71fa3617F5F06a0712699A81',
    longTokenAddress: USD0,
    shortTokenAddress: USD0,
    minCollateralFactor: MCF_FX,
  },
  // WBTC/USD
  '0x63d05da932541380df8d9ee20d8fdb4b02849398': {
    indexTokenAddress: '0xD8a6E3FCA403d79b6AD6216b60527F51cc967D39',
    longTokenAddress: USD0,
    shortTokenAddress: USD0,
    minCollateralFactor: MCF_CRYPTO,
  },
  // WETH/USD
  '0x23f40e3279685413b252a6944af9a0641d3aa6ce': {
    indexTokenAddress: '0x4200000000000000000000000000000000000006',
    longTokenAddress: USD0,
    shortTokenAddress: USD0,
    minCollateralFactor: MCF_CRYPTO,
  },
}

const MARKET_EVENT_NAMES = [
  eventKeys.POOL_AMOUNT_UPDATED,
  eventKeys.OPEN_INTEREST_UPDATED,
  eventKeys.OPEN_INTEREST_IN_TOKENS_UPDATED,
  eventKeys.SWAP_IMPACT_POOL_AMOUNT_UPDATED,
  eventKeys.POSITION_IMPACT_POOL_AMOUNT_UPDATED,
  eventKeys.MARKET_POOL_VALUE_UPDATED,
  eventKeys.MARKET_POOL_VALUE_INFO,
]

/**
 * Check if this event is a market-related event we handle
 */
export function isMarketEvent(data: DecodedEventData): boolean {
  return MARKET_EVENT_NAMES.includes(data.eventName)
}

type MarketTokenConfig = {
  indexTokenAddress: string
  longTokenAddress: string
  shortTokenAddress: string
  minCollateralFactor: bigint
}

/**
 * Get or create a MarketInfo entity for the given market address.
 * If the entity doesn't exist in the map, creates one using known config
 * or an optional override (e.g. from MarketCreated).
 */
function getOrCreateMarketInfo(
  marketAddress: string,
  marketInfos: Map<string, MarketInfo>,
  timestamp: number,
  override?: MarketTokenConfig,
): MarketInfo | null {
  const normalizedAddress = marketAddress.toLowerCase()

  const existing = marketInfos.get(normalizedAddress)
  if (existing) return existing

  const config = override ?? KNOWN_MARKETS[normalizedAddress]
  if (!config) return null

  const marketInfo = new MarketInfo({
    id: normalizedAddress,
    marketTokenAddress: marketAddress,
    indexTokenAddress: config.indexTokenAddress,
    longTokenAddress: config.longTokenAddress,
    shortTokenAddress: config.shortTokenAddress,
    isDisabled: false,

    longPoolAmount: 0n,
    shortPoolAmount: 0n,
    maxLongPoolAmount: 0n,
    maxShortPoolAmount: 0n,
    maxLongPoolUsdForDeposit: 0n,
    maxShortPoolUsdForDeposit: 0n,
    poolValueMax: 0n,
    poolValueMin: 0n,

    reserveFactorLong: 0n,
    reserveFactorShort: 0n,
    openInterestReserveFactorLong: 0n,
    openInterestReserveFactorShort: 0n,

    longOpenInterestUsd: 0n,
    shortOpenInterestUsd: 0n,
    longOpenInterestInTokens: 0n,
    shortOpenInterestInTokens: 0n,
    maxOpenInterestLong: 0n,
    maxOpenInterestShort: 0n,

    minCollateralFactor: config.minCollateralFactor,
    minCollateralFactorForOpenInterestLong: 0n,
    minCollateralFactorForOpenInterestShort: 0n,

    fundingFactor: 0n,
    fundingExponentFactor: 0n,
    fundingIncreaseFactorPerSecond: 0n,
    fundingDecreaseFactorPerSecond: 0n,
    thresholdForStableFunding: 0n,
    thresholdForDecreaseFunding: 0n,
    minFundingFactorPerSecond: 0n,
    maxFundingFactorPerSecond: 0n,

    totalBorrowingFees: 0n,
    borrowingFactorPerSecondForLongs: 0n,
    borrowingFactorPerSecondForShorts: 0n,

    positionImpactPoolAmount: 0n,
    minPositionImpactPoolAmount: 0n,
    positionImpactPoolDistributionRate: 0n,
    swapImpactPoolAmountLong: 0n,
    swapImpactPoolAmountShort: 0n,

    positionFeeFactorForPositiveImpact: 0n,
    positionFeeFactorForNegativeImpact: 0n,
    swapFeeFactorForPositiveImpact: 0n,
    swapFeeFactorForNegativeImpact: 0n,
    atomicSwapFeeFactor: 0n,

    maxPnlFactorForTradersLong: 0n,
    maxPnlFactorForTradersShort: 0n,

    createdAt: timestamp,
    updatedAt: timestamp,
  })

  marketInfos.set(normalizedAddress, marketInfo)
  return marketInfo
}

/**
 * Handle MarketCreated — seed MarketInfo from on-chain token addresses.
 * Needed for markets created after the squid start block (KNOWN_MARKETS covers the rest).
 */
export function handleMarketCreated(
  ctx: EventContext,
  data: DecodedEventData,
  marketInfos: Map<string, MarketInfo>,
): boolean {
  if (data.eventName !== eventKeys.MARKET_CREATED) return false

  const marketToken = getAddress(data, 'marketToken')
  const indexToken = getAddress(data, 'indexToken')
  const longToken = getAddress(data, 'longToken')
  const shortToken = getAddress(data, 'shortToken')
  if (!marketToken || !indexToken || !longToken || !shortToken) return false

  const timestampSeconds = Math.floor(ctx.block.timestamp / 1000)
  const known = KNOWN_MARKETS[marketToken.toLowerCase()]
  getOrCreateMarketInfo(marketToken, marketInfos, timestampSeconds, {
    indexTokenAddress: indexToken,
    longTokenAddress: longToken,
    shortTokenAddress: shortToken,
    minCollateralFactor: known?.minCollateralFactor ?? MCF_CRYPTO,
  })
  return true
}

/**
 * Handle market-related events and update MarketInfo entities.
 * Returns true if the event was handled.
 */
export function handleMarketEvent(
  ctx: EventContext,
  data: DecodedEventData,
  marketInfos: Map<string, MarketInfo>
): boolean {
  if (!isMarketEvent(data)) return false

  const marketAddress = getAddress(data, 'market')
  if (!marketAddress) return false

  const timestampSeconds = Math.floor(ctx.block.timestamp / 1000)
  const marketInfo = getOrCreateMarketInfo(marketAddress, marketInfos, timestampSeconds)
  if (!marketInfo) return false

  marketInfo.updatedAt = timestampSeconds

  switch (data.eventName) {
    case eventKeys.POOL_AMOUNT_UPDATED: {
      const nextValue = getUint(data, 'nextValue')
      if (nextValue !== undefined) {
        // All markets use USD0 as both long and short token,
        // so both pools track the same single amount
        marketInfo.longPoolAmount = nextValue
        marketInfo.shortPoolAmount = nextValue
      }
      break
    }

    case eventKeys.OPEN_INTEREST_UPDATED: {
      const isLong = getBool(data, 'isLong')
      const nextOpenInterest = getUint(data, 'nextOpenInterest')
      if (nextOpenInterest !== undefined) {
        if (isLong) {
          marketInfo.longOpenInterestUsd = nextOpenInterest
        } else {
          marketInfo.shortOpenInterestUsd = nextOpenInterest
        }
      }
      break
    }

    case eventKeys.OPEN_INTEREST_IN_TOKENS_UPDATED: {
      const isLong = getBool(data, 'isLong')
      const nextOpenInterest = getUint(data, 'nextOpenInterest')
      if (nextOpenInterest !== undefined) {
        if (isLong) {
          marketInfo.longOpenInterestInTokens = nextOpenInterest
        } else {
          marketInfo.shortOpenInterestInTokens = nextOpenInterest
        }
      }
      break
    }

    case eventKeys.SWAP_IMPACT_POOL_AMOUNT_UPDATED: {
      const nextValue = getUint(data, 'nextValue')
      const token = getAddress(data, 'token')
      if (nextValue !== undefined && token) {
        const tokenLower = token.toLowerCase()
        if (tokenLower === marketInfo.longTokenAddress.toLowerCase()) {
          marketInfo.swapImpactPoolAmountLong = nextValue
        }
        if (tokenLower === marketInfo.shortTokenAddress.toLowerCase()) {
          marketInfo.swapImpactPoolAmountShort = nextValue
        }
      }
      break
    }

    case eventKeys.POSITION_IMPACT_POOL_AMOUNT_UPDATED: {
      const nextValue = getUint(data, 'nextValue')
      if (nextValue !== undefined) {
        marketInfo.positionImpactPoolAmount = nextValue
      }
      break
    }

    case eventKeys.MARKET_POOL_VALUE_UPDATED:
    case eventKeys.MARKET_POOL_VALUE_INFO: {
      // poolValue is a signed int (can be negative if PnL exceeds pool)
      const poolValue = getInt(data, 'poolValue')
      if (poolValue !== undefined && poolValue > 0n) {
        marketInfo.poolValueMax = poolValue
        marketInfo.poolValueMin = poolValue
      }
      break
    }
  }

  return true
}

/**
 * Handle SetUint config events and update MarketInfo config fields.
 * Config.sol emits: eventEmitter.emitEventLog1("SetUint", baseKey, eventData)
 * eventData contains: bytes32Items["baseKey"], bytesItems["data"], uintItems["value"]
 */
export function handleConfigEvent(
  ctx: EventContext,
  data: DecodedEventData,
  marketInfos: Map<string, MarketInfo>
): boolean {
  if (data.eventName !== eventKeys.SET_UINT) return false

  const baseKey = getBytes32(data, 'baseKey')
  const value = getUint(data, 'value')
  const rawData = data.bytesItems.get('data')

  if (!baseKey || value === undefined || !rawData) return false

  // Decode market address from the data bytes.
  // For all per-market config keys, market is the first abi.encode parameter.
  // The second param is a bool — isLong for directional keys, forPositiveImpact for fee keys.
  let marketAddress: string
  let boolParam: boolean | undefined

  try {
    switch (baseKey) {
      // data = abi.encode(market)
      case CONFIG_KEYS.MIN_COLLATERAL_FACTOR:
      case CONFIG_KEYS.FUNDING_FACTOR:
      case CONFIG_KEYS.FUNDING_EXPONENT_FACTOR:
      case CONFIG_KEYS.FUNDING_INCREASE_FACTOR_PER_SECOND:
      case CONFIG_KEYS.FUNDING_DECREASE_FACTOR_PER_SECOND:
      case CONFIG_KEYS.MIN_FUNDING_FACTOR_PER_SECOND:
      case CONFIG_KEYS.MAX_FUNDING_FACTOR_PER_SECOND:
      case CONFIG_KEYS.THRESHOLD_FOR_STABLE_FUNDING:
      case CONFIG_KEYS.THRESHOLD_FOR_DECREASE_FUNDING:
      case CONFIG_KEYS.ATOMIC_SWAP_FEE_FACTOR: {
        const decoded = abiCoder.decode(['address'], rawData)
        marketAddress = decoded[0] as string
        break
      }

      // data = abi.encode(market, bool isLong/forPositiveImpact)
      case CONFIG_KEYS.RESERVE_FACTOR:
      case CONFIG_KEYS.OPEN_INTEREST_RESERVE_FACTOR:
      case CONFIG_KEYS.MAX_OPEN_INTEREST:
      case CONFIG_KEYS.MIN_COLLATERAL_FACTOR_FOR_OPEN_INTEREST_MULTIPLIER:
      case CONFIG_KEYS.POSITION_FEE_FACTOR:
      case CONFIG_KEYS.SWAP_FEE_FACTOR: {
        const decoded = abiCoder.decode(['address', 'bool'], rawData)
        marketAddress = decoded[0] as string
        boolParam = decoded[1] as boolean
        break
      }

      // data = abi.encode(market, address token)
      case CONFIG_KEYS.MAX_POOL_AMOUNT:
      case CONFIG_KEYS.MAX_POOL_USD_FOR_DEPOSIT: {
        const decoded = abiCoder.decode(['address', 'address'], rawData)
        marketAddress = decoded[0] as string
        // All our markets use USD0 for both long and short, so we set both
        break
      }

      default:
        return false
    }
  } catch {
    return false
  }

  const normalizedAddress = marketAddress.toLowerCase()
  const timestampSeconds = Math.floor(ctx.block.timestamp / 1000)
  const marketInfo = getOrCreateMarketInfo(normalizedAddress, marketInfos, timestampSeconds)
  if (!marketInfo) return false

  marketInfo.updatedAt = timestampSeconds

  switch (baseKey) {
    case CONFIG_KEYS.MIN_COLLATERAL_FACTOR:
      marketInfo.minCollateralFactor = value
      break

    case CONFIG_KEYS.FUNDING_FACTOR:
      marketInfo.fundingFactor = value
      break
    case CONFIG_KEYS.FUNDING_EXPONENT_FACTOR:
      marketInfo.fundingExponentFactor = value
      break
    case CONFIG_KEYS.FUNDING_INCREASE_FACTOR_PER_SECOND:
      marketInfo.fundingIncreaseFactorPerSecond = value
      break
    case CONFIG_KEYS.FUNDING_DECREASE_FACTOR_PER_SECOND:
      marketInfo.fundingDecreaseFactorPerSecond = value
      break
    case CONFIG_KEYS.MIN_FUNDING_FACTOR_PER_SECOND:
      marketInfo.minFundingFactorPerSecond = value
      break
    case CONFIG_KEYS.MAX_FUNDING_FACTOR_PER_SECOND:
      marketInfo.maxFundingFactorPerSecond = value
      break
    case CONFIG_KEYS.THRESHOLD_FOR_STABLE_FUNDING:
      marketInfo.thresholdForStableFunding = value
      break
    case CONFIG_KEYS.THRESHOLD_FOR_DECREASE_FUNDING:
      marketInfo.thresholdForDecreaseFunding = value
      break
    case CONFIG_KEYS.ATOMIC_SWAP_FEE_FACTOR:
      marketInfo.atomicSwapFeeFactor = value
      break

    // Directional keys — boolParam = isLong
    case CONFIG_KEYS.RESERVE_FACTOR:
      if (boolParam) { marketInfo.reserveFactorLong = value }
      else { marketInfo.reserveFactorShort = value }
      break
    case CONFIG_KEYS.OPEN_INTEREST_RESERVE_FACTOR:
      if (boolParam) { marketInfo.openInterestReserveFactorLong = value }
      else { marketInfo.openInterestReserveFactorShort = value }
      break
    case CONFIG_KEYS.MAX_OPEN_INTEREST:
      if (boolParam) { marketInfo.maxOpenInterestLong = value }
      else { marketInfo.maxOpenInterestShort = value }
      break
    case CONFIG_KEYS.MIN_COLLATERAL_FACTOR_FOR_OPEN_INTEREST_MULTIPLIER:
      if (boolParam) { marketInfo.minCollateralFactorForOpenInterestLong = value }
      else { marketInfo.minCollateralFactorForOpenInterestShort = value }
      break

    // Fee factor keys — boolParam = forPositiveImpact
    case CONFIG_KEYS.POSITION_FEE_FACTOR:
      if (boolParam) { marketInfo.positionFeeFactorForPositiveImpact = value }
      else { marketInfo.positionFeeFactorForNegativeImpact = value }
      break
    case CONFIG_KEYS.SWAP_FEE_FACTOR:
      if (boolParam) { marketInfo.swapFeeFactorForPositiveImpact = value }
      else { marketInfo.swapFeeFactorForNegativeImpact = value }
      break

    // Token-pair keys — all markets use USD0 for both long and short
    case CONFIG_KEYS.MAX_POOL_AMOUNT:
      marketInfo.maxLongPoolAmount = value
      marketInfo.maxShortPoolAmount = value
      break
    case CONFIG_KEYS.MAX_POOL_USD_FOR_DEPOSIT:
      marketInfo.maxLongPoolUsdForDeposit = value
      marketInfo.maxShortPoolUsdForDeposit = value
      break
  }

  return true
}
