-- M1: soft-archive support for projects.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
