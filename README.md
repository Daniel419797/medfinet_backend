# Medfinet Backend

Production USSD implementation and deployment guidance: [docs/USSD_PRODUCTION_RUNBOOK.md](docs/USSD_PRODUCTION_RUNBOOK.md). Product/security decisions are recorded in [docs/USSD_PRODUCTION_DECISION_BRIEF.md](docs/USSD_PRODUCTION_DECISION_BRIEF.md).

Medfinet is being developed as a consent-governed digital child identity and continuity-of-care platform for health, nutrition, and climate-emergency settings.

## Current status

The versioned Medfinet API now includes tenant identity and clinical continuity,
consent and emergency access, climate-response worklists, offline synchronization,
rewards and settlement accounting, notifications, FHIR/DHIS2 interoperability,
privacy-preserving analytics, localization governance, retention/legal holds, and
data-subject-request workflows.

This repository is not yet cleared for production launch. The evidence matrix
tracks external and operational gates such as deployed PostgreSQL and HTTP proof,
provider sandboxes, penetration testing, recovery testing, legal review, approved
translations, frontend completion, and deployed health verification. Legacy
crowdfunding and raw blockchain routes are not mounted by the production API.

## Setup

1. Copy `.env.example` to `.env`.
2. Replace every placeholder with a development credential or endpoint.
3. Install dependencies with `npm.cmd ci` on Windows.
4. Run `npm.cmd test` and `npm.cmd run check`.
5. Apply migrations with `npm.cmd run db:migrate:deploy`.
6. Start the API with `npm.cmd start` and the worker with `npm.cmd run worker`.

The API intentionally refuses to start while placeholder configuration remains.

## Documentation

- [Configuration](./docs/configuration.md)
- [Medfinet proposal](./docs/medfinet-proposal.md)
- [Developer specification](./docs/developer-specification.md)
- [Phase 1 identity API](./docs/phase-1-identity-api.md)
- [NFC completion audit](./docs/NFC_COMPLETION_AUDIT.md)
- [NTAG215 station integration](./docs/NTAG215_STATION_INTEGRATION.md)
- [UNICEF Climate Ventures readiness and implementation plan](./docs/unicef-climate-ventures-readiness-plan.md)
- [Production decision brief](./docs/production-decision-brief.md)
- [Production requirements and evidence matrix](./docs/production-requirements-matrix.md)

## Security

Never commit `.env`, database URLs, API tokens, wallet mnemonics, private keys, or identifiable child health information. Public blockchain records may contain only non-identifying proof material.
