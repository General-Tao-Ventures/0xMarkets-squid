import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

/**
 * The attribution link: one row per (affiliate, trader) pair, created on that
 * trader's first fee-bearing trade under the affiliate's code.
 * id = `${affiliate}-${trader}`.
 */
@Entity_()
export class ReferredTrader {
    constructor(props?: Partial<ReferredTrader>) {
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
    @StringColumn_({nullable: false})
    referralCode!: string

    @Index_()
    @IntColumn_({nullable: false})
    firstTradeTimestamp!: number

    @Index_()
    @IntColumn_({nullable: false})
    lastTradeTimestamp!: number

    @BigIntColumn_({nullable: false})
    volumeUsd!: bigint

    @IntColumn_({nullable: false})
    tradesCount!: number

    @BigIntColumn_({nullable: false})
    feesPaidUsd!: bigint

    @BigIntColumn_({nullable: false})
    rebateGeneratedUsd!: bigint
}
