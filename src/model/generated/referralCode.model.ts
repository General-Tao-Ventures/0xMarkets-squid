import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"

/**
 * Code ownership, read from ReferralStorage rather than inferred. Needed to attribute a trader who
 * has attached a code but not yet traded — at that point no fee event exists to carry the affiliate.
 */
@Entity_()
export class ReferralCode {
    constructor(props?: Partial<ReferralCode>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    /**
     * bytes32, right-padded.
     */
    @Index_()
    @StringColumn_({nullable: false})
    code!: string

    @Index_()
    @StringColumn_({nullable: false})
    owner!: string

    @IntColumn_({nullable: false})
    registeredAt!: number

    @IntColumn_({nullable: false})
    blockNumber!: number
}
