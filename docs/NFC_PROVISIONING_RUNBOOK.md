# NTAG215 Provisioning and Field Runbook

## Approved hardware

- Genuine NXP NTAG215 PVC card
- 13.56 MHz, ISO/IEC 14443-A, NFC Forum Type 2
- 504-byte user memory
- Printable CR80 form factor
- Supplier must provide traceable part and batch information

Buy 10-20 samples first. Do not purchase a production batch until the hardware acceptance tests pass.

## Station requirements

- Primary USB station: genuine ACS ACR1552U with current vendor PC/SC driver.
  `station/acr1552uTransport.js` implements its documented transparent-exchange,
  ISO 14443-A Layer 3 and RF-cycle protocol. Do not use keyboard-emulation mode.
- A different reader requires its own reviewed transport adapter and the same
  physical acceptance suite; generic NDEF-only writers are not sufficient.
- Registered Medfinet field device
- Ed25519 or hardware-backed P-256 signing key
- Ability to issue `GET_VERSION`, `READ_SIG`, `PWD_AUTH`, `WRITE`, `READ`, and configuration-page commands
- No application or operator logs containing the card token, PWD, PACK, personalization token, or full NDEF URL

Generic consumer NFC writer applications are not approved for production issuance.

## Preflight

1. Confirm production HTTPS API and tap URLs.
2. Confirm the administrator has recent AAL2 authentication.
3. Confirm the station is registered and its public attestation key is stored.
4. Inspect the blank card with `GET_VERSION` and require the exact NTAG215
   response `0004040201001103`; reject NTAG213, NTAG216, malformed and unknown
   responses.
5. Read and verify the NXP originality signature.
6. Confirm the card UID has not already been enrolled.

## Write sequence

1. Create the Medfinet NFC draft.
2. Write the returned Type 2 user-memory image starting at page 4.
3. Read the UID and `READ_SIG`, verify originality, sign the preparation
   payload, and submit it to prepare the binding.
4. Use the returned `stationPlan`; do not calculate configuration bytes in the
   station UI. For NTAG215 it targets CFG0 page 131, ACCESS page 132, PWD page
   133, and PACK page 134.
5. While `AUTH0` is still at its factory-disabled value, program the returned
   PWD and PACK exactly in the returned byte order.
6. Write CFG0 exactly as returned. This enables the 21-byte UID + `x` + counter
   mirror and makes writes from page 4 onward require the new PWD.
7. Authenticate using the new PWD and require the expected PACK. Then write
   ACCESS as `17000000`: public reads, password-protected writes, counter
   enabled, public counter mirror, and authentication-attempt limit 7.
8. Verify the complete NDEF, mirror, UID, counter, PWD and PACK before the
   irreversible step.
9. Write ACCESS as `57000000` to set `CFGLCK`. Do not set static or dynamic
   user-memory lock bits.
10. Remove the card from the RF field and tap it again.
11. Verify:
    - the NDEF URI opens the expected Medfinet hostname;
    - the fragment has the 21-character `14-hex UID + x + 6-hex counter` value;
    - the mirrored UID matches the hardware UID;
    - a write without PWD fails;
    - PWD authentication returns the expected PACK;
    - configuration changes fail after the power cycle.
12. Activate the binding in Medfinet.
13. Print only the Medfinet branding, instructions, support reference, and QR fallback. Do not print health data.

## Field scan

1. Tap in the registered Medfinet Scanner.
2. Request a one-time challenge.
3. Read NDEF, actual UID, NFC counter, and `READ_SIG`.
4. Sign the canonical `MEDFINET_NTAG215_SCAN_V2` payload with the device key.
5. Resolve the scan within 60 seconds.
6. Continue to consent-controlled or emergency-controlled clinical APIs.

## Failure handling

| Failure | Action |
| --- | --- |
| Wrong chip/version | Quarantine and return to supplier |
| Originality verification fails | Quarantine; never activate |
| UID already bound | Investigate duplicate or attempted reuse |
| Write-protection test fails | Do not activate; replace the card |
| Counter moves backward/repeats | Treat as replay/clone signal and investigate |
| Card lost | Revoke immediately and issue an atomic replacement |
| Scanner lost | Mark device `LOST`; its attestation key is no longer accepted |
| Provisioning expires | Discard secrets and start a new draft |

## Production acceptance test

- 20 genuine cards provision successfully.
- Zero card or child secrets appear in API, proxy, browser, or station logs.
- Copied NDEF URL yields no child information.
- Copied URL cannot complete a scanner challenge.
- Modified token, UID, signature, counter, challenge, or device signature is rejected.
- Replayed challenge and repeated counter are rejected.
- Revoked and rotated cards are rejected.
- Card works on supported Android devices and opens the public status page on supported iPhones.
- QR fallback is separately revocable and does not reuse the NFC card token.
