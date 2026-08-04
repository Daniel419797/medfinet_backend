# Medfinet USSD Production Decision Brief

**Approved:** 29 July 2026  
**Scope:** All ten caregiver and field-access USSD capabilities  
**Primary adapter:** Africa's Talking, behind a provider-neutral contract

## Product objective

Provide safe basic-phone access to Medfinet where smartphones or mobile data
are unavailable. USSD complements the PWA, NFC card and SMS notification
channels. It never exposes full clinical records or grants emergency clinical
access.

## Approved security policy

| Risk level | Operations | Required assurance |
| --- | --- | --- |
| Public | Facility and temporary-clinic discovery; emergency guidance | No login; strict rate limits; no personal or clinical data |
| Account | Appointment/vaccination reminder; rewards balance; ordinary callback | Verified caregiver phone plus USSD PIN |
| High | Consent decision; card suspension/replacement; reward redemption | Verified phone, USSD PIN and short-lived SMS OTP |

- Phone numbers use normalized E.164 form. Provider session records retain only
  a keyed phone digest and last four digits.
- PINs and OTPs are one-way hashed, attempt limited, expiring and never logged.
- A shared shortcode may serve multiple organizations. Ambiguous caregiver
  accounts receive a safe organization menu without child names.
- English, Hausa, Yoruba and Igbo are supported with English fallback.
- Provider callbacks are authenticated, replay protected, idempotent, rate
  limited and bounded in size and duration.

## Workflow decisions

1. **Appointments:** show the next bounded appointment; confirmation records a
   caregiver response; rescheduling creates a clinic-review request; facility
   details may continue by SMS.
2. **Vaccination reminders:** show only the next visit date and facility, never
   vaccination history; confirmation or callback request is allowed.
3. **Lost NFC card:** high-assurance confirmation temporarily suspends card use;
   replacement remains pending until assisted identity verification.
4. **Facility discovery:** public administrative-area search returns active
   facilities and programme categories; detailed directions continue by SMS.
5. **Callback requests:** vaccination, nutrition, emergency and card issues
   create prioritized, auditable work items for a verified caregiver without
   exposing health details. Public users can still find emergency facilities.
6. **Consent:** USSD can decide only a clinic-created, narrow, expiring request;
   it cannot create broad/permanent consent or authorize emergency access.
7. **Programme interest:** creates a pending expression of interest and never
   automatically enrolls a beneficiary.
8. **Service confirmation:** caregiver evidence can confirm, deny or dispute an
   existing delivery but cannot overwrite the worker's authoritative record.
9. **Rewards:** balance is read-only; redemption confirms only an existing,
   short-lived merchant reservation and never exposes its reusable token.
10. **Climate/outbreak response:** show active area notices; create evacuation,
    health-support and urgent-need requests; record household-safety status;
    locate active temporary facilities.

## Architecture

```text
Mobile network / aggregator
          |
          v
Authenticated provider adapter
          |
          v
Provider-neutral USSD session engine
          |
          +--> identity, PIN and OTP assurance
          +--> ten bounded domain workflows
          +--> audit and disclosure evidence
          +--> durable SMS/outbox continuation
          |
          v
Tenant-isolated PostgreSQL
```

Business services never parse provider-specific payloads. The adapter converts
incoming callbacks into one canonical request and converts `CON`/`END` replies
back to the provider format.

## Quality and acceptance gates

- Fresh and legacy PostgreSQL migrations; forced RLS on every tenant table.
- Unit, database, HTTP and provider-contract tests for all ten workflows.
- Duplicate callback, stale session, wrong PIN/OTP, brute-force, SIM ambiguity,
  cross-tenant, replay and provider-signature tests.
- No child names in pre-authentication or organization-selection responses.
- No diagnosis, allergy, vaccination history, NFC token, redemption token,
  clinical note or exact protected location in USSD output or logs.
- P95 server processing target below 500 ms excluding provider/network latency.
- Session timeout, SMS failure, worker queue, dead-letter, alerting and incident
  runbooks verified before launch.
- Live sandbox and shortcode tests remain external until authorized Africa's
  Talking credentials and a provisioned service code are available.
