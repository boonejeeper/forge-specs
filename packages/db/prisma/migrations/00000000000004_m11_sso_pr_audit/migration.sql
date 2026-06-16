-- M11: Enterprise — SSO providers, GitHub PR linkage, audit enum hardening.

-- Extend ActivityType with security/audit-relevant actions.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'MEMBER_ROLE_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'VERSION_RESTORED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'TEMPLATE_APPLIED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'SSO_LOGIN';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PR_LINKED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PR_STATUS_CHANGED';

-- CreateEnum
CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'CLOSED', 'MERGED', 'DRAFT');

-- CreateTable: SSO providers (managed by @better-auth/sso)
CREATE TABLE "sso_provider" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "oidcConfig" TEXT,
    "samlConfig" TEXT,
    "userId" TEXT,
    "providerId" TEXT NOT NULL,
    "organizationId" TEXT,
    "domain" TEXT NOT NULL,

    CONSTRAINT "sso_provider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_provider_providerId_key" ON "sso_provider"("providerId");

-- CreateIndex
CREATE INDEX "sso_provider_userId_idx" ON "sso_provider"("userId");

-- AddForeignKey
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: GitHub PR linkage
CREATE TABLE "pull_request_link" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdById" TEXT,
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "state" "PullRequestState" NOT NULL DEFAULT 'OPEN',
    "merged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pull_request_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pull_request_link_documentId_repoOwner_repoName_number_key" ON "pull_request_link"("documentId", "repoOwner", "repoName", "number");

-- CreateIndex
CREATE INDEX "pull_request_link_repoOwner_repoName_number_idx" ON "pull_request_link"("repoOwner", "repoName", "number");

-- CreateIndex
CREATE INDEX "pull_request_link_documentId_idx" ON "pull_request_link"("documentId");

-- AddForeignKey
ALTER TABLE "pull_request_link" ADD CONSTRAINT "pull_request_link_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_request_link" ADD CONSTRAINT "pull_request_link_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
