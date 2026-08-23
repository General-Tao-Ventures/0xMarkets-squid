module.exports = class Data1787087948380 {
    name = 'Data1787087948380'

    async up(db) {
        await db.query(`CREATE TABLE "affiliate_stat" ("id" character varying NOT NULL, "affiliate" text NOT NULL, "volume_usd" numeric NOT NULL, "trades_count" integer NOT NULL, "referred_traders_count" integer NOT NULL, "fees_generated_usd" numeric NOT NULL, "total_rebate_usd" numeric NOT NULL, "affiliate_reward_usd" numeric NOT NULL, "trader_discount_usd" numeric NOT NULL, "first_trade_timestamp" integer NOT NULL, "last_trade_timestamp" integer NOT NULL, CONSTRAINT "PK_2f7bfac3e8d76bc39379ccf2189" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_e9cb41ea5a1bcab50dd852c648" ON "affiliate_stat" ("affiliate") `)
        await db.query(`CREATE INDEX "IDX_abed9e9d0b95216d16fca98485" ON "affiliate_stat" ("last_trade_timestamp") `)
        await db.query(`CREATE TABLE "period_affiliate_stat" ("id" character varying NOT NULL, "affiliate" text NOT NULL, "period_start" integer NOT NULL, "volume_usd" numeric NOT NULL, "trades_count" integer NOT NULL, "fees_generated_usd" numeric NOT NULL, "affiliate_reward_usd" numeric NOT NULL, CONSTRAINT "PK_3cdf467102eebd9ce0ca7b79efe" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_701b4a0508c1a517e66e91f249" ON "period_affiliate_stat" ("affiliate") `)
        await db.query(`CREATE INDEX "IDX_c46882222276a4d6be71cda1c6" ON "period_affiliate_stat" ("period_start") `)
        await db.query(`CREATE TABLE "referred_trader" ("id" character varying NOT NULL, "affiliate" text NOT NULL, "trader" text NOT NULL, "referral_code" text NOT NULL, "first_trade_timestamp" integer NOT NULL, "last_trade_timestamp" integer NOT NULL, "volume_usd" numeric NOT NULL, "trades_count" integer NOT NULL, "fees_paid_usd" numeric NOT NULL, "rebate_generated_usd" numeric NOT NULL, CONSTRAINT "PK_5a888ae817c28a545d222c96320" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_2b56f6f49d157f2b246ef3414b" ON "referred_trader" ("affiliate") `)
        await db.query(`CREATE INDEX "IDX_d5b92a1ffc758ea61020cda75b" ON "referred_trader" ("trader") `)
        await db.query(`CREATE INDEX "IDX_91a680268ac6a3d88b6832c702" ON "referred_trader" ("referral_code") `)
        await db.query(`CREATE INDEX "IDX_f307e7b981c1b119818e90ebe3" ON "referred_trader" ("first_trade_timestamp") `)
        await db.query(`CREATE INDEX "IDX_3940c9706d878409a62caf15bd" ON "referred_trader" ("last_trade_timestamp") `)
        await db.query(`CREATE TABLE "affiliate_reward" ("id" character varying NOT NULL, "affiliate" text NOT NULL, "market" text NOT NULL, "token" text NOT NULL, "delta" numeric NOT NULL, "next_value" numeric NOT NULL, "is_claim" boolean NOT NULL, "timestamp" integer NOT NULL, "transaction_id" character varying, CONSTRAINT "PK_cc93b004e87f8b5c837d9929443" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_894d54c2418b57db757abe419c" ON "affiliate_reward" ("affiliate") `)
        await db.query(`CREATE INDEX "IDX_86d12ca4b07803589911e6671b" ON "affiliate_reward" ("market") `)
        await db.query(`CREATE INDEX "IDX_a7ca21c50e99f8637f3dffe6b4" ON "affiliate_reward" ("token") `)
        await db.query(`CREATE INDEX "IDX_d3b3fc1317546e67c837da1763" ON "affiliate_reward" ("is_claim") `)
        await db.query(`CREATE INDEX "IDX_c4558e2b32944dc5057e3813e0" ON "affiliate_reward" ("transaction_id") `)
        await db.query(`CREATE INDEX "IDX_52cf86e2a2b8dc9a13bfbd79b4" ON "affiliate_reward" ("timestamp") `)
        await db.query(`ALTER TABLE "affiliate_reward" ADD CONSTRAINT "FK_c4558e2b32944dc5057e3813e02" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
    }

    async down(db) {
        await db.query(`DROP TABLE "affiliate_stat"`)
        await db.query(`DROP INDEX "public"."IDX_e9cb41ea5a1bcab50dd852c648"`)
        await db.query(`DROP INDEX "public"."IDX_abed9e9d0b95216d16fca98485"`)
        await db.query(`DROP TABLE "period_affiliate_stat"`)
        await db.query(`DROP INDEX "public"."IDX_701b4a0508c1a517e66e91f249"`)
        await db.query(`DROP INDEX "public"."IDX_c46882222276a4d6be71cda1c6"`)
        await db.query(`DROP TABLE "referred_trader"`)
        await db.query(`DROP INDEX "public"."IDX_2b56f6f49d157f2b246ef3414b"`)
        await db.query(`DROP INDEX "public"."IDX_d5b92a1ffc758ea61020cda75b"`)
        await db.query(`DROP INDEX "public"."IDX_91a680268ac6a3d88b6832c702"`)
        await db.query(`DROP INDEX "public"."IDX_f307e7b981c1b119818e90ebe3"`)
        await db.query(`DROP INDEX "public"."IDX_3940c9706d878409a62caf15bd"`)
        await db.query(`DROP TABLE "affiliate_reward"`)
        await db.query(`DROP INDEX "public"."IDX_894d54c2418b57db757abe419c"`)
        await db.query(`DROP INDEX "public"."IDX_86d12ca4b07803589911e6671b"`)
        await db.query(`DROP INDEX "public"."IDX_a7ca21c50e99f8637f3dffe6b4"`)
        await db.query(`DROP INDEX "public"."IDX_d3b3fc1317546e67c837da1763"`)
        await db.query(`DROP INDEX "public"."IDX_c4558e2b32944dc5057e3813e0"`)
        await db.query(`DROP INDEX "public"."IDX_52cf86e2a2b8dc9a13bfbd79b4"`)
        await db.query(`ALTER TABLE "affiliate_reward" DROP CONSTRAINT "FK_c4558e2b32944dc5057e3813e02"`)
    }
}
