# 0xMarkets Squid

Subsquid indexer for the 0xMarkets protocol.

- **Base mainnet (8453)** — default (`CHAIN_ID=8453`)
- **Base Sepolia (84532)** — set `CHAIN_ID=84532` for a future testnet redeploy

Self-hosted on GCP (SQD Cloud is not required). GraphQL listens on port **4350**.

Self-hosted access to the legacy v2 archive gateway requires an `SQD_API_KEY` from [portal.sqd.dev/app](https://portal.sqd.dev/app). Without it the processor skips the gateway and ingests via RPC only.

## Quick Start

### Prerequisites

- Node.js 18+
- Docker (for Postgres)
- Subsquid CLI: `npm i -g @subsquid/cli`

### Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Generate TypeORM models from schema
npm run codegen

# Generate ABI types
npm run typegen

# Start local Postgres
sqd up

# Apply database migrations
sqd migration:apply

# Build the project
npm run build

# Start the processor
npm run process
```

### Run GraphQL API

In a separate terminal:

```bash
npm run serve
```

GraphQL playground: http://localhost:4350/graphql

## Self-host (Docker Compose)

Full stack (Postgres + processor + GraphQL):

```bash
cp .env.example .env
# set CHAIN_ID=8453 and RPC_URL for Base mainnet
docker compose --profile stack up -d --build
```

GraphQL: `http://<host>:4350/graphql`

## Chain config

| `CHAIN_ID` | Network       | Archive gateway                         | EventEmitter                                 | From block |
|------------|---------------|-----------------------------------------|----------------------------------------------|------------|
| `8453`     | Base mainnet  | `…/network/base-mainnet`                | `0xc989488Ef678529b81F38acE354F8027EdfB742c` | 49359429   |
| `84532`    | Base Sepolia  | `…/network/base-sepolia`                | `0x68001935Ec7C2e3980f99435db3CabC89dea602B` | 37000000   |

## Development

### Update Schema

1. Edit `schema.graphql`
2. Regenerate models: `npm run codegen`
3. Generate migration: `npm run migration:generate`
4. Apply migration: `npm run migration:apply`

### Reset Database

```bash
npm run db:reset
```

## Architecture

- **Processor**: Fetches events from Subsquid Archive and decodes them
- **EventEmitter**: Generic event system — all events come through one contract
- **Handlers**: Route events by name to specific processing logic

## Indexed Events

### Trading
- OrderCreated, OrderExecuted, OrderCancelled, OrderUpdated, OrderFrozen
- PositionIncrease, PositionDecrease

### Liquidity
- DepositCreated, DepositExecuted, DepositCancelled
- WithdrawalCreated, WithdrawalExecuted, WithdrawalCancelled

### Claims
- FundingFeesClaimed, CollateralClaimed
- ClaimableCollateralUpdated

## Example Queries

### Get trade history for an account

```graphql
query GetTradeHistory($account: String!) {
  tradeActions(
    where: { account_eq: $account }
    orderBy: timestamp_DESC
    limit: 50
  ) {
    id
    eventName
    marketAddress
    isLong
    sizeDeltaUsd
    executionPrice
    pnlUsd
    timestamp
    txHash
  }
}
```

### Get deposits for a market

```graphql
query GetDeposits($market: String!) {
  depositActions(
    where: { marketAddress_eq: $market, eventName_eq: "DepositExecuted" }
    orderBy: timestamp_DESC
  ) {
    account
    initialLongToken
    initialShortToken
    receivedMarketTokens
    timestamp
  }
}
```
