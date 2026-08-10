# Embedded outbox worker

Medfinet can run the background outbox processor inside the same Node.js process as the HTTP API. This is useful for single-service Render deployments and demos where a separate background worker service is not desired.

Set:

```env
RUN_OUTBOX_WORKER=true
```

The default is disabled. `RUN_OUTBOX_WORKER=false` (or leaving the variable unset) keeps the previous behavior where `npm run worker` is started as a separate process.

When enabled, `app.js` starts the API and the outbox worker together. The worker processes all normal outbox jobs, including Algorand fingerprint anchors and vaccination-certificate NFT mint jobs. `ALGORAND_ENABLED=true` and the existing Algorand wallet/network variables are still required for blockchain jobs.

The web process logs `outbox-worker.embedded.started` when this mode is active. If the embedded worker terminates unexpectedly, the process exits non-zero so the hosting platform can restart the service instead of leaving the API online with a dead queue processor.

Do not also start `npm run worker` in the same Render service when embedded mode is enabled. A separate worker deployment can still be used instead by leaving `RUN_OUTBOX_WORKER` disabled.
