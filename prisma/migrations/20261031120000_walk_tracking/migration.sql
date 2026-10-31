-- Milestone 4: real GPS tracking — idempotent track uploads, validation
-- results, geofence distances and admin overrides.

-- AlterTable
ALTER TABLE "Walk" ADD COLUMN     "endDistanceM" DOUBLE PRECISION,
ADD COLUMN     "endOverride" TEXT,
ADD COLUMN     "mockLocation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rejectedPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startDistanceM" DOUBLE PRECISION,
ADD COLUMN     "startOverride" TEXT;

-- AlterTable
ALTER TABLE "WalkTrackPoint" ADD COLUMN     "accuracyM" DOUBLE PRECISION,
ADD COLUMN     "mocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "rejectReason" TEXT;

-- DropIndex
DROP INDEX "WalkTrackPoint_walkId_seq_idx";

-- CreateIndex
CREATE UNIQUE INDEX "WalkTrackPoint_walkId_seq_key" ON "WalkTrackPoint"("walkId", "seq");
