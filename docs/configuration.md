# Backend Configuration

All runtime configuration is loaded from environment variables through `config/index.js` and focused configuration modules such as `config/riskScoring.js`. The application fails at startup when a required value is missing or malformed; it does not substitute production credentials, service endpoints, or security-sensitive defaults.

## Local setup

1. Copy `.env.example` to `.env`.
2. Replace every `replace-with-...` value with a real development credential.
3. Generate a random `JWT_SECRET` containing at least 32 characters.
4. Use a newly rotated Pinata JWT. Do not reuse the credential that was previously committed to source.
5. Keep `.env` out of Git. Only `.env.example` is intended for source control.

The repository includes a local `.env` template with placeholders, but the API will not be operational until those placeholders are replaced.

## Production

Configure the same names in the deployment platform's secret manager. Do not upload or commit a production `.env` file. Restrict `CORS_ORIGINS` to the exact deployed frontend origins and use separate credentials for development, staging, and production.

## Risk-scoring policies

Duplicate detection, reward anomaly prioritization, and climate worklist prioritization use versioned deterministic policies loaded by `config/riskScoring.js`. Defaults are documented in `.env.example`.

- Duplicate detection normalizes Unicode and punctuation, supports explicitly reviewed local alias groups, detects swapped first/last names, and treats exact, near, and day/month-swapped dates as separate evidence. `DUPLICATE_NAME_ALIASES_JSON` must contain only aliases validated by local reviewers; the software must not infer ethnicity or identity from a name.
- Reward anomaly checks use a bounded velocity window. Amount baselines exclude the record being scored, require a minimum peer count, blend sparse merchant history with organization history, and apply a dispersion floor when historical amounts are identical.
- Climate worklists use an explainable 0–100 deterministic score derived from the existing vulnerability level, displacement, structured hazard exposure, and assessment staleness. The score is a prioritization aid, not a predicted probability and not a basis for denying care.

Every result includes a policy version and evidence factors. Policy changes should be reviewed, documented, and evaluated against human-labelled pilot outcomes before deployment. The repository does not claim that the default values are calibrated to a representative Nigerian dataset.

## Required variables

See `.env.example` for the complete list covering the API, database, Supabase, Algorand, storage providers, explorer links, retained campaign settings, and optional deterministic risk-scoring controls. Operational settings such as `JWT_EXPIRES_IN` and `ALGORAND_CONFIRMATION_ROUNDS` are environment-specific as well; do not reintroduce them as source literals.

After changing credentials, run:

```powershell
npm.cmd test
npm.cmd start
```

The previously source-controlled Pinata credential must be revoked in Pinata's dashboard and its activity reviewed. Removing it from the current source tree does not invalidate copies in Git history.
