# Security Policy

## Supported versions

Security fixes are developed for the latest code on `main`. Forks, old commits and third-party deployments may not receive coordinated fixes.

## Reporting a vulnerability

Do **not** open a public issue for a suspected vulnerability.

Use GitHub's private **Report a vulnerability** option when it is available for this repository. Otherwise email **danieladedayooluwole@gmail.com** with the subject `Medfinet backend security report`.

Include, where possible:

- affected endpoint, worker, integration and commit or deployment;
- clear reproduction steps using synthetic data and sandbox credentials;
- expected and observed behaviour;
- realistic impact and required attacker access;
- relevant request/response details with secrets and personal data removed;
- a minimal proof of concept that does not access or damage systems or data you do not own.

Do not perform denial-of-service testing against public deployments. Do not access, modify, download or disclose real child, caregiver, organization or partner data.

## Security boundaries

Reports are especially relevant when they affect:

- authentication, token validation or session trust;
- role authorization and organization/tenant isolation;
- exposure or mutation of clinical and identity records;
- consent, emergency access and audit logging;
- NFC provisioning, tap validation and device trust;
- webhook authentication, replay protection and idempotency;
- offline synchronization and conflict handling;
- Algorand wallet custody, network selection, transaction preparation and signing;
- secret handling, configuration validation and deployment defaults;
- injection, unsafe parsing, SSRF, file handling or unbounded resource use.

## Response process

The maintainers will acknowledge a complete report as soon as reasonably possible, investigate it privately, coordinate a fix and credit the reporter when requested and appropriate. Timelines depend on severity, reproducibility and maintainer availability.

This project currently operates without a paid bug-bounty programme. Good-faith research that follows this policy is welcome.

## Security invariants

Contributions must preserve these properties:

- every protected read or mutation is authenticated and authorized at the backend boundary;
- one organization must not be able to read or mutate another organization's data;
- emergency access is explicit, bounded, auditable and revocable where applicable;
- real clinical records and secrets must never be committed or used in tests;
- webhook and asynchronous operations are authenticated, replay-resistant and idempotent;
- blockchain transactions are prepared and submitted on the explicitly selected network, and private wallet material remains server-side;
- public blockchain records contain no directly identifying health information;
- unsafe or uncertain state fails closed rather than silently bypassing validation.
