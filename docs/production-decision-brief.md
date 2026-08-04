# Medfinet Production Decision Brief

**Decision date:** 28 July 2026  
**Status:** Accepted working baseline; replaceable provider choices may change without changing domain contracts.

## Product being built

Medfinet will be delivered as a complete Nigeria-first, multi-country-ready child health and climate-response platform, not as a demonstration or MVP. It includes:

- An installable, offline-capable field-worker PWA.
- A caregiver portal.
- Organization, facility, programme, workforce, merchant, and platform administration.
- A privacy-preserving public impact dashboard.
- Child/caregiver identity, consent, QR/NFC credentials, clinical continuity, climate response, referrals, rewards, notifications, interoperability, and auditable reporting.
- Production API, background workers, monitoring, backup/recovery procedures, security controls, deployment artifacts, and operational runbooks.

## Product boundaries

- PostgreSQL is the system of record. NFC and QR credentials contain only opaque random tokens.
- Identifiable or clinical information must never be written to a public blockchain, public IPFS gateway, logs, analytics, or public metrics.
- Algorand is optional proof anchoring for non-identifying hashes only.
- Crowdfunding remains isolated as a legacy compatibility module and is not part of clinical navigation or authorization.
- Automated risk scores support prioritization; they cannot diagnose, deny care, or remove human review.

## Architecture

- **API:** existing Node.js/Express application, organized by domain services and versioned routes.
- **Database:** PostgreSQL with Prisma migrations, composite tenant foreign keys, forced RLS, UTC timestamps, exact decimal/integer financial types, and immutable audit evidence.
- **Web:** Next.js/React TypeScript application inside `frontend/`, delivered as a responsive PWA with accessible offline workflows.
- **Authentication:** Supabase Auth; clinical permissions are calculated by Medfinet from organization membership, role, programme assignment, purpose, consent, and emergency context.
- **Jobs:** durable PostgreSQL-backed outbox and worker initially, preserving a future queue-provider boundary.
- **Storage:** private Supabase Storage by default through a provider interface.
- **Communications:** Termii SMS and Resend email through replaceable adapters.
- **Operations:** Render-compatible containers, Sentry-compatible telemetry, structured logs, health/readiness checks, migrations, backups, restore exercises, and incident runbooks.

## Initial production assumptions

- Nigeria-first, English-first, with Hausa, Yoruba, and Igbo localization support.
- Store timestamps in UTC and render in the user's configured timezone; initial organization default is `Africa/Lagos`.
- Design capacity: 100 organizations, 1,000 facilities, 10,000 concurrent workers, and 5 million children.
- Field workflows must tolerate intermittent 2G/3G and remain usable offline for 72 hours.
- Target RPO is 15 minutes and target RTO is 4 hours.
- Public aggregates suppress cohorts below the configured minimum cell size.

## Complete domain scope

1. Identity, tenancy, workforce, facilities, programmes, deduplication, corrections, and merges.
2. Opaque QR/NFC credentials, recovery, revocation, rotation, and scan evidence.
3. Consent, policy evaluation, emergency overrides, supervisor review, and data disclosure logs.
4. Vaccination, Vitamin A, growth/nutrition, allergies, alerts, appointments, clinical amendments, and emergency profiles.
5. Climate events, affected areas, eligibility, beneficiary worklists, service delivery, relief distribution, and referrals.
6. Offline operation log, idempotent synchronization, conflict handling, and device lifecycle.
7. Reward ledger, merchant eligibility, reservations, redemptions, reversals, and reconciliation using integer credits.
8. Caregiver notifications, preferences, templates, delivery attempts, and opt-out handling.
9. FHIR and DHIS2 adapter contracts, imports, exports, mappings, retry/dead-letter handling, and reconciliation.
10. Aggregate metrics, disclosure control, dashboards, exports, audit search, data retention, subject requests, and operational administration.

## Delivery milestones

- Phase 0-1: configuration, security baseline, identity, tenancy, and administration.
- Phase 2: credentials and clinical continuity.
- Phase 3: consent, policy, service delivery, referrals, and emergency access.
- Phase 4: climate response, offline sync, localization, notifications, rewards, and merchant workflows.
- Phase 5: interoperability, public evidence, complete frontend surfaces, operations, and production hardening.
- Final gate: fresh and legacy migrations, API and browser journeys, tenant/privacy tests, offline tests, load tests, backup restore, security review, accessibility, deployment smoke tests, and completion audit.

## Definition of production completion

Completion requires implemented and tested workflows across every domain above; deployable frontend and backend artifacts; no placeholder business behavior; tenant, consent, and minimum-necessary disclosure enforcement; tested migration/rollback and backup recovery; monitoring and incident controls; accessible responsive interfaces; operational documentation; and staging/production verification once real provider accounts are supplied.
