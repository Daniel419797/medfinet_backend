# Phase 1 Identity API

**Implementation status:** Available in source. `prisma validate`, a clean PostgreSQL 16 migration, schema-drift comparison, idempotent redeployment, RLS isolation probes, and composite tenant-key probes pass. Deployment to the target environment remains pending.

## Security context

All identity endpoints require a valid bearer token. With the exception of organization creation, requests also require:

```text
x-organization-id: <organization ID>
x-access-purpose: <specific care or administrative purpose>
```

The authenticated subject must have an active membership in the requested active organization. Child and caregiver mutations accept `OWNER`, `ADMIN`, and `HEALTH_WORKER`. Membership, facility, and programme administration accepts only `OWNER` and `ADMIN`. Read endpoints permit every active role, while membership listing remains administrator-only. Sensitive reads and mutations create audit events.

Tenant-owned queries run inside a transaction that sets `app.current_organization_id`. PostgreSQL row-level security then enforces the same organization boundary. Production `DATABASE_URL` must use a restricted application role without superuser or `BYPASSRLS`; otherwise PostgreSQL can bypass RLS even though application-level organization filters remain.

## Endpoints

### Create an organization

```http
POST /api/v1/organizations
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Lagos Child Health Programme",
  "slug": "lagos-child-health"
}
```

The authenticated subject becomes the organization's `OWNER`.

### Administer memberships

```http
GET /api/v1/organization-memberships
PUT /api/v1/organization-memberships
Authorization: Bearer <token>
x-organization-id: <organization ID>
x-access-purpose: organization-administration
Content-Type: application/json

{
  "subjectId": "<authenticated provider subject ID>",
  "role": "HEALTH_WORKER",
  "status": "ACTIVE"
}
```

The `PUT` operation creates or updates the membership identified by organization and subject. Supported roles are `OWNER`, `ADMIN`, `HEALTH_WORKER`, `NUTRITION_WORKER`, `EMERGENCY_COORDINATOR`, and `AUDITOR`; statuses are `ACTIVE`, `SUSPENDED`, and `REVOKED`. Administrators may manage non-owner memberships, but only an owner may grant or modify owner access. The API prevents removal of the final active owner.

### Administer facilities and programmes

```http
GET /api/v1/facilities
POST /api/v1/facilities
GET /api/v1/programmes
POST /api/v1/programmes
```

All require the standard authentication and organization headers. Listing is available to active members; creation is restricted to owners and administrators. Facility creation accepts `name`, `code`, and optional `administrativeArea`. Programme creation accepts `name`, `code`, and optional ISO date-time `startsAt` and `endsAt`. Codes are normalized to uppercase and unique within the organization.

### Register a child

```http
POST /api/v1/children
Authorization: Bearer <token>
x-organization-id: <organization ID>
x-access-purpose: child-registration
Content-Type: application/json

{
  "firstName": "Amina",
  "lastName": "Musa",
  "dateOfBirth": "2024-05-12",
  "sex": "FEMALE"
}
```

Supported sex values are `FEMALE`, `MALE`, `INTERSEX`, and `UNKNOWN`. The server generates the durable Medfinet ID.

Before creation, the API checks for active records in the same organization with the same case-insensitive name and date of birth. A match returns `409 POSSIBLE_DUPLICATE` with minimal candidate identifiers. After reviewing legitimate cases such as twins, repeat the request with `confirmedDistinctFromIds` containing every reviewed candidate ID.

### Search for an exact child match

```http
GET /api/v1/children/search?firstName=Amina&lastName=Musa&dateOfBirth=2024-05-12
Authorization: Bearer <token>
x-organization-id: <organization ID>
x-access-purpose: child-registration
```

All three fields are required. Search is exact (case-insensitive for names), organization-scoped, limited to 25 results, and audited.

### List children

```http
GET /api/v1/children?limit=25&cursor=<child ID>
Authorization: Bearer <token>
x-organization-id: <organization ID>
x-access-purpose: continuity-of-care
```

The maximum page size is 100. The response returns `pagination.nextCursor` when another page exists.

### Retrieve a child

```http
GET /api/v1/children/<child ID>
Authorization: Bearer <token>
x-organization-id: <organization ID>
x-access-purpose: continuity-of-care
```

The response includes caregiver links belonging to the same organization.

### Register a caregiver

```http
POST /api/v1/caregivers
Authorization: Bearer <token>
x-organization-id: <organization ID>
x-access-purpose: child-registration
Content-Type: application/json

{
  "firstName": "Fatima",
  "lastName": "Musa",
  "preferredLanguage": "Hausa"
}
```

### Link a caregiver to a child

```http
POST /api/v1/children/<child ID>/caregivers
Authorization: Bearer <token>
x-organization-id: <organization ID>
x-access-purpose: child-registration
Content-Type: application/json

{
  "caregiverId": "<caregiver ID>",
  "relationship": "MOTHER",
  "isPrimary": true,
  "hasConsentAuthority": true
}
```

Supported relationship values are `MOTHER`, `FATHER`, `GUARDIAN`, `RELATIVE`, and `OTHER`. Database composite foreign keys prevent a child from being linked to a caregiver in another organization.

## Current limitations

- No child update, correction, merge, or archive API yet.
- Possible duplicates can be reviewed and acknowledged, but record merge, archive, and provenance-preserving correction APIs are not implemented yet.
- No NFC/QR credential, consent, clinical record, or emergency workflow yet.
- Production deployment and environment-specific smoke tests remain pending because the local `.env` intentionally contains placeholder production credentials.
