# Open-source Release Checklist

Use this checklist before publishing the first tagged Medfinet Backend release and for material public releases afterward.

## Legal and repository health

- [ ] `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` and `GOVERNANCE.md` are present and current.
- [ ] All bundled source, generated artifacts, specifications and sample data have compatible licences and required attribution.
- [ ] Repository description, topics and project links are current.
- [ ] Branch protection and required checks are enabled for `main`.
- [ ] GitHub private vulnerability reporting is enabled where available.

## Privacy and security

- [ ] Git history and the current tree have been scanned for secrets, credentials, private keys and wallet mnemonics.
- [ ] No real child, caregiver, organization, facility or partner data is present in source, tests, logs or examples.
- [ ] Dependency audit results have been reviewed and high/critical findings resolved or explicitly documented.
- [ ] Authentication, authorization, organization isolation, consent, emergency access and audit trails have received focused review.
- [ ] Webhooks, workers and offline synchronization are authenticated, replay-resistant and idempotent.
- [ ] Algorand TestNet operations are verified before any MainNet enablement.

## Quality and operations

- [ ] `npm ci` succeeds from a clean checkout.
- [ ] `npm run check`, `npm test` and `npm run build` pass.
- [ ] Prisma migrations apply cleanly to a fresh database and an upgrade test database.
- [ ] API compatibility and rollback implications are documented.
- [ ] Worker, webhook, NFC, USSD and blockchain failure paths fail safely.
- [ ] Backup, migration, monitoring and rollback procedures are documented for the target deployment.

## Documentation and claims

- [ ] Setup instructions work from a clean environment.
- [ ] Every required environment variable is documented in `.env.example` and configuration guidance.
- [ ] Known limitations and unvalidated integrations are stated clearly.
- [ ] No clinical, regulatory, interoperability, security or performance claim exceeds available evidence.
- [ ] Release notes distinguish implemented features from pilot or production readiness.

## Release

- [ ] Version and changelog are updated.
- [ ] The release commit is reviewed and signed/tagged according to maintainer policy.
- [ ] A GitHub release is created with migrations, security notes, limitations and verification commands.
- [ ] Deployment monitoring and rollback steps are ready.
