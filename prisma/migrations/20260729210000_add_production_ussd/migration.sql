ALTER TYPE "CredentialStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "NfcBindingStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

CREATE TYPE "UssdSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'BLOCKED');
CREATE TYPE "UssdAssurance" AS ENUM ('NONE', 'PHONE', 'PIN', 'OTP');
CREATE TYPE "UssdOtpPurpose" AS ENUM ('CONSENT_DECISION', 'CARD_SUSPENSION', 'CARD_REPLACEMENT', 'REWARD_REDEMPTION', 'PIN_RESET');
CREATE TYPE "UssdOtpStatus" AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED', 'BLOCKED');
CREATE TYPE "UssdRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AppointmentCaregiverDecision" AS ENUM ('CONFIRMED', 'RESCHEDULE_REQUESTED');
CREATE TYPE "UssdCallbackCategory" AS ENUM ('VACCINATION', 'NUTRITION', 'EMERGENCY', 'CARD_PROBLEM', 'GENERAL');
CREATE TYPE "NfcCardSupportType" AS ENUM ('LOST_CARD_SUSPENSION', 'REPLACEMENT_REQUEST');
CREATE TYPE "UssdConsentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "ProgrammeInterestCategory" AS ENUM ('VACCINATION', 'NUTRITION', 'CLIMATE_EMERGENCY', 'COMMUNITY_OUTREACH');
CREATE TYPE "ServiceDeliveryDecision" AS ENUM ('CONFIRMED', 'NOT_RECEIVED', 'DISPUTED');
CREATE TYPE "RewardConfirmationDecision" AS ENUM ('CONFIRMED', 'DECLINED', 'DISPUTED');
CREATE TYPE "ClimateAssistanceType" AS ENUM ('EVACUATION', 'HEALTH_SUPPORT', 'HOUSEHOLD_SAFETY', 'TEMPORARY_CLINIC', 'URGENT_NEED');

ALTER TABLE "facilities"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "openingHours" JSONB,
  ADD COLUMN "programmeCategories" JSONB,
  ADD COLUMN "latitude" DECIMAL(9,6),
  ADD COLUMN "longitude" DECIMAL(9,6),
  ADD COLUMN "isTemporary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "temporaryUntil" TIMESTAMPTZ(3),
  ADD CONSTRAINT "facilities_coordinates_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL)
    OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
  ),
  ADD CONSTRAINT "facilities_temporary_expiry_check" CHECK (
    "isTemporary" = true OR "temporaryUntil" IS NULL
  );

ALTER TABLE "caregivers"
  ADD COLUMN "phoneNormalized" TEXT,
  ADD COLUMN "phoneVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "ussdPinHash" TEXT,
  ADD COLUMN "ussdPinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ussdPinLockedUntil" TIMESTAMPTZ(3),
  ADD COLUMN "ussdPinChangedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "caregivers_phone_normalized_check" CHECK (
    "phoneNormalized" IS NULL OR "phoneNormalized" ~ '^\+[1-9][0-9]{7,14}$'
  ),
  ADD CONSTRAINT "caregivers_phone_verification_check" CHECK (
    "phoneVerifiedAt" IS NULL OR "phoneNormalized" IS NOT NULL
  ),
  ADD CONSTRAINT "caregivers_ussd_pin_check" CHECK (
    ("ussdPinHash" IS NULL AND "ussdPinChangedAt" IS NULL)
    OR ("ussdPinHash" IS NOT NULL AND "ussdPinChangedAt" IS NOT NULL AND "phoneVerifiedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "caregivers_ussd_pin_attempts_check" CHECK (
    "ussdPinFailedAttempts" BETWEEN 0 AND 5
  );

CREATE UNIQUE INDEX "caregivers_organizationId_phoneNormalized_key"
  ON "caregivers"("organizationId", "phoneNormalized");
CREATE UNIQUE INDEX "appointments_id_organizationId_key"
  ON "appointments"("id", "organizationId");
CREATE UNIQUE INDEX "service_deliveries_id_organizationId_key"
  ON "service_deliveries"("id", "organizationId");

CREATE TABLE "ussd_sessions" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "providerSessionId" TEXT NOT NULL,
  "organizationId" TEXT,
  "caregiverId" TEXT,
  "phoneDigest" TEXT NOT NULL,
  "phoneLastFour" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "status" "UssdSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "assurance" "UssdAssurance" NOT NULL DEFAULT 'NONE',
  "currentMenu" TEXT NOT NULL DEFAULT 'ROOT',
  "state" JSONB NOT NULL DEFAULT '{}',
  "lastRequestDigest" TEXT,
  "lastResponse" TEXT,
  "pinVerifiedAt" TIMESTAMPTZ(3),
  "otpVerifiedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ussd_sessions_provider_session_key" UNIQUE ("provider", "providerSessionId"),
  CONSTRAINT "ussd_sessions_phone_last_four_check" CHECK ("phoneLastFour" ~ '^[0-9]{4}$'),
  CONSTRAINT "ussd_sessions_locale_check" CHECK ("locale" IN ('en', 'ha', 'yo', 'ig')),
  CONSTRAINT "ussd_sessions_tenant_pair_check" CHECK (
    ("organizationId" IS NULL AND "caregiverId" IS NULL)
    OR ("organizationId" IS NOT NULL AND "caregiverId" IS NOT NULL)
  ),
  CONSTRAINT "ussd_sessions_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "ussd_sessions_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "ussd_sessions_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "ussd_sessions_phone_status_expiry_idx" ON "ussd_sessions"("phoneDigest", "status", "expiresAt");
CREATE INDEX "ussd_sessions_tenant_caregiver_status_idx" ON "ussd_sessions"("organizationId", "caregiverId", "status");

CREATE TABLE "ussd_phone_routes" (
  "id" TEXT PRIMARY KEY,
  "phoneDigest" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "disabledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ussd_phone_routes_digest_org_caregiver_key" UNIQUE ("phoneDigest", "organizationId", "caregiverId"),
  CONSTRAINT "ussd_phone_routes_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "ussd_phone_routes_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "ussd_phone_routes_lookup_idx" ON "ussd_phone_routes"("phoneDigest", "disabledAt");

CREATE TABLE "ussd_otp_challenges" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "purpose" "UssdOtpPurpose" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "actionDigest" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "status" "UssdOtpStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ussd_otp_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ussd_otp_challenges_id_org_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "ussd_otp_challenges_attempts_check" CHECK ("attempts" BETWEEN 0 AND "maxAttempts" AND "maxAttempts" BETWEEN 1 AND 10),
  CONSTRAINT "ussd_otp_challenges_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "ussd_otp_challenges_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "ussd_otp_challenges_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "ussd_otp_challenges_lookup_idx" ON "ussd_otp_challenges"("organizationId", "caregiverId", "purpose", "status", "expiresAt");

CREATE TABLE "appointment_caregiver_responses" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "response" "AppointmentCaregiverDecision" NOT NULL,
  "preferredStart" TIMESTAMPTZ(3),
  "preferredEnd" TIMESTAMPTZ(3),
  "status" "UssdRequestStatus" NOT NULL DEFAULT 'PENDING',
  "sourceSessionId" TEXT NOT NULL UNIQUE,
  "reviewedBySubjectId" TEXT,
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewNotes" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "appointment_caregiver_responses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_caregiver_responses_id_org_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "appointment_caregiver_responses_window_check" CHECK (
    ("response" = 'CONFIRMED' AND "preferredStart" IS NULL AND "preferredEnd" IS NULL)
    OR ("response" = 'RESCHEDULE_REQUESTED' AND "preferredStart" IS NOT NULL AND "preferredEnd" IS NOT NULL AND "preferredEnd" > "preferredStart")
  ),
  CONSTRAINT "appointment_caregiver_responses_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "appointment_caregiver_responses_appointment_fkey" FOREIGN KEY ("appointmentId", "organizationId") REFERENCES "appointments"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "appointment_caregiver_responses_child_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "appointment_caregiver_responses_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "appointment_caregiver_responses_work_idx" ON "appointment_caregiver_responses"("organizationId", "appointmentId", "status", "createdAt");

CREATE TABLE "ussd_callback_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "childId" TEXT,
  "category" "UssdCallbackCategory" NOT NULL,
  "priority" "VulnerabilityLevel" NOT NULL DEFAULT 'LOW',
  "status" "UssdRequestStatus" NOT NULL DEFAULT 'PENDING',
  "sourceSessionId" TEXT NOT NULL UNIQUE,
  "assignedSubjectId" TEXT,
  "resolvedBySubjectId" TEXT,
  "resolvedAt" TIMESTAMPTZ(3),
  "resolutionNotes" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ussd_callback_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ussd_callback_requests_id_org_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "ussd_callback_requests_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "ussd_callback_requests_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "ussd_callback_requests_child_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "ussd_callback_requests_work_idx" ON "ussd_callback_requests"("organizationId", "category", "status", "priority", "createdAt");

CREATE TABLE "nfc_card_support_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "requestType" "NfcCardSupportType" NOT NULL,
  "status" "UssdRequestStatus" NOT NULL DEFAULT 'PENDING',
  "sourceSessionId" TEXT NOT NULL UNIQUE,
  "temporarySuspendedAt" TIMESTAMPTZ(3),
  "identityVerifiedAt" TIMESTAMPTZ(3),
  "reviewedBySubjectId" TEXT,
  "reviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "nfc_card_support_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nfc_card_support_requests_id_org_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "nfc_card_support_requests_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "nfc_card_support_requests_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "nfc_card_support_requests_child_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "nfc_card_support_requests_credential_fkey" FOREIGN KEY ("credentialId", "organizationId") REFERENCES "child_credentials"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "nfc_card_support_requests_work_idx" ON "nfc_card_support_requests"("organizationId", "credentialId", "status", "createdAt");

CREATE TABLE "ussd_consent_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "recipientType" "ConsentRecipientType" NOT NULL,
  "recipientId" TEXT NOT NULL,
  "recipientDisplayName" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "legalBasis" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "requestedScopes" JSONB NOT NULL,
  "status" "UssdConsentRequestStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "decidedAt" TIMESTAMPTZ(3),
  "sourceSessionId" TEXT UNIQUE,
  "consentGrantId" TEXT UNIQUE,
  "createdBySubjectId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ussd_consent_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ussd_consent_requests_id_org_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "ussd_consent_requests_grant_org_key" UNIQUE ("consentGrantId", "organizationId"),
  CONSTRAINT "ussd_consent_requests_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "ussd_consent_requests_scopes_check" CHECK (jsonb_typeof("requestedScopes") = 'array' AND jsonb_array_length("requestedScopes") BETWEEN 1 AND 4),
  CONSTRAINT "ussd_consent_requests_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "ussd_consent_requests_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "ussd_consent_requests_child_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "ussd_consent_requests_grant_fkey" FOREIGN KEY ("consentGrantId", "organizationId") REFERENCES "consent_grants"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "ussd_consent_requests_lookup_idx" ON "ussd_consent_requests"("organizationId", "caregiverId", "status", "expiresAt");

CREATE TABLE "programme_interests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "childId" TEXT,
  "programmeId" TEXT,
  "category" "ProgrammeInterestCategory" NOT NULL,
  "administrativeArea" TEXT,
  "status" "UssdRequestStatus" NOT NULL DEFAULT 'PENDING',
  "sourceSessionId" TEXT NOT NULL UNIQUE,
  "reviewedBySubjectId" TEXT,
  "reviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "programme_interests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "programme_interests_id_org_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "programme_interests_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "programme_interests_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "programme_interests_child_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "programme_interests_programme_fkey" FOREIGN KEY ("programmeId", "organizationId") REFERENCES "programmes"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "programme_interests_work_idx" ON "programme_interests"("organizationId", "category", "status", "createdAt");

CREATE TABLE "service_delivery_confirmations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "serviceDeliveryId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "decision" "ServiceDeliveryDecision" NOT NULL,
  "status" "UssdRequestStatus" NOT NULL DEFAULT 'PENDING',
  "sourceSessionId" TEXT NOT NULL UNIQUE,
  "reviewedBySubjectId" TEXT,
  "reviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "service_delivery_confirmations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_delivery_confirmations_id_org_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "service_delivery_confirmations_delivery_caregiver_key" UNIQUE ("serviceDeliveryId", "caregiverId"),
  CONSTRAINT "service_delivery_confirmations_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "service_delivery_confirmations_delivery_fkey" FOREIGN KEY ("serviceDeliveryId", "organizationId") REFERENCES "service_deliveries"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "service_delivery_confirmations_child_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "service_delivery_confirmations_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "service_delivery_confirmations_work_idx" ON "service_delivery_confirmations"("organizationId", "decision", "status", "createdAt");

CREATE TABLE "reward_redemption_confirmations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "rewardReservationId" TEXT NOT NULL,
  "decision" "RewardConfirmationDecision" NOT NULL,
  "sourceSessionId" TEXT NOT NULL UNIQUE,
  "confirmedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reward_redemption_confirmations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reward_redemption_confirmations_id_org_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "reward_redemption_confirmations_reservation_key" UNIQUE ("rewardReservationId", "organizationId"),
  CONSTRAINT "reward_redemption_confirmations_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "reward_redemption_confirmations_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "reward_redemption_confirmations_reservation_fkey" FOREIGN KEY ("rewardReservationId", "organizationId") REFERENCES "reward_reservations"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "reward_redemption_confirmations_caregiver_idx" ON "reward_redemption_confirmations"("organizationId", "caregiverId", "confirmedAt");

CREATE TABLE "climate_assistance_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "childId" TEXT,
  "climateEventId" TEXT,
  "administrativeAreaCode" TEXT NOT NULL,
  "requestType" "ClimateAssistanceType" NOT NULL,
  "householdSafe" BOOLEAN,
  "priority" "VulnerabilityLevel" NOT NULL DEFAULT 'HIGH',
  "status" "UssdRequestStatus" NOT NULL DEFAULT 'PENDING',
  "sourceSessionId" TEXT NOT NULL UNIQUE,
  "assignedSubjectId" TEXT,
  "resolvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "climate_assistance_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "climate_assistance_requests_id_org_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "climate_assistance_requests_safety_check" CHECK (
    ("requestType" = 'HOUSEHOLD_SAFETY' AND "householdSafe" IS NOT NULL)
    OR ("requestType" <> 'HOUSEHOLD_SAFETY' AND "householdSafe" IS NULL)
  ),
  CONSTRAINT "climate_assistance_requests_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "climate_assistance_requests_caregiver_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "climate_assistance_requests_child_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT,
  CONSTRAINT "climate_assistance_requests_event_fkey" FOREIGN KEY ("climateEventId", "organizationId") REFERENCES "climate_events"("id", "organizationId") ON DELETE RESTRICT
);
CREATE INDEX "climate_assistance_requests_work_idx" ON "climate_assistance_requests"("organizationId", "administrativeAreaCode", "requestType", "status", "priority");

ALTER TABLE "ussd_otp_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ussd_otp_challenges" FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointment_caregiver_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_caregiver_responses" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ussd_callback_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ussd_callback_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "nfc_card_support_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nfc_card_support_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ussd_consent_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ussd_consent_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "programme_interests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programme_interests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_delivery_confirmations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_delivery_confirmations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "reward_redemption_confirmations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reward_redemption_confirmations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "climate_assistance_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "climate_assistance_requests" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ussd_otp_challenges_tenant_policy" ON "ussd_otp_challenges"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
CREATE POLICY "appointment_caregiver_responses_tenant_policy" ON "appointment_caregiver_responses"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
CREATE POLICY "ussd_callback_requests_tenant_policy" ON "ussd_callback_requests"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
CREATE POLICY "nfc_card_support_requests_tenant_policy" ON "nfc_card_support_requests"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
CREATE POLICY "ussd_consent_requests_tenant_policy" ON "ussd_consent_requests"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
CREATE POLICY "programme_interests_tenant_policy" ON "programme_interests"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
CREATE POLICY "service_delivery_confirmations_tenant_policy" ON "service_delivery_confirmations"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
CREATE POLICY "reward_redemption_confirmations_tenant_policy" ON "reward_redemption_confirmations"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
CREATE POLICY "climate_assistance_requests_tenant_policy" ON "climate_assistance_requests"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
