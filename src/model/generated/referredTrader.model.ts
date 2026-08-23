import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BooleanColumn as BooleanColumn_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

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

    /**
     * True once the trader has taken a fee-bearing fill. A row can exist without this: attaching a
     * code is recorded from ReferralStorage, trading is recorded from PositionFeesCollected, and the
     * two are separate events. Only funded traders count toward a tier.
     */
    @Index_()
    @BooleanColumn_({nullable: false})
    isFunded!: boolean

    /**
     * When the code was attached. Null for rows first seen through a fill rather than a registration.
     */
    @IntColumn_({nullable: true})
    registeredAt!: number | undefined | null

    /**
     * Null until the trader has actually traded.
     */
    @Index_()
    @IntColumn_({nullable: true})
    firstTradeTimestamp!: number | undefined | null

    @Index_()
    @IntColumn_({nullable: true})
    lastTradeTimestamp!: number | undefined | null

    @BigIntColumn_({nullable: false})
    volumeUsd!: bigint

    @IntColumn_({nullable: false})
    tradesCount!: number

    @BigIntColumn_({nullable: false})
    feesPaidUsd!: bigint

    @BigIntColumn_({nullable: false})
    rebateGeneratedUsd!: bigint
}
