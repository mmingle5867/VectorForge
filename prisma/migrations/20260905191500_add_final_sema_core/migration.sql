-- Final local SEMA Core foundation.
-- The rejected fixed-width identity migration was never installed and is not
-- part of this migration chain.

CREATE TABLE "sema_core_identity_state" (
  "stateKey" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "nextLocalId" BIGINT NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sema_core_identity_state_pkey" PRIMARY KEY ("stateKey")
);

CREATE UNIQUE INDEX "sema_core_identity_state_installationId_key"
  ON "sema_core_identity_state"("installationId");

CREATE TABLE "sema_issued_identifiers" (
  "semaId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "localValue" BIGINT NOT NULL,
  "localCode" TEXT NOT NULL,
  "typeCode" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "sema_issued_identifiers_pkey" PRIMARY KEY ("semaId")
);

CREATE UNIQUE INDEX "sema_issued_identifiers_installationId_localValue_key"
  ON "sema_issued_identifiers"("installationId", "localValue");
CREATE INDEX "sema_issued_identifiers_installationId_localCode_idx"
  ON "sema_issued_identifiers"("installationId", "localCode");
CREATE INDEX "sema_issued_identifiers_typeCode_idx"
  ON "sema_issued_identifiers"("typeCode");
CREATE INDEX "sema_issued_identifiers_issuedAt_idx"
  ON "sema_issued_identifiers"("issuedAt");

CREATE TABLE "sema_core_commands" (
  "id" TEXT NOT NULL,
  "commandType" TEXT NOT NULL,
  "actorId" TEXT,
  "workspaceId" TEXT,
  "subjectIds" JSONB NOT NULL DEFAULT '[]',
  "context" JSONB NOT NULL DEFAULT '{}',
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sema_core_commands_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sema_core_commands_commandType_createdAt_idx" ON "sema_core_commands"("commandType", "createdAt");
CREATE INDEX "sema_core_commands_actorId_createdAt_idx" ON "sema_core_commands"("actorId", "createdAt");
CREATE INDEX "sema_core_commands_workspaceId_createdAt_idx" ON "sema_core_commands"("workspaceId", "createdAt");

CREATE TABLE "sema_core_executions" (
  "id" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "providerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "context" JSONB NOT NULL DEFAULT '{}',
  "error" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sema_core_executions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sema_core_executions_commandId_createdAt_idx" ON "sema_core_executions"("commandId", "createdAt");
CREATE INDEX "sema_core_executions_status_createdAt_idx" ON "sema_core_executions"("status", "createdAt");

CREATE TABLE "sema_core_events" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "commandId" TEXT,
  "executionId" TEXT,
  "subjectIds" JSONB NOT NULL DEFAULT '[]',
  "data" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sema_core_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sema_core_events_eventType_occurredAt_idx" ON "sema_core_events"("eventType", "occurredAt");
CREATE INDEX "sema_core_events_commandId_occurredAt_idx" ON "sema_core_events"("commandId", "occurredAt");
CREATE INDEX "sema_core_events_executionId_occurredAt_idx" ON "sema_core_events"("executionId", "occurredAt");

CREATE TABLE "sema_core_results" (
  "id" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "resultType" TEXT NOT NULL,
  "subjectIds" JSONB NOT NULL DEFAULT '[]',
  "data" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sema_core_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sema_core_results_executionId_createdAt_idx" ON "sema_core_results"("executionId", "createdAt");

CREATE TABLE "sema_core_audit_entries" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "commandId" TEXT,
  "executionId" TEXT,
  "subjectIds" JSONB NOT NULL DEFAULT '[]',
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sema_core_audit_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sema_core_audit_entries_action_occurredAt_idx" ON "sema_core_audit_entries"("action", "occurredAt");
CREATE INDEX "sema_core_audit_entries_actorId_occurredAt_idx" ON "sema_core_audit_entries"("actorId", "occurredAt");

CREATE TABLE "sema_core_capabilities" (
  "id" TEXT NOT NULL,
  "capabilityKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sema_core_capabilities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sema_core_capabilities_capabilityKey_key" ON "sema_core_capabilities"("capabilityKey");
CREATE INDEX "sema_core_capabilities_status_displayName_idx" ON "sema_core_capabilities"("status", "displayName");

ALTER TABLE "sema_core_executions" ADD CONSTRAINT "sema_core_executions_commandId_fkey"
  FOREIGN KEY ("commandId") REFERENCES "sema_core_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sema_core_events" ADD CONSTRAINT "sema_core_events_commandId_fkey"
  FOREIGN KEY ("commandId") REFERENCES "sema_core_commands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sema_core_events" ADD CONSTRAINT "sema_core_events_executionId_fkey"
  FOREIGN KEY ("executionId") REFERENCES "sema_core_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sema_core_results" ADD CONSTRAINT "sema_core_results_executionId_fkey"
  FOREIGN KEY ("executionId") REFERENCES "sema_core_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sema_core_audit_entries" ADD CONSTRAINT "sema_core_audit_entries_commandId_fkey"
  FOREIGN KEY ("commandId") REFERENCES "sema_core_commands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sema_core_audit_entries" ADD CONSTRAINT "sema_core_audit_entries_executionId_fkey"
  FOREIGN KEY ("executionId") REFERENCES "sema_core_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
