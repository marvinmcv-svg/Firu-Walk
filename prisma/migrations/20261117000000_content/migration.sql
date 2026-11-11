-- Phase 3 (growth) — content: owner/walker consent to appear on social media
-- and the landing page, and curated features ("Firu del mes", walker
-- spotlights). Additive only.

-- CreateEnum
CREATE TYPE "FeatureKind" AS ENUM ('FIRU_OF_MONTH', 'WALKER_SPOTLIGHT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mediaConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mediaConsentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WalkerProfile" ADD COLUMN     "spotlightConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "spotlightConsentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "kind" "FeatureKind" NOT NULL,
    "month" TEXT NOT NULL,
    "dogId" TEXT,
    "walkerId" TEXT,
    "headline" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "photoUrl" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feature_kind_published_month_idx" ON "Feature"("kind", "published", "month");

-- AddForeignKey
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_dogId_fkey" FOREIGN KEY ("dogId") REFERENCES "Dog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_walkerId_fkey" FOREIGN KEY ("walkerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

