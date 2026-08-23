import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"

/**
 * All-time totals per affiliate. id = affiliate address (lowercased).
 */
@Entity_()
export class AffiliateStat {
    constructor(props?: Partial<AffiliateStat>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @StringColumn_({nullable: false})
    affiliate!: string

    @BigIntColumn_({nullable: false})
    volumeUsd!: bigint

    @IntColumn_({nullable: false})
    tradesCount!: number

    /**
     * Distinct referred traders that have opened at least one position — the funded-referral count.
     */
    @IntColumn_({nullable: false})
    referredTradersCount!: number

    @BigIntColumn_({nullable: false})
    feesGeneratedUsd!: bigint

    @BigIntColumn_({nullable: false})
    totalRebateUsd!: bigint

    @BigIntColumn_({nullable: false})
    affiliateRewardUsd!: bigint

    @BigIntColumn_({nullable: false})
    traderDiscountUsd!: bigint

    @IntColumn_({nullable: false})
    firstTradeTimestamp!: number

    @Index_()
    @IntColumn_({nullable: false})
    lastTradeTimestamp!: number
}
