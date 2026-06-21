-- Repo ingest (M12): bring an existing codebase into a project as documents.

-- CreateEnum
CREATE TYPE "RepoIngestKind" AS ENUM ('LOCAL', 'GITHUB');

-- CreateEnum
CREATE TYPE "RepoFileKind" AS ENUM ('DOC', 'CODE', 'CONFIG', 'BINARY_SKIPPED');

-- AlterEnum
ALTER TYPE "GenerationJobKind" ADD VALUE 'REPO_INGEST';

-- AlterTable
ALTER TABLE "document" ADD COLUMN "sourcePath" TEXT;

-- CreateIndex
CREATE INDEX "document_projectId_sourcePath_idx" ON "document"("projectId", "sourcePath");

-- CreateTable
CREATE TABLE "repo_ingest_source" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "RepoIngestKind" NOT NULL,
    "ref" TEXT NOT NULL,
    "branch" TEXT,
    "tokenCipher" BYTEA,
    "tokenIv" BYTEA,
    "tokenTag" BYTEA,
    "lastIngestAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_ingest_source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repo_ingest_source_projectId_key" ON "repo_ingest_source"("projectId");

-- AddForeignKey
ALTER TABLE "repo_ingest_source" ADD CONSTRAINT "repo_ingest_source_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "repo_file" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "kind" "RepoFileKind" NOT NULL,
    "summary" TEXT,
    "summaryModel" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repo_file_projectId_path_key" ON "repo_file"("projectId", "path");

-- CreateIndex
CREATE INDEX "repo_file_projectId_kind_idx" ON "repo_file"("projectId", "kind");

-- AddForeignKey
ALTER TABLE "repo_file" ADD CONSTRAINT "repo_file_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
