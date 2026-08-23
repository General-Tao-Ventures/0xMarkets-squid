import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

/**
 * Daily bucket per affiliate. id = `${affiliate}-1d-${dayTs}`.
 * A rolling 30-day figure is a query over these (periodStart_gte), not a stored column.
 */
@Entity_()
export class PeriodAffiliateStat {
    constructor(props?: Partial<PeriodAffiliateStat>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @StringColumn_({nullable: false})
    affiliate!: string

    @Index_()
    @IntColumn_({nullable: false})
    periodStart!: number

    @BigIntColumn_({nullable: false})
    volumeUsd!: bigint

    @IntColumn_({nullable: false})
    tradesCount!: number

    /**
     * Distinct traders who transacted in this period. Maintained via PeriodAffiliateTrader.
     */
    @IntColumn_({nullable: false})
    tradersActive!: number

    @BigIntColumn_({nullable: false})
    feesGeneratedUsd!: bigint

    @BigIntColumn_({nullable: false})
    affiliateRewardUsd!: bigint
}
