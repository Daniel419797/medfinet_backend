CREATE TYPE "LocalizationContentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

UPDATE "caregivers"
SET "preferredLanguage" = CASE
  WHEN lower(trim("preferredLanguage")) IN ('en', 'english') THEN 'en'
  WHEN lower(trim("preferredLanguage")) IN ('ha', 'hausa') THEN 'ha'
  WHEN lower(trim("preferredLanguage")) IN ('yo', 'yoruba') THEN 'yo'
  WHEN lower(trim("preferredLanguage")) IN ('ig', 'igbo') THEN 'ig'
  ELSE 'en'
END;

ALTER TABLE "caregivers"
  ALTER COLUMN "preferredLanguage" SET DEFAULT 'en',
  ALTER COLUMN "preferredLanguage" SET NOT NULL;
ALTER TABLE "caregivers"
  ADD CONSTRAINT "caregivers_preferred_language_check"
  CHECK ("preferredLanguage" IN ('en', 'ha', 'yo', 'ig'));

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_locale_check"
  CHECK ("locale" IN ('en', 'ha', 'yo', 'ig'));
ALTER TABLE "notification_templates"
  ADD CONSTRAINT "notification_templates_locale_check"
  CHECK ("locale" IN ('en', 'ha', 'yo', 'ig'));
ALTER TABLE "notification_messages"
  ADD CONSTRAINT "notification_messages_locale_check"
  CHECK ("locale" IN ('en', 'ha', 'yo', 'ig'));

CREATE TABLE "localization_content" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contentKey" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "translatorNote" TEXT,
  "version" INTEGER NOT NULL,
  "status" "LocalizationContentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdBySubjectId" TEXT NOT NULL,
  "approvedBySubjectId" TEXT,
  "approvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "localization_content_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "localization_content_key_check"
    CHECK ("contentKey" ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,7}$'),
  CONSTRAINT "localization_content_locale_check"
    CHECK ("locale" IN ('en', 'ha', 'yo', 'ig')),
  CONSTRAINT "localization_content_version_check" CHECK ("version" > 0),
  CONSTRAINT "localization_content_value_check"
    CHECK (char_length("value") BETWEEN 1 AND 4000),
  CONSTRAINT "localization_content_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "approvedBySubjectId" IS NULL AND "approvedAt" IS NULL)
    OR (
      "status" IN ('ACTIVE', 'RETIRED')
      AND "approvedBySubjectId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "localization_content_organizationId_contentKey_locale_version_key"
  ON "localization_content"("organizationId", "contentKey", "locale", "version");
CREATE UNIQUE INDEX "localization_content_id_organizationId_key"
  ON "localization_content"("id", "organizationId");
CREATE INDEX "localization_content_organizationId_locale_status_contentKey_idx"
  ON "localization_content"("organizationId", "locale", "status", "contentKey");
CREATE UNIQUE INDEX "localization_content_one_active_translation"
  ON "localization_content"("organizationId", "contentKey", "locale")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "localization_content"
  ADD CONSTRAINT "localization_content_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "localization_content" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "localization_content" FORCE ROW LEVEL SECURITY;
CREATE POLICY "localization_content_tenant_isolation"
  ON "localization_content"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
