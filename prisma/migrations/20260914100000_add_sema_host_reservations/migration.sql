CREATE TABLE "sema_identifier_reservations" (
  "id" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "firstLocalValue" BIGINT NOT NULL,
  "count" INTEGER NOT NULL,
  "typeCode" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sema_identifier_reservations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sema_issued_identifiers"
  ADD COLUMN "reservationId" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ISSUED',
  ADD COLUMN "consumedAt" TIMESTAMP(3);

CREATE INDEX "sema_identifier_reservations_installationId_createdAt_idx"
  ON "sema_identifier_reservations"("installationId", "createdAt");
CREATE INDEX "sema_issued_identifiers_reservationId_status_idx"
  ON "sema_issued_identifiers"("reservationId", "status");

ALTER TABLE "sema_issued_identifiers"
  ADD CONSTRAINT "sema_issued_identifiers_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "sema_identifier_reservations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sema_core_host_settings" (
  "settingsKey" TEXT NOT NULL DEFAULT 'PRIMARY',
  "installationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "maxReservationSize" INTEGER NOT NULL DEFAULT 100,
  "auditRetentionDays" INTEGER NOT NULL DEFAULT 3650,
  "eventRetentionDays" INTEGER NOT NULL DEFAULT 3650,
  "capabilityAutoFallback" BOOLEAN NOT NULL DEFAULT true,
  "documentationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sema_core_host_settings_pkey" PRIMARY KEY ("settingsKey")
);
CREATE UNIQUE INDEX "sema_core_host_settings_installationId_key"
  ON "sema_core_host_settings"("installationId");
