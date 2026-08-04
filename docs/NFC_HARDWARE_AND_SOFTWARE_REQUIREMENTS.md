# Medfinet NFC Hardware and Software Requirements

**Project:** Medfinet  
**NFC technology:** NXP NTAG215  
**Purpose:** Securely create, test and issue Medfinet NFC cards

## Executive summary

Medfinet requires four items to complete physical NFC-card testing and
production issuance:

| Requirement | Type | Cost/access classification | How it is obtained |
| --- | --- | --- | --- |
| Genuine ACS ACR1552U reader | Physical hardware | **Paid — must be purchased** | Buy from ACS or an authorized/reputable supplier |
| Genuine NXP NTAG215 PVC cards or tags | Physical consumables | **Paid — must be purchased** | Buy an initial 20-card test batch from a traceable supplier |
| Official ACS Windows PC/SC driver | Windows software | **Free — downloadable** | Download from the official ACS website |
| Approved NXP originality-signature verification SDK or licensed implementation | Security software/integration | **Access or licence dependent — may be paid** | Request from NXP, an approved SDK provider or an authorized integration partner |

Only the NTAG215 cards are issued to beneficiaries. The reader, Windows driver
and originality-verification software remain under the control of Medfinet or
an approved card-issuing organization.

## 1. Genuine ACS ACR1552U reader

### Classification

- **Paid:** Yes
- **Physical purchase:** Yes
- **Downloadable:** No
- **Quantity:** At least one reader for each card-issuing or card-production
  location

### What it is

The ACS ACR1552U is a USB NFC reader/writer that connects to a Windows
computer. It supports PC/SC communication and the low-level NFC operations
required by Medfinet.

### What Medfinet will use it for

The reader will:

- Confirm that a blank card contains an NTAG215 chip.
- Read the chip's factory UID and originality signature.
- Write the Medfinet NFC address to the card.
- Configure a unique card password and password acknowledgement code.
- Enable the NFC tap counter.
- Protect the card against unauthorized writing.
- Permanently lock the card's security configuration.
- Read the completed card back and verify that it was programmed correctly.

The ACR1552U is primarily a card-issuance tool. It is not required for ordinary
patient taps. Compatible Android phones can read issued cards through the
Medfinet PWA.

### Procurement guidance

Purchase a genuine unit from ACS or a reputable authorized supplier. Avoid
unbranded readers and keyboard-only NFC readers. A suitable reader must expose
raw NFC commands, not only basic NDEF writing.

- Official product information: <https://www.acs.com.hk/en/products/575/>
- Official drivers and manuals: <https://www.acs.com.hk/en/driver/575/acr1552u-usb-nfc-reader-iv/>

## 2. Twenty genuine NXP NTAG215 PVC cards or tags

### Classification

- **Paid:** Yes
- **Physical purchase:** Yes
- **Downloadable:** No
- **Initial quantity:** 20 cards for acceptance testing
- **Later quantity:** Based on the number of beneficiaries and replacement
  stock required

### What they are

These are blank physical NFC products containing NTAG215 chips. NTAG215 chips
can be supplied in different formats, including:

- CR80 PVC cards approximately the size of a bank card;
- adhesive stickers;
- key fobs;
- wristbands; and
- other sealed or waterproof formats.

### Recommended format

For standard Medfinet beneficiary identification, the recommended product is a
**genuine NTAG215 CR80 PVC card**. It is printable, easy to carry and suitable
for adding Medfinet branding, instructions and a separate QR fallback.

Waterproof wristbands or key fobs may be considered for specific field
programmes. Sticker tags are useful for laboratory testing but are not the
preferred primary beneficiary credential.

### Why the first order is 20 cards

The first 20 cards are an acceptance-test batch, not the complete production
order. They will be used to verify:

- consistent programming and configuration locking;
- operation across supported Android phones;
- NFC tap-counter behavior;
- protection against unauthorized rewriting;
- rejection of copied links, replay attempts and modified credentials;
- revocation and card replacement;
- recovery from card removal during programming;
- printing and handling durability; and
- counterfeit, damaged or incorrect-chip rejection.

Some cards may be deliberately corrupted or made unusable during destructive
security tests. A larger production order should be placed only after the
sample batch passes.

### Supplier requirements

The supplier should confirm:

- NXP NTAG215, not NTAG213, NTAG216 or a generic compatible chip;
- 13.56 MHz, ISO/IEC 14443-A, NFC Forum Type 2;
- 504 bytes of user memory;
- traceable manufacturer and batch or lot information; and
- sample testing before a large order is accepted.

NXP NTAG21x technical documentation:
<https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf>

## 3. Official ACS Windows PC/SC driver

### Classification

- **Paid:** No
- **Physical purchase:** No
- **Downloadable:** Yes
- **Expected licence:** Supplied by ACS for use with the reader

### What it is

The PC/SC driver is Windows software that enables the operating system and the
Medfinet provisioning station to communicate with the ACR1552U reader.

The communication path is:

```text
Medfinet provisioning station
            |
            v
Official ACS Windows PC/SC driver
            |
            v
ACS ACR1552U USB reader
            |
            v
NXP NTAG215 card
```

Without the correct driver, Windows may detect the USB reader but the Medfinet
station may be unable to send the raw commands required for signature reading,
password authentication, counter configuration and security locking.

### How to obtain it

Download it free of charge from the official ACS ACR1552U support page:

<https://www.acs.com.hk/en/driver/575/acr1552u-usb-nfc-reader-iv/>

Do not download the driver from an unofficial third-party driver website.

## 4. NXP originality-signature verification SDK or licensed implementation

### Classification

- **Paid:** Possibly
- **Physical purchase:** No
- **Downloadable:** Sometimes, depending on provider access
- **Licence or approval required:** Usually yes for production integration
- **Final commercial status:** Must be confirmed with NXP or the selected
  authorized provider

### What it is

A genuine NTAG215 contains a factory-generated cryptographic originality
signature. The ACR1552U can read that signature, but separate approved software
is required to verify it cryptographically.

The verification implementation checks that:

- the originality signature is valid;
- the signature corresponds to the card's UID;
- the chip is consistent with genuine NXP manufacturing; and
- a supplier has not merely copied a Medfinet NFC address onto an unknown chip.

### Why its price cannot yet be labelled simply free or paid

The exact verification material, documentation and integration route may be
subject to NXP access controls, licence terms, a commercial SDK, an authorized
partner agreement or a hardware-vendor SDK. Therefore it must currently be
classified as **access/licence dependent and potentially paid**.

Medfinet should obtain written confirmation covering:

- SDK or verification-library price;
- development and production licence terms;
- permitted deployment environments;
- access to the required verification keys or certificates;
- maintenance and update arrangements; and
- whether verification runs locally at the station or in the backend.

No unverified function that automatically returns “genuine” should be used in
production.

## How all four requirements work together

1. An administrator creates a pending Medfinet NFC-card assignment.
2. A blank NTAG215 card is placed on the ACR1552U reader.
3. The ACS driver carries commands between the Medfinet station and the reader.
4. The reader obtains the chip version, UID and originality signature.
5. The approved NXP verification implementation verifies that signature.
6. Medfinet writes the card-specific address, password and counter settings.
7. The reader verifies write protection and permanently locks the security
   configuration.
8. The backend activates the card only after receiving signed evidence of the
   completed physical checks.
9. The card is printed and issued to the beneficiary.
10. Health workers subsequently tap the card with compatible phones using the
    Medfinet PWA.

## Procurement checklist

- [ ] Purchase one genuine ACS ACR1552U reader for the initial issuing station.
- [ ] Purchase 20 genuine NXP NTAG215 CR80 PVC cards from a traceable supplier.
- [ ] Download the official ACS Windows PC/SC driver at no charge.
- [ ] Request commercial and technical terms for an approved NXP originality
      verification implementation.
- [ ] Record reader model, serial number, firmware and driver version.
- [ ] Record card supplier, chip claim, batch/lot and purchase documentation.
- [ ] Complete the 20-card acceptance test before ordering production volume.
- [ ] Do not issue cards until originality verification, write protection and
      configuration-lock testing have passed.

## Cost summary

| Item | Free | Paid | Notes |
| --- | :---: | :---: | --- |
| ACS ACR1552U USB reader | No | **Yes** | One-time hardware purchase per issuing station |
| NTAG215 PVC cards/tags | No | **Yes** | Recurring consumable; begin with 20 test cards |
| Official ACS Windows PC/SC driver | **Yes** | No | Download only from ACS |
| NXP originality-verification SDK/integration | To be confirmed | Possibly | Depends on NXP/provider access and production licence terms |

## Important limitation

NTAG215 is suitable for the selected Medfinet PWA workflow, but it is not a
banking-grade secure-element card. Medfinet therefore combines the chip with
server-side revocation, per-card credentials, tap-counter replay detection,
approved-station signatures, consent controls and minimum-data disclosure.
Physical production should not begin until the reader and initial card batch
have passed the documented acceptance tests.
