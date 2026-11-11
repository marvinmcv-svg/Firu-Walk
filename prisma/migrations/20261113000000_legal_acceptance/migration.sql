-- Phase 1 step 8 — legal pages. Additive only: record which version of the
-- Terms/Privacy (users) and the Walker Agreement (walkers) was accepted.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" TEXT;

-- AlterTable
ALTER TABLE "WalkerProfile" ADD COLUMN "agreementAcceptedAt" TIMESTAMP(3),
ADD COLUMN "agreementVersion" TEXT;
