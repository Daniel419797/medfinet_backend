# Medfinet UNICEF Climate Ventures Readiness and Implementation Plan

**Status:** Project audit and delivery plan  
**Prepared:** 28 July 2026  
**Repository reviewed:** `medfinet_backend`  
**Evidence rule:** Features described as "planned" are not implemented until their acceptance criteria have passed.

---

## 1. Executive Decision

Medfinet is a strong conceptual match for **Area 4: Point-of-care support** in UNICEF's Climate Ventures call. Its most defensible proposition is:

> Medfinet provides a portable, consent-governed digital child identity that helps authorized health, nutrition, protection, and emergency partners coordinate services when climate shocks displace families and disrupt records.

The NFC card should remain a replaceable credential that resolves a durable backend identity. It must not be described as the identity itself or as a device containing the child's medical record.

Medfinet is not currently application-ready based on the reviewed repository. The existing code proves some experience with vaccination certificates and Algorand transactions, but it does not yet implement the proposed child identity, consent, interoperability, climate-response, or pilot-measurement system. The immediate objective is therefore to build and test a narrowly scoped working prototype, not to expand the pitch with more unsupported features.

---

## 2. Verified UNICEF Call Facts

### Call and funding

- Call: **Funding frontier climate tech for children's health**.
- Funder: UNICEF Venture Fund / UNICEF Office of Innovation.
- Funding: up to **US$100,000**, equity-free.
- Target: early-stage, for-profit technology startups in UNICEF programme countries.
- Technology focus: open-source frontier technologies, including AI, machine learning, and blockchain.
- Product maturity: a working prototype with initial test results or proof of deployment.
- This call is the first cohort in UNICEF's five-year Climate Ventures programme.

### Mandatory eligibility conditions

The published Request for Expression of Interest lists the following pass/fail conditions:

1. A legally registered private for-profit company by the estimated investment date.
2. Registration in a UNICEF programme country.
3. An open-source solution, or a commitment to adopt an approved open-source licence.
4. An existing prototype with promising initial results.
5. Potential to improve outcomes for vulnerable children and young people.
6. Measurable, publicly exposed real-time data.
7. Alignment with UNICEF's responsible-technology and innovation principles.

The funded solution is expected to be published under an appropriate licence. UNICEF names MIT, BSD, and GNU licences as examples for software and CC BY for content. End-to-end open-source solutions receive priority.

Public reporting must expose aggregate project progress and impact data, never identifiable child health information.

### Scoring

| Criterion | Score |
|---|---:|
| Relevance to children, problem-solution fit, and global scale | 20 |
| Novelty and alignment with UNICEF Innovation Principles | 30 |
| Suitability of team and key personnel | 30 |
| Project budget and financing | 20 |
| **Total** | **100** |

### Deadline status

The official UNICEF Office of Innovation page states **17 May 2026** as the application deadline. As of 28 July 2026, that date has passed. The Venture Fund page may still display a general or rolling application entry point, but that does not change the published deadline for this specific Climate Ventures call.

### Who won?

No official investee announcement for this specific 2026 call was found as of 28 July 2026. UNICEF's general process says shortlisted applicants may be contacted within three months, followed by an RFP, demo interview, and a public investee announcement around month six. It is therefore plausible that selection is still underway, but this is an inference, not a confirmed UNICEF status.

The following organizations are winners of a **different programme**, the UNICEF Climate Innovation Challenge 2025, and must not be presented as winners of the 2026 funding call:

- CLIMATRIXAI, Nigeria
- NAXA, Nepal
- RIFFAI, Thailand
- RESPIRER, India
- TryoLabs, Uruguay

### Official sources

- [2026 Climate Ventures call](https://www.unicef.org/innovation/call-for-application-climate-and-health-2026)
- [UNICEF Venture Fund call page](https://www.unicefventurefund.org/call/funding-frontier-climate-tech-childrens-health)
- [2026 Request for Expression of Interest and scoring](https://www.unicefventurefund.org/sites/default/files/2026-04/Request%20for%20Expression%20of%20Interest%202026_pdf.pdf)
- [UNICEF Venture Fund eligibility and application process](https://www.unicefventurefund.org/apply-funding)
- [Separate 2025 Climate Innovation Challenge winners](https://www.unicef.org/innovation/top-5-promising-climate-tech-start-ups-emerging-economies-revealed)

---

## 3. Best Fit for Medfinet

### Primary fit: Area 4, point-of-care support

Medfinet directly addresses UNICEF's interest in interoperable digital identities that coordinate beneficiary data across agencies during climate-related public health emergencies. It can also address consent-based sharing and low-bandwidth point-of-care access.

The initial use case should be continuity of child health and nutrition services during flooding:

1. A flood event identifies affected wards or communities.
2. Authorized coordinators see aggregate counts and create outreach worklists.
3. A worker identifies a child using NFC, QR, or an approved recovery search.
4. The system checks the worker's role, organization, purpose, and applicable consent.
5. The worker receives a minimum-necessary emergency profile.
6. Vaccination, nutrition, relief, or referral activity is recorded.
7. An auditable event is created and aggregate pilot metrics are updated.

### Secondary fit

Medfinet may later support:

- Mapping children and facilities against flood, heat, air-quality, and disease-risk layers.
- Outreach prioritization and service-delivery optimization.
- Multilingual guidance for community health workers.
- Privacy-preserving public dashboards for programme performance.

These capabilities should not become the MVP's centre of gravity. Medfinet should not claim to be a climate-forecasting platform unless it develops and validates forecasting models.

### Claims to avoid until proven

- "AI automatically identifies every affected child."
- "Blockchain verifies all clinical records."
- "The platform is interoperable" without a working external integration.
- "Offline-ready" without tested offline synchronization and conflict handling.
- "Consent-based" without a real consent and authorization service.
- Any improved vaccination or emergency-response outcome without pilot evidence.

---

## 4. Current Repository Audit

### What exists

- Express API entry point.
- PostgreSQL configuration through Prisma.
- Supabase-backed authentication code and custom JWT support.
- Campaign, donation, escrow, and withdrawal models and routes.
- An Algorand flow that prepares vaccination certificate assets and submits signed transactions.
- QR/certificate image-generation and IPFS-related code.
- Phase 1 organization, facility, programme, membership, caregiver, child, caregiver-link, and audit models.
- Tenant-scoped child registration/list/retrieval and caregiver registration/link APIs.
- Application role checks, transaction-scoped tenant context, PostgreSQL RLS policies, and cross-tenant relationship constraints.
- Proposal and developer-specification documents.

### What does not exist

- Household, clinical vaccination-event, nutrition, and worker-profile data models. Core organization, facility, programme, membership, caregiver, and child models now exist in an unverified migration.
- NFC/QR credential issuance, rotation, revocation, scan, or recovery workflows.
- Consent grants, withdrawal, purpose limitation, or policy evaluation.
- Field-level/minimum-necessary clinical scopes. Organization roles and tenant isolation now exist for the Phase 1 identity APIs.
- Climate event, exposure, displacement, shelter, beneficiary worklist, relief distribution, or referral models.
- Interoperability adapters, FHIR resources, DHIS2 integration, or versioned partner APIs.
- Offline or low-bandwidth client synchronization.
- Public aggregate metrics required by UNICEF.
- Domain, API contract, migration, and pilot tests or pilot evidence. Focused configuration and privacy regression tests now exist.
- Structured logging, production monitoring, or a verified deployment configuration. Basic health and dependency-readiness endpoints now exist.
- An open-source licence or open-source governance plan.

### Critical engineering and security findings

| Priority | Finding | Current status | Remaining response |
|---|---|---|---|
| P0 | A third-party access token was hard-coded in source. | Removed from the current source tree; all storage credentials now come from validated environment configuration. | Revoke the exposed Pinata token, audit provider activity, and plan a coordinated Git-history cleanup if required. |
| P0 | JWT verification fell back to a predictable development secret. | Fixed. The API fails startup when `JWT_SECRET` is missing, short, or still a placeholder. | Provision separate rotated secrets in each environment and invalidate previously issued custom tokens. |
| P0 | Vaccination submission endpoints had no authentication. | Fixed at the route boundary with the existing authentication middleware. | Replace generic authentication with facility, programme, and health-worker authorization during Phase 1. |
| P0 | Sensitive vaccination data was included in public blockchain/IPFS material. | The live issuance path now anchors only a non-identifying proof hash and no longer uploads a child-identifying certificate. | Complete a formal privacy review and remove or quarantine unused legacy certificate-upload modules. |
| P0 | Broad default CORS and no production security configuration. | CORS is allowlisted through environment configuration; Helmet, request-size limits, and fail-fast validation are enabled. | Add rate limiting, structured security logging, and deployment-specific validation. |
| P1 | Current database models originally described crowdfunding, not Medfinet's proposed product. | Partially fixed. A separate identity foundation now models organizations, programmes, facilities, memberships, caregivers, children, and audit events. | Validate and apply the migration, then decide whether crowdfunding remains in scope. |
| P1 | Currency and financial amounts use floating-point fields. | Open. | Use integer minor units or decimal database types for retained financial workflows. |
| P1 | No migrations existed for the documented child identity architecture. | Partially fixed. A forward migration with indexes, composite tenant constraints, and RLS policies is present. | Run Prisma validation and test both fresh and legacy migration paths against PostgreSQL. |
| P1 | No automated test suite or CI quality gate was configured. | Partially fixed. Configuration/privacy regression tests, syntax checks, and a CI workflow now exist. | Add domain, integration, authorization, contract, migration, and database-backed tests. |
| P1 | No environment guide or service health endpoints existed. | Fixed. `.env.example`, configuration documentation, `/health`, and dependency-aware `/ready` were added. | Supply real secrets and verify both endpoints against the deployed database. |

The exposed token is not reproduced in this document. It must be treated as compromised even if it has expired.

---

## 5. MVP Scope

### MVP goal

Prove that an authorized worker can reliably identify a child and continue essential health or nutrition services during a simulated or real flood-response pilot, with consent, auditability, low-bandwidth usability, and measurable aggregate results.

### In scope

- Organization, facility, programme, and worker administration.
- Caregiver and child registration with deduplication safeguards.
- NFC and QR credentials containing opaque, revocable tokens.
- Credential scan and identity resolution.
- Immunization, Vitamin A, nutrition screening, allergy, and critical-alert records.
- Consent grants and withdrawal by organization, purpose, data scope, and duration.
- Role- and purpose-based emergency profiles.
- Flood event definition by affected administrative area.
- Authorized beneficiary worklists and service/referral recording.
- Immutable application audit logs with optional non-identifying blockchain anchoring.
- Offline-capable worker workflow for a narrow set of operations.
- Aggregate public pilot dashboard with suppression of small cohorts.
- English plus one locally relevant pilot language, selected with the pilot partner.

### Explicitly out of MVP

- A general electronic medical record.
- Autonomous diagnosis or autonomous denial of services.
- Proprietary climate forecasting built from scratch.
- National-scale identity replacement.
- Cryptocurrency rewards for caregivers.
- Full insurance, school, research, or merchant ecosystems.
- Personal health information stored on NFC, QR, IPFS, or a public blockchain.

---

## 6. Target Architecture

```text
Worker Web/PWA        Caregiver Portal        Public Metrics
      |                      |                       |
      +---------------- API Gateway ----------------+
                             |
       +---------------------+---------------------+
       |                     |                     |
 Identity and         Consent and Policy     Emergency Response
 Credential Service        Service                Service
       |                     |                     |
       +---------------------+---------------------+
                             |
                  Child Health Record Service
                             |
              PostgreSQL + encrypted object storage
                             |
       +---------------------+---------------------+
       |                     |                     |
 Audit/Proof Service   Interoperability      Aggregate Metrics
                      FHIR/DHIS2 adapters
```

### Architecture decisions

- Retain Node.js, Express, PostgreSQL, and Prisma for the first prototype to reduce delivery risk.
- Organize the backend by domain modules rather than adding all behaviour to existing campaign controllers.
- Use opaque random credential tokens. Store only hashes of tokens in the database.
- Treat PostgreSQL as the clinical source of truth.
- Use blockchain only for optional non-identifying audit anchors where it adds verifiable value.
- Use a standards adapter for FHIR/DHIS2 rather than forcing internal storage to mirror every external schema.
- Implement authorization in a central policy service; route-level role checks alone are insufficient.
- Build public reporting from pre-aggregated, disclosure-controlled metrics.

---

## 7. Minimum Data Model

Core entities:

- `organizations`
- `facilities`
- `programmes`
- `users`
- `organization_memberships`
- `roles`
- `caregivers`
- `children`
- `child_identifiers`
- `credentials`
- `consents`
- `consent_scopes`
- `vaccination_events`
- `nutrition_assessments`
- `medical_alerts`
- `climate_events`
- `affected_areas`
- `beneficiary_worklists`
- `worklist_entries`
- `service_deliveries`
- `referrals`
- `audit_events`
- `sync_operations`
- `aggregate_metrics`

Required rules:

- Every tenant-owned record carries an `organization_id` or an explicit programme ownership mapping.
- A credential belongs to a child identity but can be revoked or replaced independently.
- Consent is versioned and never reduced to a single boolean.
- Clinical corrections create a traceable amendment; they do not silently overwrite history.
- Public metrics contain no direct identifiers and enforce minimum-cell-size suppression.
- Geographic precision is reduced in public views where exact locations create re-identification or safeguarding risk.

---

## 8. API Delivery Plan

Initial versioned endpoints:

```text
POST   /api/v1/auth/login
GET    /api/v1/me

POST   /api/v1/children
GET    /api/v1/children/:id
PATCH  /api/v1/children/:id

POST   /api/v1/children/:id/credentials
POST   /api/v1/credentials/resolve
POST   /api/v1/credentials/:id/revoke
POST   /api/v1/credentials/:id/replace

POST   /api/v1/children/:id/consents
GET    /api/v1/children/:id/consents
POST   /api/v1/consents/:id/withdraw

POST   /api/v1/children/:id/vaccinations
POST   /api/v1/children/:id/nutrition-assessments
POST   /api/v1/children/:id/medical-alerts
GET    /api/v1/children/:id/emergency-profile

POST   /api/v1/climate-events
POST   /api/v1/climate-events/:id/affected-areas
POST   /api/v1/climate-events/:id/worklists
GET    /api/v1/worklists/:id
POST   /api/v1/worklists/:id/services
POST   /api/v1/worklists/:id/referrals

GET    /api/v1/public/metrics
GET    /health
GET    /ready
```

Every protected endpoint must define its actor, organization, permitted purpose, data scopes, audit event, validation schema, idempotency behaviour, and error contract.

---

## 9. Implementation Roadmap

### Phase 0: containment and baseline — Week 1

- Revoke and remove the exposed third-party credential.
- Eliminate fallback production secrets.
- Add environment validation and `.env.example` with names only.
- Add `/health` and `/ready`.
- Add test tooling, linting, CI, and a documented local setup.
- Add an approved open-source licence after confirming company IP strategy.
- Decide whether crowdfunding remains a separate product/module or is archived outside this service.

**Exit criteria:** no known source-controlled secrets, production startup fails safely without required configuration, CI runs, and a clean environment can start the API from documented instructions.

### Phase 1: identity and tenancy — Weeks 2-4

**Source status (28 July 2026): partially implemented; Prisma validation and isolated PostgreSQL 16 migration/security verification pass, while target-environment deployment remains pending.**

- Implement organizations, facilities, programmes, memberships, caregivers, and children.
- Implement organization isolation and policy-driven authorization.
- Implement audit events for reads and writes involving protected data.
- Add safe child-search and deduplication workflow.

Implemented in source: organization bootstrap and membership administration; facility/programme creation and listing; caregiver and child registration; exact child search and duplicate-review gating; caregiver linking; cursor-based child listing; child retrieval; role-aware organization authorization; audit events; tenant context; RLS; and cross-tenant relationship constraints. The Prisma schema validates, all migrations apply cleanly and idempotently to PostgreSQL 16, the migrated database has no Prisma schema drift, a restricted role cannot read or insert across tenants, and composite keys reject cross-tenant caregiver links. Still pending: provenance-preserving child correction and merge workflows, target-environment deployment, and HTTP-level database-backed integration tests.

**Exit criteria:** integration tests prove one organization cannot access another's records; authorized registration and retrieval work; every protected access is audited.

### Phase 2: credentials and clinical continuity — Weeks 5-7

- Issue opaque NFC/QR credentials.
- Resolve, revoke, rotate, and replace credentials.
- Implement vaccination, Vitamin A, nutrition, allergy, and medical-alert records.
- Build the minimum-necessary emergency profile.

**Exit criteria:** a lost card can be revoked and replaced without changing the child ID; no health data is present in the credential; an authorized scan returns only permitted fields.

### Phase 3: consent and multi-agency workflows — Weeks 8-10

- Implement scoped, expiring consent and withdrawal.
- Add emergency-access policy with legal review, time limits, reason codes, and supervisor review.
- Implement agency-specific scopes and disclosure tests.
- Add service deliveries and referrals.

**Exit criteria:** consent withdrawal blocks future non-exempt access; merchant/research/NGO test roles cannot retrieve clinical data outside their scopes; emergency overrides are reviewable and auditable.

### Phase 4: climate response and low connectivity — Weeks 11-13

- Ingest trusted flood-event and administrative-area data.
- Generate authorized beneficiary worklists.
- Add offline capture for selected worker actions, idempotent sync, and conflict resolution.
- Add English and selected local-language content.

**Exit criteria:** the core scan-to-service workflow succeeds under throttled and intermittent connectivity; sync retries do not duplicate vaccinations or distributions; worklists exclude users without an authorized programme basis.

### Phase 5: interoperability and public evidence — Weeks 14-16

- Implement one real partner integration, preferably FHIR or DHIS2 based on pilot-partner needs.
- Publish privacy-preserving aggregate metrics.
- Conduct threat modelling, penetration testing, safeguarding review, and disaster-recovery exercise.
- Run the pilot and publish an evidence report.

**Exit criteria:** a partner system exchanges a defined record end to end; public metrics update without exposing personal data; the pilot produces signed-off usability, reliability, and outcome evidence.

---

## 10. Pilot Design

### Recommended pilot

- One flood-prone Local Government Area.
- Two to four primary healthcare facilities and one temporary outreach site.
- 500-1,000 enrolled children.
- 10-20 health or nutrition workers.
- One government health partner and one emergency/nutrition partner.
- Eight to twelve weeks of monitored operation after training.

### Baseline and target measures

Targets must be agreed with pilot partners after baseline measurement. Track at minimum:

- Median time to identify a returning child.
- Percentage of children correctly matched without duplicate registration.
- Percentage of eligible emergency encounters with a retrieved continuity-of-care record.
- Missed-vaccination and Vitamin A follow-up completion.
- Nutrition-risk referrals completed.
- Credential loss and successful recovery rate.
- Consent grant, refusal, withdrawal, and policy-denial counts.
- Offline-sync success, duplicate-operation rate, uptime, and API latency.
- Unauthorized-access attempts and confirmed privacy incidents.
- Worker usability and caregiver trust scores.

Public reporting should show aggregate programme progress, uptime, coverage, and learning. It must exclude child names, exact locations, card identifiers, clinical notes, and small cohorts that could enable re-identification.

---

## 11. Responsible Technology and Safeguarding

- Complete a Data Protection Impact Assessment before live child data is collected.
- Obtain Nigerian legal and regulatory review, including applicable data-protection and health-record obligations.
- Define the lawful basis for each processing purpose; do not assume caregiver consent is the only lawful basis.
- Provide plain-language, accessible consent and grievance processes.
- Apply data minimization, retention schedules, encryption, key rotation, and tested backups.
- Prohibit public blockchain or IPFS storage of identifiable child or health data.
- Keep children and caregivers out of wallet/key-management workflows.
- Test for exclusion caused by lost cards, low literacy, disability, language, no connectivity, or absent caregivers.
- Require human review of AI prioritization and provide an appeal or correction mechanism.
- Maintain incident response, breach notification, safeguarding escalation, and partner offboarding procedures.

---

## 12. Open-Source and Digital Public Good Plan

1. Confirm which Medfinet components the company can release openly.
2. Select an OSI-approved software licence; MIT is a simple default, while a copyleft licence may better preserve downstream openness.
3. Publish source without secrets, production data, private keys, or unsafe deployment defaults.
4. Add `LICENSE`, `README`, `CONTRIBUTING`, `SECURITY`, code of conduct, architecture, API specification, and local demo instructions.
5. Provide synthetic demo data only; never publish real child records.
6. Add a public roadmap, issue templates, release notes, and security disclosure channel.
7. Design the deployable stack so another programme can run it without proprietary Medfinet infrastructure.
8. Prepare for Digital Public Goods Standard review once the prototype and governance are mature.

---

## 13. Application and Evidence Package

For a future UNICEF call or if UNICEF confirms that a submission route remains available, prepare:

- Company registration and beneficial-ownership documents.
- Proof that the company is registered in an eligible programme country.
- Working demo and a short, reliable demo script.
- Public source repository and licence plan.
- Architecture, security, safeguarding, and data-flow diagrams.
- Pilot partner letters and named implementation owners.
- Initial test or deployment results with methodology.
- Public aggregate metrics URL and data dictionary.
- Team biographies mapped to product, clinical/public health, climate, security, and delivery responsibilities.
- Twelve-month milestones, budget, risks, and sustainability model.
- Explanation of global reuse without claiming that every country has the same identity or health workflow.

### Illustrative US$100,000 budget

| Category | Amount |
|---|---:|
| Product and backend engineering | $30,000 |
| Offline worker application and accessibility | $15,000 |
| Security, privacy, safeguarding, and legal review | $12,000 |
| Pilot operations, training, and support | $18,000 |
| Interoperability and climate-data integration | $8,000 |
| Monitoring, evaluation, and public reporting | $10,000 |
| Infrastructure, devices, and NFC/QR materials | $5,000 |
| Contingency | $2,000 |
| **Total** | **$100,000** |

This budget is a planning model, not a UNICEF-approved allocation. It should be replaced with local quotations and named deliverables.

---

## 14. Definition of Project Completion

The MVP is complete only when all of the following are evidenced:

- A real child can be registered with an authorized caregiver and programme context.
- NFC and QR credentials can be issued, resolved, revoked, and replaced.
- No personal or clinical data is stored on credentials or public decentralized storage.
- Organization isolation and minimum-necessary access are proven by tests.
- Consent grant and withdrawal work end to end.
- An emergency profile supports vaccination and nutrition continuity.
- A flood event can produce a lawful, authorized outreach worklist.
- Core actions work offline and synchronize without duplication.
- One external partner integration exchanges data successfully.
- All sensitive access creates searchable audit evidence.
- Public metrics are measurable, current, aggregate, and privacy-preserving.
- Security, privacy, safeguarding, backup recovery, and incident response have been exercised.
- A pilot partner signs off on usability and operational results.
- Source, setup instructions, licence, and contribution guidance are publicly available.

Until those conditions are met, Medfinet should be described as a prototype under development rather than deployed digital public health infrastructure.

---

## 15. Immediate Next Actions

1. Revoke the exposed credential and rotate affected access immediately.
2. Confirm whether Medfinet is a legally registered for-profit entity in Nigeria and who owns its IP.
3. Contact `venturefund@unicef.org` to ask whether late submission, a rolling EOI, or the next Climate Ventures cohort is appropriate; do not imply that an application remains open.
4. Secure a pilot-design meeting with one LGA health authority and a relevant emergency or nutrition partner.
5. Freeze the MVP boundary in this document.
6. Complete Phase 0 before adding new product features.
7. Build identity, authorization, consent, and audit foundations before AI, rewards, or additional blockchain functionality.
8. Collect baseline data and partner approvals before stating impact targets.
