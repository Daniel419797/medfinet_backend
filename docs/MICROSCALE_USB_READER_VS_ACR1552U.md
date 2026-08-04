# Can the Microscale USB NFC Card Reader Replace the ACS ACR1552U?

## Product assessed

This assessment concerns the generic black USB device advertised by Microscale as **“NFC card reader”**, priced at approximately **NGN 15,000** and shown as sold out in the supplied screenshot.

The visible description says:

> RFID IC M1 card, full protocol HID15693 wireless NFC card reader card issuer/swipe machine with USB.

This is not the PN532 development board previously assessed. The earlier identification was incorrect because the shared redirect did not expose the final product page.

## Decision

**Do not purchase or approve this reader as a replacement for the ACS ACR1552U based on the current listing.**

It may be able to read card identifiers or work with MIFARE Classic/ISO15693 cards, but the listing does not provide enough technical evidence that it can safely provision Medfinet's NTAG215 cards.

USB connectivity alone does not make a reader compatible with the Medfinet provisioning station.

## Missing technical evidence

The Microscale listing does not clearly provide:

- the reader's manufacturer;
- an exact model number;
- the internal NFC controller/chipset;
- USB CCID compliance;
- Windows PC/SC support;
- an official signed Windows driver;
- a vendor API or programmer's reference;
- support for PC/SC transparent exchange;
- ISO 14443-A Layer 3 raw command exchange;
- support for NTAG215 `GET_VERSION`;
- support for NTAG215 `READ_SIG`;
- support for NTAG215 `PWD_AUTH`;
- raw page-level `READ` and `WRITE` commands;
- RF field reset/cycling support;
- extended APDU behavior;
- firmware update and lifecycle support; or
- security and compliance documentation.

Without this information, Medfinet cannot develop or validate a reliable production adapter for the device.

## Important interpretation of the listing

### “IC M1 card”

“M1” commonly refers to MIFARE Classic 1K-compatible cards. NTAG215 is a different NFC Type 2 tag product. A device that reads or writes M1 cards is not automatically capable of performing all required NTAG215 security and configuration commands.

### “HID15693”

This wording is ambiguous. It may mean:

- HID keyboard output, where the reader types a card UID as if it were a keyboard;
- ISO 15693 card support; or
- a poorly translated combination of unrelated specifications.

A keyboard-output reader is unsuitable for Medfinet card issuance because it normally exposes only a card number or UID. Medfinet must exchange raw commands and verify protected card configuration.

### “Card issuer/swipe machine”

This is marketing language, not a defined interoperability or security standard. It does not prove NTAG215 provisioning capability.

## Medfinet requirements

The official issuing station must be able to perform and verify all of the following:

1. Select an ISO 14443-A card at Layer 3.
2. Read the physical UID.
3. Send `GET_VERSION` and require the exact NTAG215 response.
4. Send `READ_SIG` and obtain the 32-byte NXP originality signature.
5. Verify that signature through an approved NXP implementation.
6. Read and write the required Type 2 tag pages.
7. Write the Medfinet NDEF record.
8. Configure UID and NFC-counter mirroring.
9. Configure `AUTH0`, access flags, password and PACK.
10. Execute `PWD_AUTH` and validate the PACK response.
11. Set and verify write protection.
12. Apply the required configuration locks.
13. Read protected data back before activation.
14. Cycle the RF field and reselect the card.
15. Produce signed station evidence for backend activation.

The current Medfinet implementation provides an ACS ACR1552U transport using vendor-documented PC/SC transparent exchange. It does not contain an adapter for this unidentified Microscale reader.

## Comparison

| Requirement | ACS ACR1552U | Microscale generic USB reader |
|---|---|---|
| Exact manufacturer/model known | Yes | Not shown |
| USB connection | Yes | Yes |
| CCID compliance documented | Yes | Not shown |
| PC/SC support documented | Yes | Not shown |
| Official driver/download page | Yes | Not shown |
| Programmer/reference manual | Yes | Not shown |
| Transparent raw NFC commands | Documented and implemented | Not shown |
| Compatible Medfinet adapter | Implemented | Not implemented |
| NTAG215 security-command proof | Requires physical acceptance test | No evidence supplied |
| Suitable for purchase now | Yes, from a reputable supplier | No, pending proof |

## What the seller must provide before reconsideration

Ask Microscale for all of the following:

1. Manufacturer and exact model number.
2. A clear photograph of the label on the rear of the reader.
3. Official datasheet and programmer's manual.
4. Official Windows driver download link.
5. Written confirmation of USB CCID and PC/SC compliance.
6. The USB vendor ID and product ID.
7. Confirmation that the device supports arbitrary ISO 14443-A Layer 3 transparent commands.
8. A working example that sends an NTAG215 `GET_VERSION` command.
9. A working example that sends NTAG215 `READ_SIG` and returns all 32 signature bytes.
10. Confirmation of `PWD_AUTH`, page `READ`, page `WRITE`, RF reset and card reselect support.
11. Return/refund permission if it fails the Medfinet hardware acceptance test.

If the seller cannot supply these, the device should be treated as a UID/access-card reader rather than a Medfinet provisioning reader.

## Could it be used for anything in Medfinet?

Possibly, but only after identifying and testing it. It might be usable for:

- basic card UID demonstrations;
- non-production experiments;
- access-control cards; or
- simple card-presence detection.

It must not be used to issue production Medfinet cards, claim NXP originality, set card protection or activate credentials without passing the full acceptance suite.

## Recommended purchase

Purchase a **genuine ACS ACR1552U** from ACS or a reputable authorized supplier for the first Medfinet issuing station.

ACS documents that the ACR1552U is:

- USB CCID compliant;
- PC/SC compliant;
- compatible with ISO 14443 Type A and B;
- capable of reader/writer operation;
- capable of extended APDU exchange; and
- supported by official drivers and reference documentation.

The ACS reader still requires physical Medfinet acceptance testing with genuine NTAG215 cards and the approved NXP originality verifier, but it matches the transport already implemented in the project.

## Final conclusion

The Microscale reader may be inexpensive and USB-connected, but its listing is too vague for a security-sensitive healthcare credential-issuing station.

**Final decision: do not replace the ACR1552U with this Microscale reader unless its exact identity is established and it passes every Medfinet raw-command and security acceptance test.**

## References

1. Microscale product page shown by the requester: <https://www.microscale.net/products/nfc-card-reader>
2. ACS ACR1552U product information: <https://store.acs.com.hk/products/575/acr1552u-usb-nfc-reader-iv/smart-card-readers/>
3. ACS ACR1552U drivers and documentation: <https://www.acs.com.hk/en/driver/575/acr1552u-usb-nfc-reader-iv/>

