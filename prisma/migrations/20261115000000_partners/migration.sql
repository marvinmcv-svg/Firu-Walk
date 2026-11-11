-- Phase 3 (growth) — partner program: partner codes, owner attribution.
-- Additive only.

-- CreateEnum
CREATE TYPE "PartnerKind" AS ENUM ('VET', 'PETSHOP', 'GROOMER', 'CONDO', 'RELOCATION', 'OTHER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "partnerId" TEXT,
ADD COLUMN     "partnerRewardedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PartnerKind" NOT NULL,
    "code" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "zoneId" TEXT,
    "notes" TEXT,
    "referralFeeCents" INTEGER NOT NULL DEFAULT 0,
    "giftWalk" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_code_key" ON "Partner"("code");

-- CreateIndex
CREATE INDEX "User_partnerId_idx" ON "User"("partnerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

