-- M7: AI generation jobs (resumable, crash-safe orchestration).

-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "GenerationJobKind" AS ENUM ('ARCHITECTURE', 'RFC', 'TASKS', 'EPICS', 'REPO_STRUCTURE', 'AGENT_PROMPTS');

-- CreateTable
CREATE TABLE "generation_job" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT,
    "kind" "GenerationJobKind" NOT NULL DEFAULT 'ARCHITECTURE',
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL DEFAULT '{}',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_job_projectId_idx" ON "generation_job"("projectId");

-- CreateIndex
CREATE INDEX "generation_job_status_idx" ON "generation_job"("status");

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
