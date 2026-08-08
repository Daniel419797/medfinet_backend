# Backend Configuration

All runtime configuration is loaded from environment variables through `config/index.js` and focused configuration modules such as `config/riskScoring.js`. The application fails at startup when a required value is missing or malformed; it does not substitute production credentials, service endpoints, or security-sensitive defaults.

## Local setup

1. Copy `.env.example` to `.env`.
2. Replace every `replace-with-...` value with a real development credential.
3. Generate a random `JWT_SECRET` containing at least 32 characters.
4. Generate distinct peppers and encryption keys for the security variables documented in `.env.example`.
5. Keep `.env` out of Git. Only `.env.example` is intended for source control.

The repository includes a local `.env` template with placeholders, but the API will not be operational until those placeholders are replaced.

## Production

Configure the same names in the deployment platform's secret manager. Do not upload or commit a production `.env` file. Restrict `CORS_ORIGINS` to the exact deployed frontend origins and use separate credentials for development, staging, and production.

## Algorand networks

`ALGORAND_ENABLED=true` enables the blockchain capability API and allows the authenticated frontend to expose blockchain evidence, donation, escrow, and Pera Wallet controls.

The deployment can offer TestNet, MainNet, or both:

```env
ALGORAND_DEFAULT_NETWORK=testnet
ALGORAND_ALLOWED_NETWORKS=testnet,mainnet
```

The frontend sends the selected value in `x-algorand-network`. The backend validates it against `ALGORAND_ALLOWED_NETWORKS` and creates the Algod client, Pera chain response, explorer link, transaction preparation, and submission path for that network. TestNet remains the recommended default. MainNet actions use real ALGO and should be enabled only after TestNet validation.

The base `ALGORAND_ALGOD_*` and `ALGORAND_EXPLORER_TRANSACTION_URL` values configure the default network and preserve compatibility with existing deployments. Optional network-specific values override them:

```env
ALGORAND_TESTNET_ALGOD_SERVER=https://testnet-api.algonode.cloud
ALGORAND_TESTNET_ALGOD_PORT=443
ALGORAND_TESTNET_ALGOD_TOKEN=
ALGORAND_TESTNET_EXPLORER_TRANSACTION_URL=https://testnet.explorer.perawallet.app/tx

ALGORAND_MAINNET_ALGOD_SERVER=https://mainnet-api.algonode.cloud
ALGORAND_MAINNET_ALGOD_PORT=443
ALGORAND_MAINNET_ALGOD_TOKEN=
ALGORAND_MAINNET_EXPLORER_TRANSACTION_URL=https://explorer.perawallet.app/tx
```

`ALGORAND_PLATFORM_WALLET_MNEMONIC` remains a backend-only secret. The same Algorand account address can exist on both networks, but its TestNet and MainNet balances are independent. Never expose the mnemonic to the frontend or ask a user for a Pera recovery phrase.

Campaign application IDs are network-specific. Donation and withdrawal preparation checks that the application exists on the selected network and returns a clear error when the user selects the wrong network.

Automated server-side anchoring uses `ALGORAND_DEFAULT_NETWORK`. Interactive donation, escrow, health, wallet, and dashboard requests use the network selected in the authenticated frontend.

## Risk-scoring policies

Duplicate detection, reward anomaly prioritization, and climate worklist prioritization use versioned deterministic policies loaded by `config/riskScoring.js`. Defaults are documented in `.env.example`.

- Duplicate detection normalizes Unicode and punctuation, supports explicitly reviewed local alias groups, detects swapped first/last names, and treats exact, near, and day/month-swapped dates as separate evidence. `DUPLICATE_NAME_ALIASES_JSON` must contain only aliases validated by local reviewers; the software must not infer ethnicity or identity from a name.
- Reward anomaly checks use a bounded velocity window. Amount baselines exclude the record being scored, require a minimum peer count, blend sparse merchant history with organization history, and apply a dispersion floor when historical amounts are identical.
- Climate worklists use an explainable 0–100 deterministic score derived from the existing vulnerability level, displacement, structured hazard exposure, and assessment staleness. The score is a prioritization aid, not a predicted probability and not a basis for denying care.

Every result includes a policy version and evidence factors. Policy changes should be reviewed, documented, and evaluated against human-labelled pilot outcomes before deployment. The repository does not claim that the default values are calibrated to a representative Nigerian dataset.

## Required variables

See `.env.example` for the complete list covering the API, database, Supabase, Algorand, notification delivery, integration controls, NFC, USSD, AI, and optional deterministic risk-scoring controls. Operational settings such as `JWT_EXPIRES_IN` and `ALGORAND_CONFIRMATION_ROUNDS` are environment-specific; do not reintroduce them as source literals.

After changing credentials, run:

```powershell
npm.cmd test
npm.cmd start
```
