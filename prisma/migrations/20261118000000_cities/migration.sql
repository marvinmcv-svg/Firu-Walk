-- Phase 3 (growth) — multi-city: cities with their own walk lengths, base
-- prices and peak hours; every zone belongs to a city. Existing zones move to
-- Santa Cruz de la Sierra, which keeps the prices set in Config → pricing.
-- Additive for running code: Zone.city stays (legacy label).

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "price30Cents" INTEGER NOT NULL DEFAULT 1500,
    "price45Cents" INTEGER NOT NULL DEFAULT 2000,
    "price60Cents" INTEGER NOT NULL DEFAULT 2500,
    "durationsJson" TEXT NOT NULL DEFAULT '[30,45,60]',
    "peakJson" TEXT NOT NULL DEFAULT '[[360,540],[1050,1200]]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "City_key_key" ON "City"("key");

-- Seed Santa Cruz (live since launch) with the configured prices.
INSERT INTO "City" ("id", "key", "name", "centerLat", "centerLng", "active", "sortOrder",
                    "price30Cents", "price45Cents", "price60Cents", "updatedAt")
SELECT 'city_santa_cruz', 'santa-cruz', 'Santa Cruz de la Sierra', -17.7833, -63.1821, true, 0,
       COALESCE((c."valueJson"::jsonb ->> 'price30Cents')::int, 1500),
       COALESCE((c."valueJson"::jsonb ->> 'price45Cents')::int, 2000),
       COALESCE((c."valueJson"::jsonb ->> 'price60Cents')::int, 2500),
       CURRENT_TIMESTAMP
FROM (SELECT 1) AS one
LEFT JOIN "Config" c ON c."key" = 'pricing';

-- AlterTable: every zone belongs to a city
ALTER TABLE "Zone" ADD COLUMN "cityId" TEXT;
UPDATE "Zone" SET "cityId" = 'city_santa_cruz';
ALTER TABLE "Zone" ALTER COLUMN "cityId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Zone_cityId_idx" ON "Zone"("cityId");

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
