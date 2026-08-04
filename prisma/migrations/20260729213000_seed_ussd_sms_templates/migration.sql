INSERT INTO "notification_templates" (
  "id", "organizationId", "key", "version", "locale", "channel", "status",
  "body", "variableNames", "createdBySubjectId", "activatedBySubjectId", "activatedAt",
  "createdAt", "updatedAt"
)
SELECT
  'ussdloc' || substr(md5(o."id" || translations.locale), 1, 18),
  o."id",
  'USSD_FACILITY_DETAILS',
  1,
  translations.locale,
  'SMS'::"NotificationChannel",
  'ACTIVE'::"NotificationTemplateStatus",
  translations.body,
  '["facilityName","address","phone","openingHours","programmes"]'::jsonb,
  'system:ussd-migration',
  'system:ussd-migration',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('en', '{{facilityName}}. Address: {{address}}. Phone: {{phone}}. Hours: {{openingHours}}. Programmes: {{programmes}}.'),
  ('ha', '{{facilityName}}. Adireshi: {{address}}. Waya: {{phone}}. Lokaci: {{openingHours}}. Shirye-shirye: {{programmes}}.'),
  ('yo', '{{facilityName}}. Adiresi: {{address}}. Foonu: {{phone}}. Akoko: {{openingHours}}. Eto: {{programmes}}.'),
  ('ig', '{{facilityName}}. Adreesi: {{address}}. Ekwenti: {{phone}}. Oge: {{openingHours}}. Mmemme: {{programmes}}.')
) AS translations(locale, body)
ON CONFLICT ("organizationId", "key", "version", "locale", "channel") DO NOTHING;
