-- Milestone 7 — walker vetting & documents.
-- Documents move to private object storage (WalkerDocument); the CI number
-- is encrypted at rest by the app, so the plaintext column is dropped after
-- keeping its last 4 digits for display. Public document URL columns go too.

-- CreateEnum
CREATE TYPE "WalkerDocKind" AS ENUM ('CI_FRONT', 'CI_BACK', 'SELFIE', 'BACKGROUND_CERT', 'VIDEO_INTRO');

-- New vetting columns
ALTER TABLE "WalkerProfile"
ADD COLUMN "idDocCipher" TEXT,
ADD COLUMN "idDocLast4" TEXT,
ADD COLUMN "reviewIdentityOk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reviewBackgroundOk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reviewInterviewDone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reviewTrialWalkDone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reviewNotes" TEXT,
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- Keep only the last 4 digits of any existing plaintext CI number.
UPDATE "WalkerProfile"
SET "idDocLast4" = RIGHT(REGEXP_REPLACE("idDocNumber", '[^0-9]', '', 'g'), 4)
WHERE "idDocNumber" IS NOT NULL
  AND LENGTH(REGEXP_REPLACE("idDocNumber", '[^0-9]', '', 'g')) >= 4;

-- Walkers approved before the checklist existed were vetted by hand: grandfather them.
UPDATE "WalkerProfile"
SET "reviewIdentityOk" = true, "reviewBackgroundOk" = true,
    "reviewInterviewDone" = true, "reviewTrialWalkDone" = true,
    "reviewedAt" = COALESCE("approvedAt", CURRENT_TIMESTAMP),
    "reviewNotes" = 'Aprobado antes del checklist de verificación (migración M7).'
WHERE "status" IN ('ACTIVE', 'SUSPENDED');

-- Drop plaintext / public document columns.
ALTER TABLE "WalkerProfile"
DROP COLUMN "idDocNumber",
DROP COLUMN "idPhotoUrl",
DROP COLUMN "selfieUrl",
DROP COLUMN "videoIntroUrl";

-- CreateTable
CREATE TABLE "WalkerDocument" (
    "id" TEXT NOT NULL,
    "walkerId" TEXT NOT NULL,
    "kind" "WalkerDocKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalkerDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WalkerDocument_storageKey_key" ON "WalkerDocument"("storageKey");
CREATE INDEX "WalkerDocument_walkerId_kind_idx" ON "WalkerDocument"("walkerId", "kind");
ALTER TABLE "WalkerDocument" ADD CONSTRAINT "WalkerDocument_walkerId_fkey" FOREIGN KEY ("walkerId") REFERENCES "WalkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
