# Backend Configuration

All runtime configuration is loaded from environment variables through `config/index.js`. The application fails at startup when a required value is missing or malformed; it does not substitute production credentials, service endpoints, or security-sensitive defaults.

## Local setup

1. Copy `.env.example` to `.env`.
2. Replace every `replace-with-...` value with a real development credential.
3. Generate a random `JWT_SECRET` containing at least 32 characters.
4. Use a newly rotated Pinata JWT. Do not reuse the credential that was previously committed to source.
5. Keep `.env` out of Git. Only `.env.example` is intended for source control.

The repository includes a local `.env` template with placeholders, but the API will not be operational until those placeholders are replaced.

## Production

Configure the same names in the deployment platform's secret manager. Do not upload or commit a production `.env` file. Restrict `CORS_ORIGINS` to the exact deployed frontend origins and use separate credentials for development, staging, and production.

## Required variables

See `.env.example` for the complete list covering the API, database, Supabase, Algorand, storage providers, explorer links, and retained campaign settings. Operational settings such as `JWT_EXPIRES_IN` and `ALGORAND_CONFIRMATION_ROUNDS` are environment-specific as well; do not reintroduce them as source literals.

After changing credentials, run:

```powershell
npm.cmd test
npm.cmd start
```

The previously source-controlled Pinata credential must be revoked in Pinata's dashboard and its activity reviewed. Removing it from the current source tree does not invalidate copies in Git history.
