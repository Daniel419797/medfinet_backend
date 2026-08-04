# Developer Specification

> Delivery priorities, repository gaps, acceptance criteria, and the phased build plan are maintained in the [UNICEF Climate Ventures Readiness and Implementation Plan](./unicef-climate-ventures-readiness-plan.md).

I would explain it to your developer as a digital identity and benefits system, not as "NFC cards."

The NFC card is simply the physical key. The real feature is the Digital Child Identity Platform.

---

## Feature: Medfinet Digital Child Identity & Benefits System

### Objective

The NFC card is not a storage device for health records.

Instead, it acts as a secure digital identity that links a caregiver and child to all Medfinet services.

When the card is scanned, the backend authenticates the card and retrieves the child's information from the database.

The card should work as a universal access credential across the Medfinet ecosystem.

The backend identity is the durable system record. NFC cards, QR codes, and future approved authenticators are replaceable credentials linked to that identity. Losing or revoking a credential must never delete or change the child's identity or service history.

---

### What the Card Should Do

One NFC card should unlock multiple services.

Instead of only opening immunization records, the card should allow access to:

- Digital Child Health Record
- Vaccination History
- Growth Monitoring
- Appointment History
- AI Risk Profile
- Reward Wallet
- Merchant Redemption
- Emergency Child Identification
- Climate Risk Profile

The card should never store these records.

It only identifies the child.

---

### System Flow

```
          NFC Card
              │
              ▼
 Read Card UID / Token
              │
              ▼
 Authenticate Card
              │
              ▼
 Retrieve Child Profile
              │
              ▼
 Return Services
```

---

### Backend Structure

**Table**

```
NFC_Cards
id
uid
token
child_id
status
assigned_date
last_scan
is_active
```

The child table remains separate.

```
Children
id
name
dob
parent_id
health_record_id
wallet_id
climate_profile_id
ai_profile_id
```

When a card is scanned:

```
Card UID
↓
Find Child
↓
Load Everything
```

---

### Health Worker Workflow

```
Health worker taps card.
↓
System loads child.
↓
Update vaccination.
↓
Save.
↓
Create blockchain proof.
↓
Run AI.
↓
Update reward wallet.
↓
Done.
```

---

### Parent Workflow

Parent logs into Medfinet.

They can see:

```
Children
↓
Health Records
↓
Reward Balance
↓
AI Assistant
↓
Upcoming Vaccines
```

No need to scan the card.

The card is only for identification in clinics or emergencies.

---

### Merchant Workflow

Merchant logs into Merchant Portal.

Customer presents NFC card.

Merchant scans card.

Backend checks:

```
Wallet
↓
Balance
↓
Eligible Products
↓
Redeem
↓
Update Wallet
```

The merchant never sees confidential health information.

They only receive:

- Name
- Wallet Balance
- Redemption Status

---

### Emergency Mode

This is a completely separate feature.

Suppose flooding happens.

A child arrives at a temporary health camp.

Health worker scans the NFC card.

Instead of searching through paper records:

```
Scan
↓
Authenticate
↓
Emergency Profile
↓
Vaccination Status
↓
Allergies
↓
Nutrition
↓
Medical Alerts
↓
Continue Care
```

This allows continuity of care even when families are displaced.

Emergency access must return a purpose-built, minimum-necessary view rather than the child's unrestricted record. Every access should capture the requesting user, organization, purpose, time, credential used, data returned, and any emergency-access justification.

### Climate Emergency Workflow

```text
Flood Alert
    |
Geospatial service identifies affected communities
    |
Policy engine finds eligible children and permitted programmes
    |
Generate authorized beneficiary worklists
    |
Worker scans NFC card or QR credential
    |
Identity service resolves the child ID
    |
Consent and authorization services calculate allowed access
    |
Worker receives a minimum-necessary emergency profile
    |
Services and referrals are recorded
    |
Audit and verification events are created
```

Automated risk scoring may prioritize outreach, but it should not independently deny care, benefits, or protection services. A qualified worker must be able to review and override recommendations.

---

### Climate Module

Every child has an AI-generated climate profile.

**Climate Risk**
- Flood
- Heat
- Air Pollution
- Malaria
- Distance to Clinic

When the card is scanned:

```
Child Record
+
Climate Profile
↓
AI Recommendation
```

Example:

Child is due for vaccination tomorrow.

Heavy flooding is forecast.

Recommend outreach vaccination.

---

### AI Integration

When any record changes:

```
Vaccination Updated
↓
Event Trigger
↓
AI Service
↓
Recalculate
Vaccination Risk
Climate Risk
Reward Eligibility
↓
Save Results
```

The AI runs in the background and updates the child's risk profile.

---

### Reward System

The wallet is not money.

It is a ledger.

```
Wallet
Balance
Transactions
Rewards
Redemptions
```

Example:

```
BCG
+200 Credits
↓
Penta 1
+300 Credits
↓
Measles
+500 Credits
```

When redeemed:

```
Merchant
↓
Deduct Credits
↓
Record Transaction
```

---

### Interoperability

One child identity.

Multiple systems.

```
                Child ID
                    │
    ┌───────────────┼──────────────┐
    ▼               ▼              ▼
Health Records  Reward Wallet  AI Profile
    │               │              │
    ▼               ▼              ▼
Climate Risk  Emergency Mode  Blockchain
```

Everything is linked through the same child identifier.

External systems should integrate through versioned APIs and stable programme identifiers rather than reading the Medfinet database directly. The integration layer should support standards-based exchange where required and map external beneficiary identifiers to the internal child ID without exposing card UIDs as public identifiers.

### Agency-Scoped Access

Access is calculated from the user's organization, role, programme, purpose, consent, and current emergency context.

Example scopes include:

- `health.immunization.read`
- `health.growth.read`
- `nutrition.enrollment.read`
- `emergency.displacement.read`
- `relief.distribution.write`
- `protection.referral.write`

A merchant must never receive clinical scopes. A nutrition partner should not receive full treatment history. Research clients should receive de-identified datasets unless a separately approved protocol explicitly permits otherwise.

### Consent Model

Consent must be a first-class backend resource rather than a boolean field on the child record.

```text
Consents
id
child_id
caregiver_id
grantee_organization_id
programme_id
purpose
data_scopes
status
granted_at
expires_at
withdrawn_at
recorded_by
```

The authorization service checks active consent before returning protected data. Withdrawing consent blocks future non-exempt access without deleting the historical audit trail. Any legally permitted emergency override must be time-limited, reason-coded, and reviewed.

### Credential Recovery

```text
Child Identity
    |
    +-- Active NFC credential
    +-- Optional QR credential
    +-- Revoked or expired credentials
    +-- Replacement credential
```

Credential tokens should be opaque, revocable, rotatable, and unusable as direct database keys. A replacement flow verifies the caregiver or authorized official, revokes the lost credential, issues a new one, and preserves the same `child_id`.

---

### APIs

Your backend should expose separate APIs for each function.

```
POST /cards/assign
POST /cards/scan
GET /children/{id}
POST /vaccinations
GET /wallet
POST /wallet/redeem
GET /climate-risk
GET /ai-summary
POST /blockchain/verify
GET /children/{id}/emergency-profile
GET /emergency-events/{id}/beneficiaries
POST /consents
GET /children/{id}/consents
POST /consents/{id}/withdraw
POST /credentials/replace
```

---

### Development Recommendation

I would tell your developer not to think of the NFC card as a "health record card."

Instead, think of it as the child's digital passport into the Medfinet ecosystem.

Every feature—health records, AI insights, blockchain verification, rewards, emergency response, and future services—is connected to a single Child Digital Identity stored in the backend. The NFC card is simply one secure method of retrieving that identity quickly in clinics, supermarkets, or emergency settings.

This architecture is scalable because if you later add nutrition programs, school health, insurance, or emergency relief, you won't need a new card or a new identity system. Those services can all plug into the same digital identity.
