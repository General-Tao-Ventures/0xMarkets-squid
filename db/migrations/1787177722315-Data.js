module.exports = class Data1787177722315 {
    name = 'Data1787177722315'

    async up(db) {
        await db.query(`CREATE TABLE "referral_code" ("id" character varying NOT NULL, "code" text NOT NULL, "owner" text NOT NULL, "registered_at" integer NOT NULL, "block_number" integer NOT NULL, CONSTRAINT "PK_669df184f201c602c986bacd804" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_e2228930b1cc8b983445357b1b" ON "referral_code" ("code") `)
        await db.query(`CREATE INDEX "IDX_a32d05849e712f11d4d39c5927" ON "referral_code" ("owner") `)
        // Backfill rather than a bare NOT NULL add: every pre-existing row came from a fill, so it is
        // funded by definition. A bare add would fail on any table that already has rows.
        await db.query(`ALTER TABLE "referred_trader" ADD "is_funded" boolean NOT NULL DEFAULT false`)
        await db.query(`UPDATE "referred_trader" SET "is_funded" = true WHERE "trades_count" > 0`)
        await db.query(`ALTER TABLE "referred_trader" ALTER COLUMN "is_funded" DROP DEFAULT`)
        await db.query(`ALTER TABLE "referred_trader" ADD "registered_at" integer`)
        await db.query(`ALTER TABLE "referred_trader" ALTER COLUMN "first_trade_timestamp" DROP NOT NULL`)
        await db.query(`ALTER TABLE "referred_trader" ALTER COLUMN "last_trade_timestamp" DROP NOT NULL`)
        await db.query(`CREATE INDEX "IDX_d66ce167f3cd21e17e31da289d" ON "referred_trader" ("is_funded") `)
    }

    async down(db) {
        await db.query(`DROP TABLE "referral_code"`)
        await db.query(`DROP INDEX "public"."IDX_e2228930b1cc8b983445357b1b"`)
        await db.query(`DROP INDEX "public"."IDX_a32d05849e712f11d4d39c5927"`)
        await db.query(`ALTER TABLE "referred_trader" DROP COLUMN "is_funded"`)
        await db.query(`ALTER TABLE "referred_trader" DROP COLUMN "registered_at"`)
        await db.query(`ALTER TABLE "referred_trader" ALTER COLUMN "first_trade_timestamp" SET NOT NULL`)
        await db.query(`ALTER TABLE "referred_trader" ALTER COLUMN "last_trade_timestamp" SET NOT NULL`)
        await db.query(`DROP INDEX "public"."IDX_d66ce167f3cd21e17e31da289d"`)
    }
}
