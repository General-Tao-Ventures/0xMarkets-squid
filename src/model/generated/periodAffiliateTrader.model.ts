import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"

/**
 * One row per (affiliate, day, trader). Exists purely so `tradersActive` can be counted without
 * double counting a trader who fills several times in a day — a running counter alone cannot know
 * whether a trader has already been seen in that period, and the batch that sees them may not be the
 * batch that created the bucket.
 */
@Entity_()
export class PeriodAffiliateTrader {
    constructor(props?: Partial<PeriodAffiliateTrader>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @StringColumn_({nullable: false})
    affiliate!: string

    @Index_()
    @StringColumn_({nullable: false})
    trader!: string

    @Index_()
    @IntColumn_({nullable: false})
    periodStart!: number
}
