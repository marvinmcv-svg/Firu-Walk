-- Milestone 8 — safety & ops. Additive only: SOS/late incidents get position,
-- walker and resolution fields; walks get reminder/late/backup-walker state;
-- admin-managed vets; scheduled-job lock + run history.

-- AlterTable
ALTER TABLE "IncidentLog" ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT,
ADD COLUMN     "subjectUserId" TEXT;

-- AlterTable
ALTER TABLE "Walk" ADD COLUMN     "backupCandidatesJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "backupExpiresAt" TIMESTAMP(3),
ADD COLUMN     "backupIdx" INTEGER NOT NULL DEFAULT -1,
ADD COLUMN     "backupWalkerId" TEXT,
ADD COLUMN     "lateAlertedAt" TIMESTAMP(3),
ADD COLUMN     "originalWalkerId" TEXT,
ADD COLUMN     "reassignedAt" TIMESTAMP(3),
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Vet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "open24h" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLock" (
    "job" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),

    CONSTRAINT "JobLock_pkey" PRIMARY KEY ("job")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_job_startedAt_idx" ON "JobRun"("job", "startedAt");

-- CreateIndex
CREATE INDEX "IncidentLog_status_createdAt_idx" ON "IncidentLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentLog_walkId_idx" ON "IncidentLog"("walkId");

-- CreateIndex
CREATE INDEX "IncidentLog_subjectUserId_type_idx" ON "IncidentLog"("subjectUserId", "type");

-- CreateIndex
CREATE INDEX "Walk_status_scheduledStart_idx" ON "Walk"("status", "scheduledStart");

-- CreateIndex
CREATE INDEX "Walk_backupWalkerId_idx" ON "Walk"("backupWalkerId");

