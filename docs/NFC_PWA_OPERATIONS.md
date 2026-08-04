# Medfinet NTAG215 PWA operations

## Supported workflow

1. An administrator creates an NFC draft in `/nfc/provision`.
2. The raw-NFC encoder first registers a device key. An owner or administrator
   grants its dedicated provisioning capability through a step-up-authenticated
   action. Ordinary PWA scanner devices do not receive this capability.
3. The approved raw-NFC encoder reads UID and `READ_SIG`, verifies originality,
   writes the generated Type 2 image, enables UID/counter mirroring, enables the
   counter, applies write-only password protection and locks configuration.
4. The approved station reads the protected result back, signs the exact
   activation evidence, and the administrator activates the card. Unsigned
   protection or configuration-lock claims are rejected.
5. A public tap opens the PHI-free status page. Active, expired, revoked and
   replaced cards receive distinct guidance without revealing a child identity.
6. An authenticated worker opens `/nfc/scanner`. The PWA registers a P-256
   browser device key. The worker taps the card again inside the Web NFC
   scanner; the PWA rejects a browser-reported hardware UID that differs from
   the chip-mirrored UID, then signs a one-time server challenge.
7. A successful PWA scan evaluates consent. Routine allergy, vaccination and
   clinical actions remain redacted unless one active grant covers every required
   scope. Allowed and denied decisions both create disclosure evidence. The
   separate step-up emergency workflow remains available when clinically justified.

## Browser and device requirements

- Android device with NFC enabled.
- Current Chrome release with Web NFC support.
- HTTPS in production. `localhost` is accepted for development only.
- Online connection for card resolution. Card tokens are deliberately not
  retained for offline resolution.
- Supabase session and active Medfinet organization membership.

Manual card-URL entry is compiled into development builds only. Production
clinical resolution requires Web NFC on Android Chrome and a fresh physical
tap. Desktop and iOS browsers can open the PHI-free public status page but
cannot resolve a clinical record through the PWA scanner.

## Required environment

Backend:

```text
NFC_TAP_BASE_URL=https://app.example.org/nfc/tap
NFC_UID_PEPPER=<at least 32 random characters>
NFC_PROVISIONING_SECRET=<at least 32 random characters>
NFC_REQUIRE_ORIGINALITY_ATTESTATION=true
```

Frontend:

```text
VITE_MEDFINET_API_URL=https://api.example.org/api/v1
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<public anon key>
```

Never put the NFC UID pepper, provisioning secret, PWD, PACK, service-role key,
or card token in frontend environment variables.

## Provisioning-station signature contract

The station signs UTF-8 canonical payloads separated by a single line-feed
(`0A`). Values are not JSON encoded and no trailing line-feed is added.

Preparation (`MEDFINET_NTAG215_PROVISION_V3`):

```text
MEDFINET_NTAG215_PROVISION_V3
<bindingId>
<personalizationToken>
0004040201001103
<uppercase 14-hex UID>
<uppercase 64-hex READ_SIG response>
ORIGINALITY_VERIFIED
```

Activation (`MEDFINET_NTAG215_ACTIVATE_V2`):

```text
MEDFINET_NTAG215_ACTIVATE_V2
<bindingId>
<personalizationToken>
<cardToken>
<uppercase 14-hex UID, literal lowercase x, uppercase 6-hex counter>
<exact NDEF URL read-back>
<uppercase CFG0 page 131 read-back>
57000000
<uppercase 4-hex PWD_AUTH PACK response>
WRITE_PROTECTED
CONFIGURATION_LOCKED
```

The API accepts base64url Ed25519 signatures or P-256 ECDSA signatures. The
station key must already be registered to the same subject and organization,
remain active, and have explicit administrator-approved NFC provisioning
capability. Any read-back change invalidates the activation signature.

## Scheduled lifecycle job

The standard outbox worker performs NFC cleanup every minute. A scheduler can
also invoke the same idempotent cleanup manually:

```powershell
npm.cmd run nfc:cleanup
```

It marks expired pending bindings as failed, revokes their unused credentials,
removes draft public routes, and expires stale one-time scan challenges. The job
is idempotent and performs every tenant mutation inside the tenant RLS context.

## Recovery

- Interrupted before card write: cancel the pending binding.
- Interrupted after write but before protection: do not issue the card; resume
  only while the one-time authorization remains in memory, otherwise cancel and
  create a new draft.
- Interrupted after configuration lock: verify the readback. If verification
  cannot be completed, mark the draft failed and physically destroy the card.
- Lost card: revoke it. The public status route remains available to show safe
  revoked guidance.
- Replaced card: use atomic replacement; the old card reports `REPLACED` and can
  never resolve a child.

## Monitoring signals

Alert on repeated occurrences of:

- `NFC_DEVICE_ATTESTATION_FAILED`
- `NFC_COUNTER_REPLAYED`
- `NFC_CARD_ATTESTATION_MISMATCH`
- `NFC_SCANNER_NOT_ATTESTED`
- `NFC_ORGANIZATION_ACCESS_DENIED`

Logs include only safe error codes, status, route and request ID. They must not
contain UID, card token, NDEF content, child identity, PWD or PACK.
