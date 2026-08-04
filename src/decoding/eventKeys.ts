/**
 * Event names emitted by the 0xMarkets EventEmitter
 * These match the string eventName in EventLog1/EventLog2 events
 */

// Order Events
export const ORDER_CREATED = 'OrderCreated'
export const ORDER_EXECUTED = 'OrderExecuted'
export const ORDER_CANCELLED = 'OrderCancelled'
export const ORDER_UPDATED = 'OrderUpdated'
export const ORDER_FROZEN = 'OrderFrozen'
export const ORDER_SIZE_DELTA_AUTO_UPDATED = 'OrderSizeDeltaAutoUpdated'
export const ORDER_COLLATERAL_DELTA_AMOUNT_AUTO_UPDATED = 'OrderCollateralDeltaAmountAutoUpdated'

// Position Events
export const POSITION_INCREASE = 'PositionIncrease'
export const POSITION_DECREASE = 'PositionDecrease'
export const POSITION_FEES_COLLECTED = 'PositionFeesCollected'
export const POSITION_FEES_INFO = 'PositionFeesInfo'
export const INSOLVENT_CLOSE = 'InsolventClose'
export const INSUFFICIENT_FUNDING_FEE_PAYMENT = 'InsufficientFundingFeePayment'

// Deposit Events
export const DEPOSIT_CREATED = 'DepositCreated'
export const DEPOSIT_EXECUTED = 'DepositExecuted'
export const DEPOSIT_CANCELLED = 'DepositCancelled'

// Withdrawal Events
export const WITHDRAWAL_CREATED = 'WithdrawalCreated'
export const WITHDRAWAL_EXECUTED = 'WithdrawalExecuted'
export const WITHDRAWAL_CANCELLED = 'WithdrawalCancelled'

// Shift Events
export const SHIFT_CREATED = 'ShiftCreated'
export const SHIFT_EXECUTED = 'ShiftExecuted'
export const SHIFT_CANCELLED = 'ShiftCancelled'

// Market Events
export const MARKET_CREATED = 'MarketCreated'
export const MARKET_POOL_VALUE_INFO = 'MarketPoolValueInfo'
export const MARKET_POOL_VALUE_UPDATED = 'MarketPoolValueUpdated'
export const POOL_AMOUNT_UPDATED = 'PoolAmountUpdated'
export const SWAP_IMPACT_POOL_AMOUNT_UPDATED = 'SwapImpactPoolAmountUpdated'
export const POSITION_IMPACT_POOL_DISTRIBUTED = 'PositionImpactPoolDistributed'
export const POSITION_IMPACT_POOL_AMOUNT_UPDATED = 'PositionImpactPoolAmountUpdated'
export const OPEN_INTEREST_UPDATED = 'OpenInterestUpdated'
export const OPEN_INTEREST_IN_TOKENS_UPDATED = 'OpenInterestInTokensUpdated'
export const COLLATERAL_SUM_UPDATED = 'CollateralSumUpdated'
export const CUMULATIVE_BORROWING_FACTOR_UPDATED = 'CumulativeBorrowingFactorUpdated'
export const FUNDING_FEE_AMOUNT_PER_SIZE_UPDATED = 'FundingFeeAmountPerSizeUpdated'
export const CLAIMABLE_FUNDING_AMOUNT_PER_SIZE_UPDATED = 'ClaimableFundingAmountPerSizeUpdated'
export const CLAIMABLE_FUNDING_UPDATED = 'ClaimableFundingUpdated'
export const FUNDING_FEES_CLAIMED = 'FundingFeesClaimed'
export const CLAIMABLE_COLLATERAL_UPDATED = 'ClaimableCollateralUpdated'
export const COLLATERAL_CLAIMED = 'CollateralClaimed'
export const UI_FEE_FACTOR_UPDATED = 'UiFeeFactorUpdated'

// GLV Events
export const GLV_DEPOSIT_CREATED = 'GlvDepositCreated'
export const GLV_DEPOSIT_EXECUTED = 'GlvDepositExecuted'
export const GLV_DEPOSIT_CANCELLED = 'GlvDepositCancelled'
export const GLV_WITHDRAWAL_CREATED = 'GlvWithdrawalCreated'
export const GLV_WITHDRAWAL_EXECUTED = 'GlvWithdrawalExecuted'
export const GLV_WITHDRAWAL_CANCELLED = 'GlvWithdrawalCancelled'
export const GLV_SHIFT_CREATED = 'GlvShiftCreated'
export const GLV_SHIFT_EXECUTED = 'GlvShiftExecuted'
export const GLV_SHIFT_CANCELLED = 'GlvShiftCancelled'

// Referral Events
export const AFFILIATE_REWARD_UPDATED = 'AffiliateRewardUpdated'
export const AFFILIATE_REWARD_CLAIMED = 'AffiliateRewardClaimed'

// Config Events
export const SET_UINT = 'SetUint'

// Oracle/Price Events
export const ORACLE_PRICE_UPDATE = 'OraclePriceUpdate'

// Distribution Events
export const DISTRIBUTION_CREATED = 'DistributionCreated'

// All trade-related event names for easy filtering
export const TRADE_EVENT_NAMES = [
  ORDER_CREATED,
  ORDER_EXECUTED,
  ORDER_CANCELLED,
  ORDER_UPDATED,
  ORDER_FROZEN,
  POSITION_INCREASE,
  POSITION_DECREASE,
]

// All deposit/withdrawal event names
export const LIQUIDITY_EVENT_NAMES = [
  DEPOSIT_CREATED,
  DEPOSIT_EXECUTED,
  DEPOSIT_CANCELLED,
  WITHDRAWAL_CREATED,
  WITHDRAWAL_EXECUTED,
  WITHDRAWAL_CANCELLED,
]
