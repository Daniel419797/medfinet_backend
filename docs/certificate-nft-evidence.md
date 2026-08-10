# Vaccination certificate NFT evidence

Medfinet represents each version of a vaccination certificate as a one-of-one
Algorand Standard Asset (ASA) while keeping all child identity and clinical data
off-chain.

## What the NFT means

The existing Algorand fingerprint anchor remains the timestamped integrity proof
for the vaccination record. After that immunization anchor is confirmed, the
outbox worker queues a certificate NFT mint for the same versioned fingerprint.

A certificate NFT is created with:

- total supply: `1`
- decimals: `0`
- asset name: `Medfinet Vaccine Certificate`
- unit name: `MFVAX`
- no public asset URL
- no manager, reserve, freeze or clawback address
- the 32-byte vaccination SHA-256 fingerprint as the ASA metadata hash

The asset therefore commits to the certificate proof without publishing the
certificate image or its clinical fields.

## What is never put on Algorand

The NFT does not publish the child's name, date of birth, sex, Medfinet ID,
organization ID, internal child ID, vaccine code, dose, date administered, lot
number, route, site, clinical notes, facility, vaccinator, caregiver, NFC data,
or certificate PNG.

The public chain sees only generic ASA parameters, the 32-byte cryptographic
commitment, the platform creator address, the asset ID and normal Algorand
transaction data.

## Private receipt

Medfinet stores the mapping between the private certificate proof and the public
asset in `certificate_nft_receipts`. The receipt records the tenant,
immunization, proof ID, fingerprint version, fingerprint, network, asset ID,
mint transaction, confirmed round, platform creator and confirmation time.

Receipt lookups are tenant-bound. The asset ID alone is not used to locate a
child or clinical record.

## Lifecycle

- A newly recorded immunization is fingerprint-anchored first. Once the anchor
  confirms, the worker queues its certificate NFT.
- A corrected/amended immunization gets a new fingerprint and therefore a new
  NFT. The old asset remains historical and is not mutated into the replacement.
- Legacy/current records that predate this feature are backfilled when an
  authenticated user opens/downloads the certificate or asks for certificate
  evidence.
- If Algorand is disabled, both anchor and NFT outbox work remain pending rather
  than being marked as published.

## Verification

The certificate evidence endpoint verifies both layers independently:

1. the existing fingerprint anchor receipt and exact Algorand transaction note;
2. the certificate NFT receipt, mint transaction, creator, asset ID, supply,
   decimals, metadata hash, absence of an asset URL, absence of administrative
   asset addresses and positive confirmation round.

The nested NFT evidence reports `DISABLED`, `PENDING`, `CONFIRMED`, `MISMATCH`
or `UNAVAILABLE`. A client must not present the NFT as verified unless the
current status is `CONFIRMED`.

The certificate QR continues to identify the deterministic vaccination proof.
That proof is sufficient for the authenticated evidence endpoint to resolve the
current anchor and associated NFT without embedding child data or requiring an
asset ID to exist before the PNG is rendered.
