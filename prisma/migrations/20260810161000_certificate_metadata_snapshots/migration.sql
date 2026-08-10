-- Certificate-facing location and vaccinator details live in a dedicated schema
-- because these fields are historical evidence, not mutable presentation data.
-- The tables are tenant-isolated with the same app.current_organization_id
-- session setting used by the rest of Medfinet.
CREATE SCHEMA IF NOT EXISTS medfinet_certificate;

CREATE TABLE medfinet_certificate.facility_profiles (
  facility_id TEXT PRIMARY KEY REFERENCES public.facilities(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  state TEXT,
  lga TEXT,
  ward TEXT,
  updated_by_subject_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX facility_profiles_organization_id_idx
  ON medfinet_certificate.facility_profiles(organization_id);

CREATE TABLE medfinet_certificate.immunization_snapshots (
  immunization_id TEXT PRIMARY KEY REFERENCES public.immunization_records(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  facility_id TEXT REFERENCES public.facilities(id) ON DELETE SET NULL,
  facility_name TEXT,
  state TEXT,
  lga TEXT,
  ward TEXT,
  vaccinator_name TEXT,
  vaccinator_subject_id TEXT,
  recorded_by_subject_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX immunization_snapshots_organization_id_idx
  ON medfinet_certificate.immunization_snapshots(organization_id);

ALTER TABLE medfinet_certificate.facility_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE medfinet_certificate.facility_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY facility_profiles_tenant_isolation
  ON medfinet_certificate.facility_profiles
  USING (
    organization_id = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.current_organization_id', true), '')
  );

ALTER TABLE medfinet_certificate.immunization_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE medfinet_certificate.immunization_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY immunization_snapshots_tenant_isolation
  ON medfinet_certificate.immunization_snapshots
  USING (
    organization_id = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.current_organization_id', true), '')
  );
