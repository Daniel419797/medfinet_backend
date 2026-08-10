# Blockchain Implementation Plan

## SOLID-Driven Architecture

---

## 1. SOLID Principles

### S — Single Responsibility

| Class | Responsibility | Reason to change |
|---|---|---|
| `AnchorEvent` | Value object representing one anchor | New event type fields |
| `AlgorandAdapter` | Raw Algorand transaction submission | Algorand SDK upgrade, network config |
| `BlockchainAnchorService` | Build + dispatch anchor payloads | New anchoring strategy |
| `NfcChainService` | NFC-specific anchor logic | NFC lifecycle changes |
| `AnchorOutboxHandler` | Outbox → blockchain bridge | Outbox protocol change |
| `AnchorReceiptRepository` | Persist + query anchor receipts | Storage backend change |

### O — Open for extension, Closed for modification

Adding a new event type requires:
- One registry entry in `eventTypes.js`
- One `outbox.emit()` call in the service

No core service code changes.

```js
// eventTypes.js — the only file to touch for new event types
const EVENT_TYPES = Object.freeze({
  CONSENT_GRANT:       { code: 0x01, category: 'consent' },
  CONSENT_WITHDRAWAL:  { code: 0x02, category: 'consent' },
  EMERGENCY_ACCESS:    { code: 0x03, category: 'governance' },
  IDENTITY_AMENDMENT:  { code: 0x04, category: 'governance' },
  SUBJECT_REQUEST:     { code: 0x05, category: 'governance' },
  NFC_ACTIVATE:        { code: 0x06, category: 'nfc' },
  NFC_REVOKE:          { code: 0x07, category: 'nfc' },
  NFC_REPLACE:         { code: 0x08, category: 'nfc' },
});
```

### L — Liskov Substitution

`AlgorandAdapter` implements `ChainAdapter` interface. Future chains (e.g., a private ledger) implement the same interface. Services never depend on Algorand directly.

```js
// Interface (documented, not enforced via JS)
class ChainAdapter {
  async submitTransaction(note, fee) {}       // returns { txId, blockHeight }
  async getTransaction(txId) {}               // returns { txId, note, timestamp, confirmed }
  getExplorerUrl(txId) {}                     // returns human-readable URL
}
```

### I — Interface Segregation

Consumers get only what they need:

```js
// NFC service only depends on this narrow interface
class NfcChainPort {
  async anchorActivation(bindingId, publicId, childId, tenantId) {}
  async anchorRevocation(bindingId, publicId, tenantId) {}
  async verifyIssuance(publicId) {}
}
```

### D — Dependency Inversion

```
High-level (services/consentService.js)
    ↓ depends on abstraction
AnchorDispatcher (interface)
    ↑ implemented by
Low-level (adapters/algorandAdapter.js)
```

Dependencies injected via constructor:

```js
class BlockchainAnchorService {
  constructor(adapter, eventTypeRegistry, receiptStore) {
    this.adapter = adapter;            // ChainAdapter implementation
    this.registry = eventTypeRegistry; // event type config
    this.receipts = receiptStore;      // anchor receipt persistence
  }
}
```

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Service Layer                         │
│  consentService   emergencyService   nfcService   ...    │
│       │                │                │                │
│       └────────┬───────┴────────┬───────┘                │
│                ▼                ▼                         │
│         outbox.emit('blockchain.anchor', payload)        │
│                          │                                │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                    Outbox Worker                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │         AnchorOutboxHandler                       │    │
│  │  dispatches to → BlockchainAnchorService          │    │
│  │                   │                               │    │
│  │                   ▼                               │    │
│  │         ┌─────────────────┐                       │    │
│  │         │  ChainAdapter    │  ← interface           │    │
│  │         │  (abstraction)   │                       │    │
│  │         └────────┬────────┘                       │    │
│  │                  │                                 │    │
│  │         ┌────────▼────────┐                       │    │
│  │         │AlgorandAdapter  │                       │    │
│  │         │(implementation) │                       │    │
│  │         └─────────────────┘                       │    │
│  │                                                  │    │
│  │  On success: store receipt in PostgreSQL          │    │
│  │  On failure: retry (max 3), then dead-letter      │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Security

### 3.1 What goes on-chain (nothing identifiable)

```
On-chain note (35 bytes):
┌────────┬────────┬──────────────────────────────────────┐
│ 2 bytes │ 1 byte │             32 bytes                  │
│ version│  type  │  sha256(tenant_id + anchor_id +        │
│ 0x0001 │  code  │  iso_timestamp + nonce)               │
└────────┴────────┴──────────────────────────────────────┘
```

No card UIDs, no public IDs, no child IDs, no wallet addresses, no clinical data.

### 3.2 Key management

```
Platform wallet mnemonic:
  └── NEVER in code, env files, or logs
  └── Loaded via ALGORAND_PLATFORM_WALLET_MNEMONIC env var
  └── In production: injected via secrets manager (not .env)
  └── Separate wallets for TestNet and MainNet
  └── Wallet holds only enough ALGO for tx fees (not a hot wallet)
```

### 3.3 Defenses

| Risk | Mitigation |
|---|---|
| Replay attack | Each anchor includes a unique nonce; duplicate hashes are detectable |
| Fee exhaustion | Monitor wallet balance; alert when below threshold (e.g., 50 ALGO) |
| Network congestion | Configurable `maxFee` cap; skip if fee exceeds cap |
| Private key leak | Platform wallet has no authority (can only self-send 0-value TXs) |
| Adapter compromise | `ChainAdapter` returns only `txId` + `blockHeight` — no raw key access |
| Timing attack | Timestamps are coarse (seconds); nonce provides entropy |

### 3.4 Rate limiting

Blockchain anchoring is behind the existing rate limiter:

```
scope: 'blockchain-anchor'
limit: 60 per minute per tenant
```

---

## 4. Speed & Performance

### 4.1 Async by default

The API never waits for Algorand:

```
API request (e.g., consent grant)
  ↓ (2ms)
outbox.emit('blockchain.anchor', ...)
  ↓
Respond to client immediately (200 OK)
  ↓ (background)
Outbox worker → AlgorandAdapter.submitTransaction()
  ↓ (~4.5s Algorand block time)
Store receipt in `anchor_receipts` table
```

### 4.2 Batch anchoring

Multiple pending anchors are batched into a single Algorand transaction where possible:

```js
// Instead of 10 separate TXs:
// 1 TX with concatenated notes (max 1KB note = ~28 anchors per TX)
async submitBatch(anchors) {
  const note = Buffer.concat(anchors.map(a => a.toBuffer()));
  return this.adapter.submitTransaction(note, fee);
}
```

Batch window: 500ms debounce. Anchors arriving within that window are grouped.

### 4.3 Connection pooling

Algorand SDK connections are reused (not created per request):

```js
class AlgorandAdapter {
  constructor(config) {
    this.client = new algosdk.Algodv2(config.token, config.server, config.port);
    // Single instance, reused for all submissions
  }
}
```

### 4.4 Caching

`verifyAnchor()` results cached in PostgreSQL `anchor_receipts` table — no need to re-query Algorand for the same anchor:

```js
async getReceipt(anchorId) {
  // Check local cache first (fast, ~1ms)
  const cached = await this.receipts.findByAnchorId(anchorId);
  if (cached) return cached;
  // Fall back to Algorand query (slow, ~2-5s)
  return this._queryChain(anchorId);
}
```

---

## 5. Maintainability

### 5.1 File structure

```
services/
├── blockchain/
│   ├── BlockchainAnchorService.js    — orchestrates anchoring
│   ├── adapters/
│   │   ├── ChainAdapter.js           — interface definition
│   │   └── AlgorandAdapter.js        — Algorand implementation
│   ├── ports/
│   │   └── NfcChainPort.js           — NFC-specific narrow interface
│   ├── eventTypes.js                 — registry (the only file to edit)
│   ├── AnchorReceipt.js              — value object
│   └── AnchorOutboxHandler.js        — outbox → blockchain bridge
└── anchorReceiptRepository.js        — PostgreSQL persistence
```

### 5.2 Adding a new event type (example)

```js
// 1. Add to eventTypes.js
const EVENT_TYPES = { ..., NEW_EVENT: { code: 0x09, category: 'new' } };

// 2. Emit from the service
outbox.emit('blockchain.anchor', { eventType: 'NEW_EVENT', eventId: id, tenantId });

// 3. Done. No other code changes.
```

### 5.3 Switching chains (example)

```js
// new adapter, same interface
class HederaAdapter extends ChainAdapter { ... }

// inject via config
const adapter = config.chain === 'hedera'
  ? new HederaAdapter(config.hedera)
  : new AlgorandAdapter(config.algorand);
```

---

## 6. Manageability

### 6.1 Observability

| Metric | Where | What it tracks |
|---|---|---|
| `blockchain.anchors.attempted` | Counter | Total anchors submitted |
| `blockchain.anchors.confirmed` | Counter | Anchors confirmed on-chain |
| `blockchain.anchors.failed` | Counter | Anchors that failed after retries |
| `blockchain.anchors.latency` | Histogram | Time from emit to chain confirmation |
| `blockchain.wallet.balance` | Gauge | Platform wallet ALGO balance |

### 6.2 Dashboard

Grafana panel showing:
- Anchor throughput (last 24h)
- Confirmation success rate
- Wallet balance with alert threshold
- Retry queue depth
- Dead-letter count

### 6.3 Health check

```
GET /ready → also checks: can Algorand adapter connect to its node?
If adapter is configured but unreachable → return 503
```

### 6.4 Admin operations

```
POST /api/v1/admin/blockchain/reindex
  — Re-anchors events that have no receipt (disaster recovery)

GET /api/v1/admin/blockchain/wallet
  — Returns wallet balance + estimated days remaining
```

### 6.5 Circuit breaker

If Algorand is down for >5 minutes, the adapter opens the circuit:

```
State: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing)
  CLOSED: anchors pass through
  OPEN (5 consecutive failures): anchors go to dead-letter queue, no submission
  HALF_OPEN (after 60s): try one anchor; success → CLOSED, fail → OPEN
```

---

## 7. Readability

### 7.1 Coding standards

- Each function does one thing (SRP at the function level)
- No magic numbers — all constants named:
  ```js
  // Bad
  const note = Buffer.alloc(35);
  
  // Good
  const VERSION_BYTES = 2;
  const TYPE_BYTE = 1;
  const HASH_BYTES = 32;
  const NOTE_LENGTH = VERSION_BYTES + TYPE_BYTE + HASH_BYTES;
  ```
- Error messages explain what happened and why:
  ```js
  throw new DomainError({
    code: 'ANCHOR_SUBMISSION_FAILED',
    message: `Failed to anchor event ${eventId}: ${error.message}`,
    status: 502,
  });
  ```

### 7.2 Naming conventions

| Pattern | Example |
|---|---|
| Services do things | `BlockchainAnchorService.anchorEvent()` |
| Adapters connect to things | `AlgorandAdapter.submitTransaction()` |
| Ports are minimal interfaces | `NfcChainPort.verifyIssuance()` |
| Repositories store things | `AnchorReceiptRepository.findByAnchorId()` |
| Handlers process things | `AnchorOutboxHandler.handle()` |

---

## 8. Reliability

### 8.1 Retry policy

| Attempt | Delay | Condition |
|---|---|---|
| 1st | 0s (immediate) | Any failure |
| 2nd | 10s | Network error, timeout, node unreachable |
| 3rd | 60s | Same as above |
| After 3rd | Dead-letter queue | Manual review + replay |

### 8.2 Dead-letter queue

Separate DB table `blockchain_dead_letters`:

| Column | Purpose |
|---|---|
| `id` | UUID |
| `original_payload` | Full anchor request |
| `error` | Last error message |
| `failed_at` | Timestamp |
| `retry_count` | Attempts made |
| `status` | `pending_review` / `replayed` / `abandoned` |

Admin API to replay: `POST /api/v1/admin/blockchain/dead-letters/:id/replay`

### 8.3 Consistency guarantee

```
┌──────────────────────────────────────────────────┐
│ outbox_event                                      │
│ id: uuid, status: 'pending'                       │
│                                                   │
│  ↓ worker picks up                                 │
│                                                   │
│ anchor_receipts (PostgreSQL)                       │
│ tx_id, event_type, event_id, tenant_id,            │
│ confirmations, created_at                          │
│                                                   │
│  ↓ success → mark outbox as 'completed'            │
│  ↓ failure → retry or dead-letter                 │
└──────────────────────────────────────────────────┘
```

If the worker crashes between submitting to Algorand and saving the receipt, the next retry detects the existing transaction via `txId` lookup and idempotently stores the receipt.

### 8.4 Rollback scenario

If MainNet has a critical issue:
- Set `ALGORAND_ENABLED=false` — all anchors become no-ops
- Dead-letter queue preserves pending anchors
- No data loss; no feature outage

---

## 9. Implementation Order

| Phase | Deliverables | Criteria |
|---|---|---|
| **P1** | `ChainAdapter` interface, `AlgorandAdapter`, `eventTypes.js`, `AnchorReceipt` value object, `AnchorReceiptRepository` | Unit tests pass; TestNet wallet funded |
| **P2** | `BlockchainAnchorService`, `AnchorOutboxHandler`, outbox event types registered | Consent grant → anchor appears on TestNet explorer |
| **P3** | `NfcChainPort`, NFC lifecycle events → anchored | NFC activation → TestNet anchor |
| **P4** | Verification endpoint, admin dashboard, circuit breaker, metrics | `GET /governance/anchors/:id` returns receipt |
| **P5** | Grafana dashboard, wallet balance alerts, dead-letter replay UI | Ops team can manage anchors without code |
| **P6** | MainNet switch | Legal review, funded MainNet wallet, staging verification |

Each phase is independently shippable and backwards-compatible.

---

## 10. File Checklist

```
New files (7):
├── services/blockchain/ChainAdapter.js              ← interface
├── services/blockchain/adapters/AlgorandAdapter.js  ← implementation
├── services/blockchain/BlockchainAnchorService.js   ← orchestrator
├── services/blockchain/eventTypes.js                ← registry
├── services/blockchain/AnchorReceipt.js             ← value object
├── services/blockchain/ports/NfcChainPort.js        ← NFC port
├── services/blockchain/AnchorOutboxHandler.js       ← outbox bridge
├── services/anchorReceiptRepository.js              ← persistence
├── services/blockchain/AnchorCircuitBreaker.js      ← reliability
│
Test files (4):
├── test/unit/blockchain/anchor-service.test.js
├── test/unit/blockchain/algorand-adapter.test.js
├── test/unit/blockchain/circuit-breaker.test.js
├── test/integration/blockchain/testnet-anchor.test.js

Modified files (~12):
├── config/index.js                                  — add algorand section
├── .env.example                                     — +ALGORAND_* vars
├── scripts/process-outbox.js                        — +AnchorOutboxHandler
├── services/consentService.js                       — +outbox.emit('blockchain.anchor')
├── services/emergencyAccessService.js               — +outbox.emit(...)
├── services/childIdentityAmendmentService.js        — +outbox.emit(...)
├── services/dataSubjectRequestService.js            — +outbox.emit(...)
├── services/nfcActivationService.js                 — +outbox.emit(...)
├── services/nfcLifecycleService.js                  — +outbox.emit(...)
├── controllers/governance.js                        — +anchor verification endpoint
├── middleware/rateLimit.js                          — +'blockchain-anchor' scope
└── utils/logger.js                                  — +blockchain-specific structured fields
```

All modified files only add an `outbox.emit()` call or a config entry — zero refactoring of existing logic.
