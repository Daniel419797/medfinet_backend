# MedfiNet Backend

**Track:** Health × Blockchain × Climate  
**Stack:** Node.js · Express · Prisma · PostgreSQL · Supabase · Algorand

MedfiNet is a consent-governed digital child identity and continuity-of-care platform for health, nutrition and climate-emergency settings. This repository is the API server: it exposes versioned REST endpoints consumed by the MedfiNet frontend and external integrations.

## Project status

Medfinet is open-source pre-production software. It is not a medical device, clinical decision system or substitute for qualified medical judgement. A successful build or deployment does not establish clinical approval, regulatory compliance, production readiness, provider availability or interoperability certification.

---

## Vision and impact

MedfiNet's mission is to ensure that every child's vaccination record, nutrition intake and emergency-care history can remain available across facility types, connectivity levels and climate-disrupted geographies.

- Issue verifiable digital-health evidence with non-identifying proofs anchored on Algorand.
- Govern cross-facility data sharing with explicit and auditable consent controls.
- Surface climate-response worklists that help authorised field teams prioritise follow-up.
- Support low-connectivity operations through offline queues, NFC and USSD-related workflows.

---

## Repository roles

| Repository | Role | Primary stack | Notable outputs |
|---|---|---|---|
| **`medfinet_backend`** *(this repository)* | Versioned REST API, worker jobs and blockchain integration | Node.js, Express, Prisma, Algorand SDK | Authentication, clinical continuity, NFC, integrations, USSD and evidence services |
| **`medfinet_frontend`** | Caregiver, clinician, administrator, merchant and auditor interfaces | React, Vite, Tailwind CSS, Supabase JS | Browser workflows, offline queues, NFC interfaces and wallet approval flows |

---

## Architecture overview

![MedfiNet Architecture Diagram](./docs/architecture.png)

```text
Browser / Mobile App
       │
       ▼
  Express API
  ├── /api/v1/identity
  ├── /api/v1/campaigns
  ├── /api/v1/rewards
  ├── /api/v1/notifications
  ├── /api/v1/telemedicine
  ├── /api/v1/integrations
  ├── /api/v1/analytics
  ├── /api/v1/governance
  ├── /api/v1/webhooks
  └── /api/v1/public
       │
  ┌────┴────────────────────┐
  │  Supabase Auth (JWT)    │
  │  PostgreSQL (Prisma)    │
  │  Algorand AVM           │
  │  Outbox workers         │
  └─────────────────────────┘
```

### On-chain records

Medfinet is designed to keep directly identifying health information off-chain. Supported blockchain surfaces include campaign escrow transactions and non-identifying cryptographic evidence. Network-specific functionality must be validated on TestNet before MainNet is enabled.

---

## Features

- Supabase JWT authentication and organisation-aware authorization
- identity and clinical-continuity workflows
- consent, emergency access and audit evidence
- NFC provisioning and tap-event processing
- external integration and webhook surfaces
- rewards, settlement and accounting workflows
- outbox-pattern notification delivery
- privacy-preserving aggregate analytics
- localization and governance workflows
- data-subject export and erasure workflows
- climate-response worklists
- optional Algorand TestNet/MainNet evidence and escrow operations

---

## Installation

```bash
git clone https://github.com/Daniel419797/medfinet_backend.git
cd medfinet_backend
npm ci
cp .env.example .env
npm run db:generate
npm run dev
```

Use a currently supported Node.js LTS release and a PostgreSQL-compatible development database.

---

## Configuration

Copy `.env.example` and replace every placeholder with local or sandbox configuration. Important groups include:

| Group | Examples |
|---|---|
| Runtime | `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `REQUEST_BODY_LIMIT` |
| Database | `DATABASE_URL` |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Security | `JWT_SECRET`, device/rate-limit/reward peppers and encryption keys |
| Notifications | gateway, SMS provider and webhook-signing settings |
| Integrations | allowed hosts, provider credentials and payload encryption |
| NFC | tap URL, UID pepper, provisioning secret and originality policy |
| USSD | provider, webhook, state encryption, OTP and ingress settings |
| Algorand | enablement, allowed networks, Algod endpoints, explorer URLs and platform wallet mnemonic |
| AI | optional provider, model, API key and timeout settings |
| Risk policies | versioned duplicate, reward-anomaly and climate-scoring settings |

The API validates production configuration and should not be started with example secrets. Keep service-role keys, wallet mnemonics, private keys and provider credentials exclusively in server-side secret storage. Never commit `.env` files.

For Algorand, keep `ALGORAND_ENABLED=false` until a dedicated wallet and TestNet flow have been validated. The mnemonic shown in examples must never be used to hold real assets.

See [docs/configuration.md](./docs/configuration.md) for detailed rules.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the API with nodemon |
| `npm start` | Start the API |
| `npm run build` | Generate Prisma client and run syntax checks |
| `npm test` | Run the Node test suite |
| `npm run check` | Syntax-check source files |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate:deploy` | Apply committed migrations |
| `npm run db:seed` | Seed reference data |
| `npm run worker` | Start the outbox worker |
| `npm run ussd:ingress` | Start the USSD ingress gateway |

---

## Documentation

| Document | Description |
|---|---|
| [Configuration](./docs/configuration.md) | Environment variables and validation rules |
| [Developer Specification](./docs/developer-specification.md) | API design, authentication and data model |
| [Phase 1 Identity API](./docs/phase-1-identity-api.md) | Identity and clinical-continuity endpoints |
| [NFC Completion Audit](./docs/NFC_COMPLETION_AUDIT.md) | NFC integration coverage and remaining validation |
| [NTAG215 Station Integration](./docs/NTAG215_STATION_INTEGRATION.md) | Hardware provisioning guidance |
| [USSD Production Runbook](./docs/USSD_PRODUCTION_RUNBOOK.md) | USSD deployment guidance |
| [Production Requirements Matrix](./docs/production-requirements-matrix.md) | External gates and evidence tracking |

---

## Deployment

The project includes a `Dockerfile` and a production start command that applies committed Prisma migrations before starting the API. Deployments must provide all required secrets through the hosting platform, restrict CORS to approved origins and use HTTPS for public callbacks.

Deployment instructions are examples, not a guarantee that a particular hosting provider or external integration is production-ready.

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or pull request. Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md), and project decisions follow [GOVERNANCE.md](./GOVERNANCE.md).

Use synthetic or de-identified data only. Never include real patient records, credentials, provider tokens, private wallet material or confidential partner information in issues, tests, logs or pull requests.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](./SECURITY.md) for private reporting instructions and the project's security invariants.

## Release readiness

Maintainers should use [OPEN_SOURCE_RELEASE_CHECKLIST.md](./OPEN_SOURCE_RELEASE_CHECKLIST.md) before publishing the first tagged release or any material public release.

## Contact

For project inquiries, partnerships or collaboration opportunities, email **danieladedayooluwole@gmail.com**.

## License

Copyright 2026 Daniel Praise and Medfinet contributors.

Licensed under the [Apache License 2.0](./LICENSE). Third-party dependencies and assets remain subject to their respective licences. The licence does not grant permission to use the Medfinet name or logos for branding beyond reasonable reference to the origin of the software; see [NOTICE](./NOTICE).
