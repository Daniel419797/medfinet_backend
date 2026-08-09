# Contributing to Medfinet Backend

Thank you for helping improve Medfinet. Contributions from backend engineers, health-interoperability specialists, security reviewers, data-protection practitioners, blockchain developers and documentation writers are welcome.

## Project status and safety

Medfinet is pre-production software. It is not a medical device, clinical decision system or substitute for qualified medical judgement. Never use real patient records, identifiable child data, production credentials, provider tokens, wallet mnemonics or private keys in development, tests, logs, issues or pull requests.

## Before opening a change

- Search existing issues and pull requests.
- Open an issue first for new APIs, schema migrations, authorization changes, clinical workflows, blockchain contracts, external integrations or public claims.
- Use synthetic or de-identified data only.
- Report vulnerabilities privately according to [SECURITY.md](./SECURITY.md).
- Keep backward compatibility and migration impact explicit.

## Local setup

Use a currently supported Node.js LTS release and PostgreSQL-compatible development database.

```bash
git clone https://github.com/Daniel419797/medfinet_backend.git
cd medfinet_backend
npm ci
cp .env.example .env
npm run db:generate
npm run dev
```

Use local or sandbox credentials only. Never commit `.env`, database URLs, Supabase service-role keys, webhook tokens, NFC secrets or Algorand wallet material.

## Development workflow

1. Fork the repository and create a focused branch from `main`.
2. Keep changes small and avoid unrelated refactors.
3. Add regression tests for behaviour and security-boundary changes.
4. Preserve tenant isolation, role authorization, auditability and idempotency.
5. Document new environment variables, migrations, API contracts and operational steps.
6. Run the relevant checks before submitting:

```bash
npm run check
npm test
npm run build
```

For database changes, include a reviewed Prisma migration and explain rollback or compatibility implications.

## Pull requests

A pull request should explain:

- the problem and why the change is needed;
- the source-to-sink or request-to-storage path affected;
- API, database, worker and deployment impact;
- security, privacy and clinical-safety considerations;
- tests performed and any validation that remains;
- migration, rollout and rollback requirements.

Maintainers may request a smaller scope, additional tests, threat analysis, interoperability evidence or specialist review.

## Contribution licence

By intentionally submitting a contribution for inclusion in this project, you agree that it is provided under the Apache License 2.0 and confirm that you have the right to submit it. Do not contribute code, specifications, data or assets whose licence is incompatible or unclear.

## Community standards

Participation is governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Project decisions follow [GOVERNANCE.md](./GOVERNANCE.md).
