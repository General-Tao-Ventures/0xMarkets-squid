module.exports = class Data1787178227412 {
    name = 'Data1787178227412'

    async up(db) {
        await db.query(`CREATE TABLE "period_affiliate_trader" ("id" character varying NOT NULL, "affiliate" text NOT NULL, "trader" text NOT NULL, "period_start" integer NOT NULL, CONSTRAINT "PK_7ad7c47eb6aa4ad23d045d1bb00" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_1829eb8993abd282f76103b259" ON "period_affiliate_trader" ("affiliate") `)
        await db.query(`CREATE INDEX "IDX_4f86ddaab4a0054ff3c314a7e4" ON "period_affiliate_trader" ("trader") `)
        await db.query(`CREATE INDEX "IDX_fb1ab3a907e3017cb8e3c2e26a" ON "period_affiliate_trader" ("period_start") `)
        // Default-then-drop so the add is safe on a populated table. Existing rows get 0 rather than a
        // guess: the per-trader marker rows they would need do not exist for past days, and inventing
        // a count would be worse than an obvious zero. A re-sync backfills them correctly.
        await db.query(`ALTER TABLE "period_affiliate_stat" ADD "traders_active" integer NOT NULL DEFAULT 0`)
        await db.query(`ALTER TABLE "period_affiliate_stat" ALTER COLUMN "traders_active" DROP DEFAULT`)
    }

    async down(db) {
        await db.query(`DROP TABLE "period_affiliate_trader"`)
        await db.query(`DROP INDEX "public"."IDX_1829eb8993abd282f76103b259"`)
        await db.query(`DROP INDEX "public"."IDX_4f86ddaab4a0054ff3c314a7e4"`)
        await db.query(`DROP INDEX "public"."IDX_fb1ab3a907e3017cb8e3c2e26a"`)
        await db.query(`ALTER TABLE "period_affiliate_stat" DROP COLUMN "traders_active"`)
    }
}
