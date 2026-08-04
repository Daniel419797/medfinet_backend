CREATE TYPE "CredentialKind" AS ENUM ('QR', 'NFC', 'RECOVERY');
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'ROTATED');
CREATE TYPE "ClinicalRecordStatus" AS ENUM ('ACTIVE', 'ENTERED_IN_ERROR', 'AMENDED');
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR');
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'MISSED');

CREATE TABLE "child_credentials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" "CredentialKind" NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedBySubjectId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" TEXT,
    "replacesCredentialId" TEXT,
    "lastScannedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "child_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "child_credentials_revocation_check" CHECK (
        ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedReason" IS NOT NULL)
        OR ("status" <> 'REVOKED')
    )
);

CREATE TABLE "credential_scans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "actorSubjectId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "deviceId" TEXT,
    "scannedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credential_scans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "immunization_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "facilityId" TEXT,
    "programmeId" TEXT,
    "vaccineCode" TEXT NOT NULL,
    "doseNumber" INTEGER NOT NULL,
    "administeredAt" TIMESTAMPTZ(3) NOT NULL,
    "lotNumber" TEXT,
    "route" TEXT,
    "site" TEXT,
    "notes" TEXT,
    "sourceOperationId" TEXT,
    "administeringSubjectId" TEXT NOT NULL,
    "status" "ClinicalRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "immunization_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "immunization_records_dose_check" CHECK ("doseNumber" BETWEEN 1 AND 20)
);

CREATE TABLE "growth_measurements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "facilityId" TEXT,
    "measuredAt" TIMESTAMPTZ(3) NOT NULL,
    "weightGrams" INTEGER,
    "heightMillimeters" INTEGER,
    "muacMillimeters" INTEGER,
    "vitaminAAdministered" BOOLEAN NOT NULL DEFAULT false,
    "oedemaPresent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sourceOperationId" TEXT,
    "recordedBySubjectId" TEXT NOT NULL,
    "status" "ClinicalRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "growth_measurements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "growth_measurements_values_check" CHECK (
        ("weightGrams" IS NULL OR "weightGrams" BETWEEN 1 AND 300000)
        AND ("heightMillimeters" IS NULL OR "heightMillimeters" BETWEEN 1 AND 2500)
        AND ("muacMillimeters" IS NULL OR "muacMillimeters" BETWEEN 1 AND 1000)
        AND (
            "weightGrams" IS NOT NULL
            OR "heightMillimeters" IS NOT NULL
            OR "muacMillimeters" IS NOT NULL
            OR "vitaminAAdministered"
        )
    )
);

CREATE TABLE "clinical_alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "summary" TEXT NOT NULL,
    "emergencyVisible" BOOLEAN NOT NULL DEFAULT false,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBySubjectId" TEXT NOT NULL,
    "resolvedBySubjectId" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "clinical_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clinical_alerts_resolution_check" CHECK (
        ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND "resolvedBySubjectId" IS NOT NULL)
        OR ("status" <> 'RESOLVED')
    )
);

CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "facilityId" TEXT,
    "kind" TEXT NOT NULL,
    "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "sourceOperationId" TEXT,
    "createdBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinical_amendments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "immunizationId" TEXT,
    "growthMeasurementId" TEXT,
    "reason" TEXT NOT NULL,
    "previousData" JSONB NOT NULL,
    "replacementData" JSONB NOT NULL,
    "amendedBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clinical_amendments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clinical_amendments_target_check" CHECK (
        ("immunizationId" IS NOT NULL)::INTEGER
        + ("growthMeasurementId" IS NOT NULL)::INTEGER = 1
    )
);

CREATE UNIQUE INDEX "child_credentials_tokenHash_key" ON "child_credentials"("tokenHash");
CREATE UNIQUE INDEX "child_credentials_id_organizationId_key" ON "child_credentials"("id", "organizationId");
CREATE UNIQUE INDEX "child_credentials_replacesCredentialId_organizationId_key" ON "child_credentials"("replacesCredentialId", "organizationId");
CREATE INDEX "child_credentials_organizationId_childId_status_idx" ON "child_credentials"("organizationId", "childId", "status");
CREATE INDEX "credential_scans_organizationId_credentialId_scannedAt_idx" ON "credential_scans"("organizationId", "credentialId", "scannedAt");
CREATE UNIQUE INDEX "immunization_records_id_organizationId_key" ON "immunization_records"("id", "organizationId");
CREATE UNIQUE INDEX "immunization_records_organizationId_sourceOperationId_key" ON "immunization_records"("organizationId", "sourceOperationId");
CREATE INDEX "immunization_records_organizationId_childId_administeredAt_idx" ON "immunization_records"("organizationId", "childId", "administeredAt");
CREATE UNIQUE INDEX "growth_measurements_id_organizationId_key" ON "growth_measurements"("id", "organizationId");
CREATE UNIQUE INDEX "growth_measurements_organizationId_sourceOperationId_key" ON "growth_measurements"("organizationId", "sourceOperationId");
CREATE INDEX "growth_measurements_organizationId_childId_measuredAt_idx" ON "growth_measurements"("organizationId", "childId", "measuredAt");
CREATE INDEX "clinical_alerts_organizationId_childId_status_idx" ON "clinical_alerts"("organizationId", "childId", "status");
CREATE UNIQUE INDEX "appointments_organizationId_sourceOperationId_key" ON "appointments"("organizationId", "sourceOperationId");
CREATE INDEX "appointments_organizationId_childId_scheduledFor_idx" ON "appointments"("organizationId", "childId", "scheduledFor");
CREATE INDEX "appointments_organizationId_scheduledFor_status_idx" ON "appointments"("organizationId", "scheduledFor", "status");
CREATE INDEX "clinical_amendments_organizationId_createdAt_idx" ON "clinical_amendments"("organizationId", "createdAt");

-- Phase 1 originally keyed facilities and programmes by global id only. The
-- tenant-safe clinical foreign keys below require matching composite candidate
-- keys. These indexes are placed in the first migration that consumes them so
-- both fresh installs and legacy Phase-1 databases can advance safely.
CREATE UNIQUE INDEX IF NOT EXISTS "facilities_id_organizationId_key"
  ON "facilities"("id", "organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "programmes_id_organizationId_key"
  ON "programmes"("id", "organizationId");

ALTER TABLE "child_credentials" ADD CONSTRAINT "child_credentials_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "child_credentials" ADD CONSTRAINT "child_credentials_childId_organizationId_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_credentials" ADD CONSTRAINT "child_credentials_replacesCredentialId_organizationId_fkey" FOREIGN KEY ("replacesCredentialId", "organizationId") REFERENCES "child_credentials"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credential_scans" ADD CONSTRAINT "credential_scans_credentialId_organizationId_fkey" FOREIGN KEY ("credentialId", "organizationId") REFERENCES "child_credentials"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "immunization_records" ADD CONSTRAINT "immunization_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "immunization_records" ADD CONSTRAINT "immunization_records_childId_organizationId_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "immunization_records" ADD CONSTRAINT "immunization_records_facilityId_organizationId_fkey" FOREIGN KEY ("facilityId", "organizationId") REFERENCES "facilities"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "immunization_records" ADD CONSTRAINT "immunization_records_programmeId_organizationId_fkey" FOREIGN KEY ("programmeId", "organizationId") REFERENCES "programmes"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "growth_measurements" ADD CONSTRAINT "growth_measurements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "growth_measurements" ADD CONSTRAINT "growth_measurements_childId_organizationId_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "growth_measurements" ADD CONSTRAINT "growth_measurements_facilityId_organizationId_fkey" FOREIGN KEY ("facilityId", "organizationId") REFERENCES "facilities"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_alerts" ADD CONSTRAINT "clinical_alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_alerts" ADD CONSTRAINT "clinical_alerts_childId_organizationId_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_childId_organizationId_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_facilityId_organizationId_fkey" FOREIGN KEY ("facilityId", "organizationId") REFERENCES "facilities"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_amendments" ADD CONSTRAINT "clinical_amendments_immunizationId_organizationId_fkey" FOREIGN KEY ("immunizationId", "organizationId") REFERENCES "immunization_records"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_amendments" ADD CONSTRAINT "clinical_amendments_growthMeasurementId_organizationId_fkey" FOREIGN KEY ("growthMeasurementId", "organizationId") REFERENCES "growth_measurements"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'child_credentials',
        'credential_scans',
        'immunization_records',
        'growth_measurements',
        'clinical_alerts',
        'appointments',
        'clinical_amendments'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL USING ("organizationId" = public.medfinet_current_organization_id()) WITH CHECK ("organizationId" = public.medfinet_current_organization_id())',
            table_name || '_tenant_isolation',
            table_name
        );
    END LOOP;
END
$$;
