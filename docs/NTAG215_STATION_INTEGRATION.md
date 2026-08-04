# NTAG215 Station Integration Contract

The production station core lives in `station/ntag215Station.js`. It owns the
security-critical command order and must not be reimplemented inside a reader
driver or UI.

The selected reference reader is the ACS ACR1552U. Its reviewed protocol codec
is `station/acr1552uTransport.js`. The adapter uses the vendor-documented PC/SC
2.0 Part 3 transparent session, ISO 14443-A Layer 3 selection and explicit RF
off/on commands. A host binding must supply a connected `pcsc` object with
`transmit(apdu)` and, optionally, `close()`; this keeps native driver ownership
outside the security-critical card state machine.

## Transport boundary

A physical reader adapter supplies only:

```js
{
  transceive(commandBuffer): Promise<Buffer>,
  cycleField(): Promise<void>
}
```

`transceive` sends raw NTAG21x commands and returns the unmodified card
response. The adapter must not translate ACK/NAK values, reverse PWD/PACK byte
order, retry writes silently, or log command payloads. `cycleField` must remove
RF power long enough for NTAG215 configuration-lock state to take effect and
then require the operator to present the same card again.

The reader adapter must serialize all operations per reader, impose bounded
command timeouts, reject concurrent card sessions, and expose reader/card
removal as explicit errors. Reader firmware and driver versions must be pinned
and recorded as non-secret station metadata.

## Originality verification boundary

The station constructor also requires `verifyOriginality({ uid, signature,
version })`. Production must connect this to an approved NXP verification SDK
or licensed verification implementation. Returning `true` without performing
cryptographic verification is forbidden outside the emulator tests.

## Enforced workflow

`station/ntag215ProvisioningWorkflow.js` coordinates the backend and card:

1. Create a one-time pending binding.
2. Inspect exact `GET_VERSION`, UID and `READ_SIG` evidence.
3. Sign that evidence with the approved station key and ask the backend to
   authorize preparation.
4. Write the authorized NDEF image, card-specific PWD/PACK and configuration.
5. Authenticate, verify dynamic UID/counter readback, set `CFGLCK`, cycle RF,
   authenticate again, and prove configuration writes are rejected.
6. Sign the complete physical readback and activate the binding.

The workflow cancels the pending binding and requires physical quarantine if a
failure occurs before activation. An ambiguous activation response is not
silently retried or cancelled because the server may already have committed;
the operator must reconcile the binding status before proceeding.

## Driver acceptance requirements

Before approving an ACR1552U host binding or any alternative adapter, run the
station tests plus the physical acceptance suite in `NFC_PROVISIONING_RUNBOOK.md`.
Record at minimum:

- reader model, firmware, host OS and driver version;
- genuine NTAG215 supplier and lot;
- exact raw-command support for `60`, `30`, `3C00`, `A2` and `1B`;
- ACK/NAK behavior, timeouts, card-removal behavior and RF field cycling;
- twenty-card successful batch and every negative/clone/replay test.

Do not select a reader merely because it can write NDEF. It must expose raw
Type 2 commands and reliable RF field control.
