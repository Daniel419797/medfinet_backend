# Medfinet Production Requirements Matrix

**Last audited:** 29 July 2026  
**Scope:** `medfinet_backend` and `medfinet_frontend`  
**Completion rule:** A domain is complete only when its persistence, authorization, API, user experience, tests, observability, migration, and operating procedure are all evidenced.

Status meanings:

- **Verified:** current evidence directly proves the stated requirement.
- **Partial:** useful implementation exists, but one or more production gates are missing.
- **Missing:** the required production behavior is not implemented.
- **Blocked externally:** code can be deployable, but live verification needs an account, agreement, credential, hardware, or authorized partner.

## Platform and operational foundations

| Requirement | Status | Current evidence | Evidence still required |
| --- | --- | --- | --- |
| Validated, fail-closed configuration | Partial | `config/index.js`, `.env.example`, configuration tests | Separate development/staging/production contracts; provider-specific validation |
| Secret containment | Partial | Runtime secret scan tests and removed hardcoded fallbacks | Rotate every previously exposed credential; repository-history scan; managed-secret deployment proof |
| Health and readiness probes | Partial | `/health` and database-backed `/ready` | Container and deployed probe verification |
| Versioned production API | Partial | Identity/clinical routes under `/api/v1` | All remaining domains; OpenAPI contract; compatibility policy |
| Consistent error contract | Partial | `DomainError` and application error middleware | Validation-detail standard, request IDs, all legacy route migration |
| Database migrations | Partial | Identity and clinical forward migrations now exist | Fresh chain, legacy upgrade, idempotency, drift, rollback and target PostgreSQL proof |
| Tenant isolation | Partial | Composite tenant keys, forced RLS, middleware and isolated tests | Database-backed HTTP integration tests across every tenant-owned model |
| Audit evidence | Partial | Tenant-bound audit events across implemented domains; immutable database trigger; bounded exact-filter search for owners, administrators and auditors | Signed/hash-chained tamper evidence, CSV/PDF export, privileged-read completeness, retention approval and live database verification |
| Authentication and session lifecycle | Partial | Supabase is authoritative; strict Bearer parsing; production forbids legacy application JWTs; legacy wallet-token issuance returns 410; recent AAL2 step-up middleware | Refresh/session revocation, recovery, full device-session inventory and HTTP/database integration tests |
| Central authorization policy | Partial | Active tenant membership and organization lifecycle; role and purpose checks; global or explicitly assigned programme/facility scopes; consent/disclosure; emergency; caregiver account; merchant membership checks | One consolidated policy evaluator, enforcement audit across every service and database-backed HTTP coverage |
| Rate limiting and abuse controls | Partial | PostgreSQL-backed atomic distributed buckets; HMAC-hashed client keys; explicit proxy trust; standard response headers; global, public, webhook and legacy-auth limits; fail-closed limiter; expiry cleanup; tests | Per-subject and high-risk operation limits; credential-scan controls; adaptive lockouts; abuse telemetry/alerts; load and live multi-instance verification |
| Background jobs and outbox | Partial | Tenant-bound durable outbox, optimistic claims, bounded retries, dead letters, worker, cursor-safe worklist generation, notification dispatch and bounded interoperability processing | Worker health/lag metrics, scheduler deployment, operational replay tooling and deployed concurrency proof |
| Private object storage | Missing | Legacy public IPFS/certificate routes are no longer mounted and obsolete storage credentials are not required | Private provider adapter, malware/type checks, signed access, retention and deletion for approved document/export use cases |
| Structured observability | Partial | JSON request and service lifecycle logs; request correlation; route-pattern logging without raw URLs; sensitive-field denylist; duration/status fields; ad-hoc runtime console logging removed; tests | Metrics and traces; worker lag/dead-letter gauges; provider health; dashboards, alerts and SLO burn-rate policies; centralized log shipping and deployed redaction verification |
| Backup and disaster recovery | Missing | Documentation intent only | Automated backups, restore test, RPO/RTO evidence and runbook |
| CI/CD and deployment | Partial | Non-root health-checked API image; API/worker Compose topology; CI PostgreSQL service and fresh migration gate; build/test gate; production startup migration command | Successful local image build (Docker runtime stalled); environment promotion; image signing/SBOM; rollback automation; deployed health/readiness/worker smoke proof |

## Product domains

| Domain | Status | Current evidence | Missing production capabilities |
| --- | --- | --- | --- |
| Organizations and memberships | Partial | Create organization; list/upsert membership; final-owner protection; owner-controlled suspend/reactivate lifecycle; global/scoped membership mode; atomic programme/facility assignments; forced tenant RLS | Invitations, workforce acceptance/recovery flows, complete HTTP/database coverage and UI |
| Facilities and programmes | Partial | Create/list/update/archive APIs with tenant constraints; resource assignments; archive guards for scheduled care, active response worklists and campaigns | Service areas, operating configuration, complete HTTP/database coverage and UI |
| Caregivers and children | Partial | Registration, linking, listing, retrieval, duplicate-review gate and maker-checker identity corrections with immutable evidence | Controlled merges, durable external identifiers, verified contact channels, remaining subject-request execution and complete UI |
| QR/NFC credentials | Partial | Separate QR/recovery lifecycle; NTAG215 Type 2 NDEF image; fragment-contained opaque credential; exact 21-character UID/counter mirror; exact NTAG215 version gate; derived PWD/PACK; write-only protection and configuration-lock contract; signed preparation/activation/scan evidence; NXP originality evidence binding; safe ACTIVE/EXPIRED/REVOKED/REPLACED public statuses; one-time challenges; Ed25519/P-256 device attestation; recent AAL2 enforcement; replay detection; consent-redacted clinical resolution; NFC-launched vaccination and emergency workflows; cancellation, cleanup and atomic replacement; abuse limits; installable responsive PWA; forced tenant RLS; reader-independent raw-command station core and emulator; fail-closed provisioning orchestration; ACS ACR1552U transparent-exchange/RF adapter and APDU tests; unit, live PostgreSQL and authenticated HTTP lifecycle verification; runbooks | Deployed-environment proof; native PC/SC session binding and physical ACR1552U evidence; genuine-card write/lock/clone/replay acceptance proof; approved NXP signature-verification SDK/integration; production deployment proof |
| Clinical continuity | Partial | Immunization; growth/Vitamin A; allergies; alerts; appointments; resolution workflows; immutable before/after amendments; timeline and minimum emergency profile; versioned maker-checker vaccine schedules with deterministic catch-up evaluation | Terminology service and clinical validation catalogue, adverse events, complete protocol coverage, HTTP/database integration and UI |
| Consent and disclosure | Partial | Versioned, scoped grants; caregiver authority; expiry; withdrawal; evaluation decisions; disclosure logs; tenant migration and service tests | Enforce evaluation on every protected resource; exemptions/legal bases; caregiver UI; database-backed HTTP tests |
| Emergency access | Partial | Recent Supabase AAL2 requirement; bounded actor/child access; reason and justification; minimum emergency view; allowed/denied disclosure evidence; expiry; supervisor approval/flag/revocation; tenant migration and service tests | Caregiver notification where safe, review queue UI, HTTP/database integration tests and legal policy approval |
| Climate response | Partial | Climate profiles; event lifecycle; source-backed affected areas; programme/area eligibility criteria; durable cursor-based background generation; explicitly authorized worklists; idempotent service delivery; referral lifecycle; forced tenant RLS; migration and service tests | Assignment/contact/closure operations, consent/emergency policy alternatives, frontend and database-backed HTTP tests |
| Offline field operation | Partial | Keyed device identifiers; device ownership/revocation/lost state; durable 1-100 operation batches; supported-operation allowlist; per-operation payload bounds; device and batch idempotency; applied/conflict/rejected results; crash recovery; cursor-safe background worker; retries and dead-letter outbox | Encrypted browser queue, signed device requests, server change feed, frontend integration, conflict-resolution UI and 72-hour connectivity test |
| Rewards and merchant settlement | Partial | Integer-credit campaigns and milestone grants; caregiver accounts; deterministic opaque reservations; category-bound merchant redemption; expiry release; reversal; immutable balanced debit/credit journal; merchant RBAC; maker-checker settlement; tenant RLS; cursor query APIs; service and migration tests | Risk/velocity signals and review workflow; scheduled expiry worker; settlement provider adapter/callback; reconciliation reports; frontend; database-backed concurrency and HTTP tests |
| Notifications | Partial | Versioned single-active templates; strict escaped variable contracts; per-subject channel preferences and opt-out; timezone-aware quiet hours; durable messages and delivery attempts; in-app inbox/read state; generic HTTPS gateway adapter; idempotency; retry/crash recovery; signed replay-bounded delivery callbacks; reward, settlement, appointment, referral and consent-authority emergency event producers; minimum-necessary resolver; worker integration; forced tenant RLS; service and migration tests | Verified contact lifecycle; provider-specific sandbox proof; bounce/complaint handling; bulk operational broadcasts; frontend preference/template/inbox journeys; database-backed HTTP and worker integration tests |
| Interoperability | Partial | Tenant-bound FHIR R4 and DHIS2 connections; managed-secret references; HTTPS host allowlisting; health-gated activation; strict versioned non-executable mappings; consent-gated bounded exports; encrypted import staging with maker-checker review; idempotent jobs; reconciliation; hash-only exchange evidence; cursor-safe worker processing; forced tenant RLS; contract, adapter, service and migration tests | Partner-specific mappings and legal data-sharing approval; DHIS2 import application workflows; provider sandbox exchange proof; terminology validation; bulk/backfill performance evidence; frontend administration/review journeys; database-backed HTTP, worker-concurrency and reconciliation tests |
| Analytics and public evidence | Partial | Server-owned metric catalogue and bounded reporting periods; immutable pre-aggregated snapshots; organization publication approval; minimum cell size of 10-1000; public reads restricted to pre-classified published organization aggregates; freshness metadata; tenant RLS; durable generation worker; migration and service tests | Programme/facility/geography aggregates with approved reduction rules; CSV/PDF exports; uptime and latency ingestion; signed evidence reports; frontend dashboards; longitudinal differencing-risk review; live database and disclosure testing |
| Data governance | Partial | Versioned category retention policies; automatic deletion prohibited for clinical/identity/audit records; maker-checker activation and execution; stale-preview detection; organization-wide legal-hold blocking; legal-hold lifecycle; caregiver-authorized data-subject requests with identity verification, decisions, deadlines and audit evidence; forced tenant RLS; tests | Secure access/portability package delivery; rectification and case-reviewed erasure execution; restriction enforcement across all processing; record-level hold scoping; de-identification workflows; regulator-approved retention schedule; live database and HTTP tests |
| Localization | Partial | Canonical English/Hausa/Yoruba/Igbo locale contract; legacy caregiver-language migration; database constraints across preferences/templates/messages; versioned translation content with maker-checker approval; English fallback catalogs; tenant RLS; service and migration tests | Human-reviewed production translation catalogue for all frontend and notification copy; plural/date/number formatting; accessibility and low-literacy review; frontend locale switching; linguistic QA with pilot communities |

## Frontend production audit

The current frontend is not yet a safe client for the production backend:

- Authentication and clinical records are frequently stored or fabricated in `localStorage`.
- Multiple pages contain mock users, facilities, vaccinations, invoices, analytics, AI output, and payment results.
- Several screens query Supabase directly from the browser rather than using the policy-enforcing Medfinet API.
- The frontend server falls back from a service key to a browser anonymous key.
- Clinical, admin, finance, and partner pages do not share one authoritative API contract.
- Loading, empty, error, retry, conflict, offline, and session-expiry behavior is inconsistent.
- The locked dependency installation was incomplete at audit time, so lint and production build remain unverified.

These paths must be replaced or removed from production navigation; mock business data is not acceptable as fallback behavior.

## Verification gates before completion

1. Fresh and legacy PostgreSQL migrations, schema drift, RLS and rollback/forward-recovery checks.
2. Unit, database integration, HTTP contract, tenant/privacy, authorization and concurrency tests.
3. Browser journeys for every role and critical workflow at desktop and approximately 390 px.
4. Offline, retry, duplicate-operation, conflict and lost-device scenarios.
5. Accessibility audit against WCAG 2.2 AA.
6. Load, soak and failure tests against agreed service-level objectives.
7. Dependency, secret, static, dynamic and manual security review.
8. Backup restoration and disaster-recovery exercise.
9. Container build, staging deployment, migration, health/readiness and rollback smoke tests.
10. Live provider and partner tests where authorized credentials and agreements are available.

## External launch gates

These do not excuse incomplete code, but they prevent an honest claim that a real healthcare service is live:

- Nigerian legal/privacy/safeguarding review and approved policies.
- Authorized production cloud, domain, messaging, email and monitoring accounts.
- Pilot organizations, named data controllers/processors and signed data-sharing agreements.
- Approved NFC hardware and device-management procedures.
- FHIR/DHIS2 or government partner sandbox and exchange agreement.
- Real backup destination, incident owners, support rota and escalation contacts.
- Authorized penetration test and pilot usability/operational sign-off.
