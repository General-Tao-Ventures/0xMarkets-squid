import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, ManyToOne as ManyToOne_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {Transaction} from "./transaction.model"

/**
 * Affiliate reward ledger from AffiliateRewardUpdated (credit) and
 * AffiliateRewardClaimed (withdrawal). Both emit scalar items, which the generic
 * Distribution handler cannot capture — it reads array items, so the amounts were
 * being silently dropped.
 */
@Entity_()
export class AffiliateReward {
    constructor(props?: Partial<AffiliateReward>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @StringColumn_({nullable: false})
    affiliate!: string

    @Index_()
    @StringColumn_({nullable: false})
    market!: string

    @Index_()
    @StringColumn_({nullable: false})
    token!: string

    /**
     * Amount credited (Updated) or claimed (Claimed), in collateral token terms.
     */
    @BigIntColumn_({nullable: false})
    delta!: bigint

    @BigIntColumn_({nullable: false})
    nextValue!: bigint

    @Index_()
    @BooleanColumn_({nullable: false})
    isClaim!: boolean

    @Index_()
    @ManyToOne_(() => Transaction, {nullable: true})
    transaction!: Transaction

    @Index_()
    @IntColumn_({nullable: false})
    timestamp!: number
}
