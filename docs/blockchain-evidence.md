# Blockchain evidence and privacy

Medfinet uses Algorand as an append-only integrity timestamp, not as a clinical
database. Clinical and identity records remain in the tenant-isolated Medfinet
database.

## Public transaction data

An evidence anchor is a zero-ALGO payment from the platform account back to the
same platform account. Its note is exactly 35 bytes:

- 2 bytes: evidence-note version (`0x0001`)
- 1 byte: allowlisted event code
- 32 bytes: SHA-256 digest of the tenant, deterministic proof ID, timestamp,
  and a random nonce

The public note does **not** contain an organization ID, user ID, child ID,
record ID, name, date of birth, vaccine code, dose, batch or lot number,
clinical note, NFC identifier, or the unhashed proof ID. The retired
vaccination ASA/NFT path is disabled so it cannot publish clinical metadata or
URLs.

## Database-only evidence

The private anchor receipt stores the proof ID, organization, event code,
transaction ID, confirmed round, timestamp, nonce, digest, and confirmation
metadata. Immunization records and amendments use canonical, versioned SHA-256
fingerprints (`v1`) so logically identical JSON evidence produces the same
proof ID.

## Certificate evidence states

- `DISABLED`: Algorand anchoring is disabled for the deployment.
- `PENDING`: the current fingerprint has no receipt and is queued.
- `CONFIRMED`: the receipt, expected claim, exact transaction ID and note,
  platform-signed zero payment, and positive confirmation round all match.
- `UNCONFIRMED`: every integrity check matches but the transaction has not
  reached a positive confirmed round.
- `MISMATCH`: a receipt or live transaction integrity check differs.
- `UNAVAILABLE`: the Algorand node could not be queried reliably.

Certificate QR payloads identify the deterministic proof and fingerprint
schema version. They do not claim confirmation; clients must call the
authenticated certificate-evidence endpoint for current status.
