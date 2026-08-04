CREATE TABLE "ussd_facility_directory" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL UNIQUE,
  "organizationName" TEXT NOT NULL,
  "facilityName" TEXT NOT NULL,
  "administrativeArea" TEXT NOT NULL,
  "address" TEXT,
  "phone" TEXT,
  "openingHours" JSONB,
  "programmeCategories" JSONB,
  "latitude" DECIMAL(9,6),
  "longitude" DECIMAL(9,6),
  "isTemporary" BOOLEAN NOT NULL DEFAULT false,
  "temporaryUntil" TIMESTAMPTZ(3),
  "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ussd_facility_directory_facility_org_key" UNIQUE ("facilityId", "organizationId"),
  CONSTRAINT "ussd_facility_directory_coordinates_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL)
    OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  ),
  CONSTRAINT "ussd_facility_directory_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "ussd_facility_directory_facility_fkey" FOREIGN KEY ("facilityId", "organizationId") REFERENCES "facilities"("id", "organizationId") ON DELETE CASCADE
);
CREATE INDEX "ussd_facility_directory_area_idx" ON "ussd_facility_directory"("administrativeArea", "isTemporary", "temporaryUntil");
