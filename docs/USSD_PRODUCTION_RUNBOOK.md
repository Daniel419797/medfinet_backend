# Medfinet Production USSD Runbook

## Delivered scope

The USSD channel implements all ten approved workflow groups:

1. Appointment lookup, confirmation, reschedule request, and clinic contact/location.
2. Minimal upcoming vaccination reminder, confirmation, and callback request.
3. Lost-card temporary suspension and replacement request.
4. Public participating-facility lookup by area.
5. Vaccination, nutrition, emergency, card-problem, and general callback queues.
6. Narrow, expiring caregiver consent approval or decline.
7. Pending vaccination, nutrition, climate-response, and outreach interest.
8. Service-delivery confirmation, non-receipt, and dispute.
9. Non-cash points balance and pending merchant-redemption confirmation.
10. Evacuation, health support, household safety, temporary-clinic, and urgent-need requests.

USSD never returns a clinical record, vaccination history, reusable reward token, full child identity, or credential secret. Operational requests are pending and reviewable. A lost-card report temporarily suspends both the credential and NFC binding immediately; final revocation/replacement remains an authorized worker action.

## Security contract

- The phone must be verified and enrolled by an owner/admin using recent AAL2 authentication.
- A memory-hard scrypt hash protects the caregiver's 4-6 digit PIN. Five failed attempts cause a 15-minute lock.
- Card suspension/replacement, consent decisions, and reward redemption confirmations require an action-bound six-digit SMS OTP after PIN authentication.
- Phone routing uses an HMAC digest; global session/router tables contain only the digest and last four digits.
- Authenticated session state, menu position, and replay responses are encrypted with AES-256-GCM and bound to the provider session identifier.
- Tenant-owned actions use PostgreSQL forced row-level security and tenant-bound foreign keys.
- Consent is limited to 1-4 approved `READ` categories, an identified recipient/purpose, a caregiver with consent authority, and a maximum 24-hour pending decision window.
- Provider requests must pass through a trusted ingress which adds `X-Medfinet-USSD-Timestamp` and `X-Medfinet-USSD-Signature`. The signature is `HMAC-SHA256(USSD_WEBHOOK_SECRET, timestamp + "." + rawRequestBody)`. Requests older than 120 seconds fail closed.
- Logs contain error codes and request identifiers, not phone numbers, PINs, OTPs, menu input, or clinical data.

## Provider deployment

The first adapter accepts the Africa's Talking form contract: `sessionId`, `serviceCode`, `phoneNumber`, and cumulative `text`. Start the public ingress with `npm run ussd:ingress` and configure the provider callback as:

`https://<public-ingress-host>/callback/<USSD_PROVIDER_CALLBACK_TOKEN>`

The ingress preserves the exact form body, applies a public rate limit, adds the Medfinet HMAC headers, and forwards it to:

`POST /api/v1/webhooks/ussd/africas-talking`

The endpoint returns `text/plain` beginning with `CON` or `END`. Never expose the internal signed endpoint directly to an unsigned public callback.

Production activation requires an assigned live service code/shortcode and callback URL from the provider. The sandbox is suitable for pre-production simulation; the live account and operator approval are external prerequisites.

## Environment

Generate separate random values of at least 32 characters. Do not reuse JWT or NFC secrets.

```dotenv
USSD_PROVIDER=africas_talking
USSD_WEBHOOK_SECRET=<gateway-shared-hmac-secret>
USSD_PHONE_PEPPER=<phone-routing-hmac-secret>
USSD_PIN_PEPPER=<pin-hash-pepper>
USSD_OTP_PEPPER=<otp-and-action-hmac-secret>
USSD_STATE_ENCRYPTION_KEY=<base64-encoded-random-32-byte-key>
USSD_PROVIDER_CALLBACK_TOKEN=<unguessable-public-path-token>
USSD_BACKEND_WEBHOOK_URL=https://<api-host>/api/v1/webhooks/ussd/africas-talking
USSD_INGRESS_PORT=3002
USSD_SESSION_TTL_SECONDS=180
USSD_OTP_TTL_SECONDS=300
USSD_MAX_RESPONSE_CHARACTERS=160
```

The notification gateway must accept immediate SMS requests at `NOTIFICATION_GATEWAY_URL` authenticated by `NOTIFICATION_GATEWAY_TOKEN`. It receives the `MEDFINET_USSD_OTP` template contract. OTP plaintext is sent directly and is not persisted in Medfinet. Facility details use durable, localized `USSD_FACILITY_DETAILS` notification messages and outbox events; the destination is resolved only at delivery time and is not stored in those records.

## Administrative API

All requests require authentication, `x-organization-id`, and `x-access-purpose`. Sensitive setup/review routes additionally require recent Supabase AAL2.

- `PUT /api/v1/caregivers/:caregiverId/ussd-access`
- `POST /api/v1/facilities/:facilityId/ussd-directory`
- `POST /api/v1/ussd/consent-requests`
- `GET /api/v1/ussd/queues/:type?status=PENDING`
- `POST /api/v1/ussd/queues/:type/:id/review`

Queue types are `appointments`, `callbacks`, `cards`, `programmes`, `deliveries`, `rewards`, and `climate`. USSD confirmation alone is not absolute proof of identity or service delivery.

## Facility publication

Populate administrative area, address, telephone, opening hours, and programme categories, then publish the facility. Only this explicitly safe directory projection is searchable without authentication. Temporary clinics use `isTemporary` and `temporaryUntil`.

## Scheduled operations

Run at least once per minute and alert on failure:

```powershell
npm.cmd run ussd:cleanup
```

It expires abandoned sessions, OTP challenges, consent requests, and stale reward reservations.

## Deployment acceptance

1. Run `npm.cmd run db:migrate:deploy`; confirm `prisma migrate status` is current.
2. Run `npm.cmd run build` and `npm.cmd test`.
3. Enroll a caregiver. Confirm an unsigned callback fails and a correctly signed callback returns `CON`.
4. Replay the exact callback and confirm the exact cached response is returned.
5. Exercise English, Hausa, Yoruba, and Igbo menus.
6. Test PIN lockout and wrong/expired OTP behavior.
7. Report a disposable NFC card lost and confirm public tap returns `SUSPENDED`.
8. Verify every negative/disputed response appears in its tenant queue.
9. Confirm the SMS provider does not retain or log OTP content beyond its agreed security policy.
10. Monitor `/health`, `/ready`, webhook latency, OTP failures, PIN lockouts, queue age, and cleanup failures.

## Verified locally

- Prisma validation and generation passed.
- All 30 migrations applied to a fresh PostgreSQL 16 database; `prisma migrate status` reported the schema current.
- A live non-superuser PostgreSQL verification exercised all ten workflow groups, durable SMS/outbox continuation, NFC suspension, OTP, provider PIN/root/replay behavior, and cross-tenant RLS. Every persisted-action assertion passed.
- Signed form-encoded HTTP callbacks, public-ingress forwarding, stale/unsigned rejection, encrypted-session replay, and ciphertext-tamper rejection passed automated tests.
- The complete backend suite passed with 277 tests; Prisma generation and the production syntax/build gate passed.

Live shortcode allocation, mobile-network delivery, production SMS credentials, and deployed ingress health cannot be proven from this repository. Record those checks during environment deployment.
