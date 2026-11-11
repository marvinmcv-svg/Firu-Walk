-- Phase 2 (soft launch) — referrals ("Regalá un paseo"), acquisition channel
-- and Phase-0 import marker. Additive only.

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'VOID');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "gift" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acquisitionChannel" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "referralCode" TEXT;

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardCents" INTEGER NOT NULL DEFAULT 0,
    "referrerRewarded" BOOLEAN NOT NULL DEFAULT false,
    "rewardWalkId" TEXT,
    "refereeGiftId" TEXT,
    "referrerGiftId" TEXT,
    "rewardedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_refereeId_key" ON "Referral"("refereeId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_status_idx" ON "Referral"("referrerId", "status");

-- CreateIndex
CREATE INDEX "Referral_status_rewardedAt_idx" ON "Referral"("status", "rewardedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

