-- Phase 3 (growth) — group walks: walker-offered slots, bookings join them.
-- Additive only.

-- CreateEnum
CREATE TYPE "GroupSlotStatus" AS ENUM ('OPEN', 'CANCELLED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "commissionPct" DOUBLE PRECISION,
ADD COLUMN     "groupSlotId" TEXT;

-- AlterTable
ALTER TABLE "Walk" ADD COLUMN     "groupSlotId" TEXT;

-- CreateTable
CREATE TABLE "GroupSlot" (
    "id" TEXT NOT NULL,
    "walkerId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "sizesJson" TEXT NOT NULL DEFAULT '["S","M","L"]',
    "pricePerDogCents" INTEGER NOT NULL,
    "walkerPerDogCents" INTEGER NOT NULL,
    "status" "GroupSlotStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupSlot_zoneId_status_startsAt_idx" ON "GroupSlot"("zoneId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "GroupSlot_walkerId_startsAt_idx" ON "GroupSlot"("walkerId", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_groupSlotId_idx" ON "Booking"("groupSlotId");

-- CreateIndex
CREATE INDEX "Walk_groupSlotId_status_idx" ON "Walk"("groupSlotId", "status");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_groupSlotId_fkey" FOREIGN KEY ("groupSlotId") REFERENCES "GroupSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

