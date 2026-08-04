# Medfinet NTAG215 Production Architecture

**Decision date:** 29 July 2026  
**Hardware target:** Genuine NXP NTAG215 PVC cards, NFC Forum Type 2, 504-byte user memory  
**Scope checkpoint:** The wider Medfinet roadmap is paused after the child-identifier slice. NFC is the only active product track.

## Security position

NTAG215 is available and affordable, but it is not a cryptographic smart card. It has:

- a factory-programmed 7-byte UID;
- an ECC-based NXP originality signature retrievable with `READ_SIG`;
- UID and 24-bit NFC-counter mirroring into an NDEF message;
- a 32-bit password and 16-bit PACK for memory access protection;
- configurable negative authentication limits and configuration locking.

It does **not** provide AES authentication, secure messaging, or a per-tap message authentication code. A URL copied from a card is therefore not sufficient evidence of physical-card possession. The public tap page must never disclose child identity or clinical data.

Primary manufacturer references:

- [NXP NTAG213/215/216 product page](https://www.nxp.com/products/NTAG213_215_216)
- [NXP NTAG213/215/216 data sheet](https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf)

## Trust boundaries

1. The card stores an NDEF URL containing:
   - a random public routing identifier;
   - a random 256-bit card credential;
   - a mirrored UID and NFC counter.
2. All card values are in the URL fragment. Fragments are not sent in the initial HTTP request, reverse-proxy URL, or HTTP `Referer`.
3. The landing page posts the values to the public recognition endpoint and receives only a recognized/inactive result.
4. Record resolution requires:
   - an authenticated worker;
   - an active organization membership in an approved care role;
   - an active registered scanner device;
   - a one-time 60-second backend challenge;
   - an Ed25519 or hardware-backed P-256 device signature over the entire scan;
   - the actual UID, counter, card token, and enrolled originality signature;
   - a counter greater than the last accepted scanner counter.
5. A successful challenge is consumed exactly once and every resolution is audited.

## Assurance levels

| Level | Evidence | Permitted result |
| --- | --- | --- |
| `BASIC_NDEF` | Public ID, card token, mirrored UID | Card status only; no child or health data |
| `DEVICE_ATTESTED_ORIGINALITY_BOUND` | Registered device signature, one-time challenge, enrolled UID and originality signature, increasing counter | Minimum child identity needed to locate the record |
| Consent or emergency authorization | Separate Medfinet policy evaluation after the child is located | Scope-specific clinical information |

The NFC result is never a replacement for authorization, consent, or emergency-access policy.

## Provisioning lifecycle

1. An owner or administrator completes recent AAL2 step-up authentication.
2. Medfinet creates a 15-minute provisioning session, random card token, public ID, and Type 2 memory image.
3. An approved station reads the actual UID and `READ_SIG` response and verifies the NXP originality signature.
4. Medfinet binds the UID and signature hashes and derives a per-card PWD/PACK using an HMAC-protected provisioning secret.
5. The station writes the NDEF message and configures:
   - UID + NFC counter mirror;
   - NFC counter enabled;
   - public counter mirroring;
   - password-protected writes from page 4;
   - reads left public;
   - authentication-attempt limit 7;
   - configuration lock enabled;
   - no irreversible user-memory lock.
6. The station power-cycles and reads the card back.
7. Medfinet activates only after the mirrored UID matches, write protection is verified, configuration locking is verified, and originality evidence is present.

PWD and PACK are never stored in the database. They are deterministically derived from a managed secret, UID, and random public ID and are returned only during the short provisioning ceremony.

## Card data

Allowed:

- public routing ID;
- random card credential;
- chip-mirrored UID;
- chip-mirrored NFC counter.

Prohibited:

- child name or date of birth;
- Medfinet ID;
- caregiver information;
- vaccination, nutrition, allergy, appointment, or emergency data;
- organization or facility name;
- reusable worker credentials.

## Replacement and loss

Replacement is atomic:

- the old binding becomes revoked;
- the old credential becomes rotated;
- its public route is removed;
- a new credential and provisioning session are created with a replacement link.

The old card can no longer be recognized even if its NDEF content is copied. A physical card should never be reused for another child.

## Known hardware limitation

NTAG215’s password is sent over the NFC air interface and is not a cryptographic authentication mechanism. It protects against casual rewriting, not a sophisticated radio attacker. The device-attested challenge is therefore mandatory for record resolution.

Hardware launch proof still requires genuine sample cards, an approved raw-NFC station, NXP originality verification, Android Keystore attestation testing, and physical clone/replay/write-protection tests.

Both provisioning phases are station-attested. Preparation signs the UID,
`READ_SIG` response, originality decision, and one-time authorization. Activation
requires a separate signature over the protected read-back, mirrored UID/counter,
card token, and asserted write/configuration locks. The API does not accept an
administrator's unsigned protection checkbox as hardware evidence.

## PWA operating mode

The installable NFC PWA supports Chrome on NFC-enabled Android devices through
Web NFC. It generates a non-exportable P-256 signing key in IndexedDB, registers
the corresponding public key as a field device, signs every one-time scan
challenge, and never persists card tokens in the offline queue.

The PHI-free landing page discards the URL fragment and does not hand its card
token to the clinical scanner. The worker must perform a second physical Web
NFC tap. The PWA compares `NDEFReadingEvent.serialNumber` with the UID mirror
before it requests a challenge. Manual URL resolution is development-only and
is absent from production builds.

Web NFC can read the NDEF URL and therefore the mirrored UID/counter and opaque
card token. Browser APIs cannot execute NTAG215 `READ_SIG`, `PWD_AUTH`, or raw
configuration-page commands. PWA resolutions are consequently labelled
`AUTHENTICATED_PWA_NDEF`, while an approved raw scanner is labelled
`DEVICE_ATTESTED_ORIGINALITY_BOUND`. Both require an authenticated active worker,
an active registered device, a 60-second one-time challenge, a strictly
increasing counter, tenant authorization and audit logging. Emergency access
still requires step-up authentication and its separate time-limited workflow.

The PWA is suitable as the operational interface and authenticated identity
shortcut. Initial card protection and independent chip-originality proof still
require an approved raw-NFC encoder. The UI must not describe PWA scans as
cryptographic chip authentication.

Raw provisioning capability is disabled on every newly registered device. An
owner or administrator must explicitly approve a keyed station using recent AAL2
step-up authentication. The approval actor and timestamp are stored, audited and
enforced by a database check; ordinary PWA scanner registration cannot self-grant
the capability.
