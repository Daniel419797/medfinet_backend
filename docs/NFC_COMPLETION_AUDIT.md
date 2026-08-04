# NFC Completion Audit

**Audited:** 29 July 2026  
**Target:** Genuine NXP NTAG215 cards with an installable Web NFC PWA

## Implemented and verified in software

- Exact NTAG215 `GET_VERSION` validation and the 21-character mirrored
  `UID + x + counter` contract.
- Opaque fragment credential, derived per-card PWD/PACK, protected writes,
  counter configuration and irreversible configuration-lock station plan.
- Draft, preparation, signed activation, expiry, cancellation, revocation and
  atomic replacement lifecycle.
- Approved-station device keys and signed preparation, activation and scan
  attestations; one-time challenges and counter replay rejection.
- Safe public card status and authenticated PWA resolution with identity and
  clinical data redacted until the required consent exists.
- Vaccination and emergency workflow entry points, tenant isolation, audit
  evidence, rate limits, cleanup worker and operator runbooks.
- Production frontend build, backend syntax/build checks and 237 automated
  backend tests.
- Fresh application of all 24 migrations to PostgreSQL and a live database
  lifecycle covering provision, activate, public recognition, authenticated
  resolution, consent redaction, replay rejection and revocation.
- Authenticated HTTP lifecycle verification covering organization authorization,
  recent AAL2 enforcement, controllers, rate limits, persistence, public status,
  PWA resolution, replay rejection and revocation.
- Reader-independent station core and orchestration workflow covering exact raw
  commands, card-swap rejection, NDEF verification, PWD/PACK authentication,
  protected writes, CFGLCK, RF field cycling, signed evidence ordering,
  fail-closed cancellation and quarantine. These pass a deterministic NTAG215
  transport emulator; they are not a substitute for physical-reader evidence.
- A concrete ACS ACR1552U PC/SC transparent-exchange adapter with strict
  BER-TLV/status parsing, ISO 14443-A Layer 3 selection, bounded RF cycling and
  deterministic APDU contract tests.

The reusable live-database checks are `npm.cmd run nfc:verify:integration` and
`npm.cmd run nfc:verify:http`. They use test-only data and must be pointed at a
disposable test database. The HTTP verifier runs a loopback identity-provider
stub and never accepts that stub in the deployed application configuration.

## Not yet physically or operationally proven

These items require hardware, an approved environment or external authority;
they cannot be truthfully certified by source code alone:

1. Obtain the selected ACS ACR1552U and connect its native PC/SC host session to
   the existing reviewed adapter. The PWA can
   read NDEF on supported Android browsers, but browser Web NFC cannot issue
   the raw `READ_SIG`, `PWD_AUTH` and configuration commands used to provision
   and lock a card.
2. Verify NXP originality signatures through an approved NXP SDK or implement
   backend verification using officially licensed verification material.
3. Run the acceptance batch on at least 20 genuine NTAG215 cards, including
   write protection, RF power-cycle configuration lock, copied-NDEF, clone,
   replay, revoked-card and replacement tests.
4. Run authenticated browser journeys against the deployed API, real Supabase
   tenant and production-like Android devices.
5. Complete deployment health, monitoring, load/security testing, incident
   procedures and operational approval.

## Completion decision

The NFC application layer is implemented and has live PostgreSQL evidence. NFC
is not yet production-certified because the raw encoder integration, genuine
card acceptance evidence and deployed environment proof remain open gates.
