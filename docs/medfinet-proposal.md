# Medfinet Proposal

> Project readiness, verified UNICEF call findings, implementation phases, and evidence requirements are maintained in the [UNICEF Climate Ventures Readiness and Implementation Plan](./unicef-climate-ventures-readiness-plan.md).

## A Digital Child Health Identity & Immunization Incentive Platform for Nigeria

---

## Executive Summary

Medfinet is a digital child health platform designed to improve childhood immunization coverage through secure electronic health records, NFC-enabled child health identity cards, and a rewards ecosystem that incentivizes caregivers to complete routine vaccinations.

Every child enrolled in Medfinet receives a unique digital identity and a Medfinet Smart NFC Child Health Card. The card acts as a secure credential linked to the child's cloud-based health record. Healthcare workers simply tap it to retrieve the child's immunization history, growth records, and upcoming vaccines.

To improve vaccine uptake, Medfinet rewards caregivers with Child Health Credits after completing scheduled immunizations. These credits can be redeemed at affiliated supermarkets and pharmacies for child essentials such as diapers, baby food, hygiene products, and nutritional supplements.

Rather than functioning as another immunization application, Medfinet creates a complete digital ecosystem connecting caregivers, healthcare workers, government agencies, and retail partners.

---

## The Problem

Nigeria continues to face challenges in achieving high childhood immunization coverage due to several systemic issues:

- Paper immunization cards are frequently lost or damaged.
- Health facilities often lack centralized digital records.
- Children miss scheduled vaccines because caregivers forget appointments or face transportation and financial barriers.
- Governments have limited real-time visibility into vaccination coverage.
- Caregivers receive little or no incentive for completing immunization schedules.
- Monitoring vaccine completion across different facilities remains difficult.

These challenges contribute to missed vaccinations, outbreaks of vaccine-preventable diseases, and incomplete child health records.

---

## Our Solution

Medfinet transforms childhood immunization through three integrated components:

### 1. Digital Child Health Record

Every child receives a secure digital health profile containing:

- Birth information
- Parent/caregiver details
- Vaccination history
- Growth monitoring
- Vitamin A supplementation
- Deworming records
- Nutrition status
- Appointment history
- Medical notes
- Next vaccine due date

The record is securely stored in the cloud and accessible only to authorized healthcare workers.

---

### 2. Smart NFC Child Health Card

Each caregiver receives an NFC card assigned to their child.

The NFC card stores only a secure identifier rather than medical information.

When tapped by a healthcare worker, the system instantly retrieves the child's complete medical record from the Medfinet database.

**Benefits**

- No paper records
- Faster patient identification
- Reduced duplicate registrations
- Secure access to health records
- Easy replacement if the card is lost

---

### 3. Child Health Rewards

To encourage timely vaccination, caregivers earn Medfinet Child Health Credits after completing scheduled immunizations.

Credits can be redeemed for approved child-care essentials at participating merchants.

**Examples include:**

- Baby food
- Diapers
- Infant formula
- Soap
- Mosquito nets
- Transportation vouchers
- Nutritional products
- School supplies

The rewards help reduce the economic burden associated with attending immunization appointments while encouraging vaccine completion.

---

## How the Platform Works

### Step 1: Child Registration

A healthcare worker registers a newborn or child through the Medfinet Health Worker Portal.

The system creates:

- Child profile
- Caregiver profile
- Unique Medfinet ID

An NFC Child Health Card is assigned to the child.

---

### Step 2: Clinic Visit

The caregiver presents the NFC card.

The healthcare worker taps the card using an NFC-enabled device.

The child's complete vaccination history appears instantly.

---

### Step 3: Vaccination

The healthcare worker records:

- Vaccine administered
- Batch number
- Date
- Health facility
- Officer responsible

The child's health record updates automatically.

---

### Step 4: Rewards

After successful verification:

The caregiver receives Medfinet Child Health Credits.

Notification channels include:

- SMS
- WhatsApp
- Parent Portal

---

### Step 5: Redemption

The caregiver visits an affiliated supermarket.

The merchant scans the NFC card.

The Merchant Portal displays:

- Available credits
- Eligible products

Credits are deducted electronically.

The merchant is reimbursed through Medfinet's settlement process.

---

## Platform Components

### Parent Portal

Parents can:

- View vaccination history
- Receive reminders
- View reward balance
- Redeem credits
- Download immunization certificates
- Manage multiple children
- Report lost cards

---

### Health Worker Portal

Healthcare workers can:

- Register children
- Assign NFC cards
- View medical records
- Record vaccinations
- Update growth monitoring
- Schedule appointments
- Award verified rewards

---

### Merchant Portal

Partner supermarkets can:

- Verify NFC cards
- Check reward balances
- Redeem credits
- View transaction history
- Generate settlement reports

---

### Admin Dashboard

Administrators can:

- Manage facilities
- Manage healthcare workers
- Manage merchants
- Configure reward campaigns
- Track vaccination coverage
- Monitor redemption activity
- Generate analytics
- Detect fraud

---

## Climate-Resilient Digital Child Identity

Medfinet extends beyond immunization records to provide a portable digital child identity for coordinating health, nutrition, protection, and emergency services during climate-related public health emergencies.

The identity is stored securely in the Medfinet backend. The NFC card is a credential that authorized workers can use to retrieve it; it is not the identity itself. If a card is lost, the same identity can still be reached through a replacement NFC card, a QR code, or another approved recovery method.

This approach gives multiple organizations a consistent way to identify the same child while allowing each organization to access only the information required for its role.

### Climate Emergency Scenario

During a flood, families may be displaced, paper records may be destroyed, and children may receive care at temporary shelters or unfamiliar facilities. An authorized health worker can scan the child's credential and quickly retrieve an emergency view containing:

- Identity and caregiver details
- Vaccination status and next vaccine due
- Vitamin A and nutrition status
- Allergies, chronic conditions, and medical alerts
- Displacement and climate-risk indicators
- Active follow-up needs

This supports immediate continuity of care without relying on a paper file or a particular health facility.

### Coordinated Agency Access

Authorized partners can use the same child identity for coordinated service delivery, with role-based and purpose-limited access:

- **Ministry of Health:** immunization status, health records, and growth monitoring
- **UNICEF and programme partners:** vaccination coverage, nutrition programme enrollment, and climate-vulnerability indicators
- **Emergency management agencies:** displacement counts, shelter locations, and family-reunification status
- **Primary healthcare centres:** treatment history and follow-up appointments
- **Approved NGOs:** nutrition support, hygiene-kit distribution, and child-protection referrals

No organization receives unrestricted access by default. Access is governed by authorization, consent, programme purpose, and audit controls.

### Consent-Based Data Sharing

Caregivers can grant or withdraw consent for eligible organizations and programmes through supported Medfinet channels. Consent records capture who granted access, which organization and data categories are covered, the stated purpose, and when the permission expires or is withdrawn.

Emergency access, where legally permitted, must be narrowly scoped, time-limited, and fully audited. Research access requires separate approval and should use anonymized or de-identified data wherever possible.

### Emergency Response Workflow

```text
Flood alert
    |
Identify affected communities and children at risk
    |
Generate an authorized emergency beneficiary list
    |
Deploy health and relief teams
    |
Scan NFC card, QR code, or approved credential
    |
Retrieve the role-appropriate child record
    |
Provide health, nutrition, or relief services
    |
Record services and follow-up needs
    |
Create an auditable verification record
```

For example, during a response affecting thousands of children, Medfinet can help authorized teams identify children who missed vaccinations, are due for Vitamin A, require nutritional support, or need follow-up for chronic conditions.

### Relevance to UNICEF Emergency Settings

Medfinet supports an interoperable, consent-based model for coordinating beneficiary data across authorized agencies. Its value is not another physical identity card; it is a secure and portable child identity that can maintain continuity of health and social services when climate emergencies disrupt families, records, and facilities.

---

## NFC Card Architecture

The NFC card does not contain medical information.

Instead it stores:

```
Card UID
↓
Encrypted Medfinet Token
↓
Cloud Database
↓
Child Health Record
```

If the card is lost:

- Health records remain secure
- Card is disabled
- New card is issued
- No medical information is lost

---

## Rewards Engine

Vaccination completion triggers:

```
Vaccination Verified
↓
Reward Engine
↓
Parent Wallet
↓
Child Health Credits
↓
SMS / WhatsApp Notification
```

Credits are stored in the caregiver's Medfinet account rather than on the NFC card itself.

---

## Partner Supermarket Workflow

```
Merchant opens Merchant Portal.
↓
Merchant scans NFC card.
↓
System retrieves caregiver account.
↓
Available balance appears.
↓
Merchant redeems credits.
↓
Balance updates instantly.
↓
Merchant receives settlement from Medfinet according to the partnership agreement.
```

---

## Technology Stack

### Frontend

- Next.js
- React
- Tailwind CSS

---

### Backend

- Node.js
- Express.js

---

### Database

- PostgreSQL
- Supabase

---

### Authentication

- JWT
- Role-Based Access Control

Roles include:

- Parent
- Healthcare Worker
- Merchant
- Administrator

---

### NFC

- NFC card reader integration
- Web NFC (where supported)
- USB NFC reader support for desktop deployments

---

### Notifications

- WhatsApp
- SMS
- Email

---

### Hosting

- Vercel (Frontend)
- Railway / Render / AWS (Backend)
- Supabase (Database)

---

## Security

Medfinet follows privacy-by-design principles.

Features include:

- Encrypted data storage
- Secure HTTPS communication
- Role-based permissions
- Audit logs
- Card revocation
- Multi-factor authentication for administrators
- Regular backups

Sensitive health information remains on secure servers and is never stored directly on the NFC card.

---

## Revenue Model

### Government Contracts

Digitization of immunization records for public health programs.

---

### Development Partners

Implementation funded by organizations such as UNICEF, Gavi, WHO, and other donors supporting immunization and child health.

---

### Corporate Sponsorships

Companies sponsor vaccination reward campaigns as part of their Corporate Social Responsibility initiatives.

---

### Merchant Partnerships

Retail partners participate in the reward ecosystem and benefit from increased customer traffic.

---

### Analytics Services

Aggregated, anonymized public health dashboards help governments monitor immunization coverage, identify underserved communities, and allocate resources more effectively.

---

## Impact

Medfinet aims to deliver measurable improvements in child health by:

- Increasing immunization completion rates.
- Reducing missed vaccination appointments.
- Eliminating dependence on paper vaccination cards.
- Providing continuity of care across health facilities.
- Improving national immunization data quality.
- Supporting evidence-based public health decision-making.

---

## Pilot Implementation

### Phase 1

Deploy in one Local Government Area.

Participants:

- Primary healthcare centres
- 1,000 children
- 10 healthcare workers
- Selected supermarkets
- Community health extension workers

---

### Phase 2

Expand to multiple LGAs.

---

### Phase 3

Statewide deployment.

---

### Phase 4

National rollout.

---

## Future Roadmap

Beyond immunization, Medfinet can evolve into a comprehensive Digital Child Health Passport, supporting:

- Birth registration integration.
- Growth and nutrition monitoring.
- Vitamin A supplementation.
- Deworming schedules.
- Developmental milestone tracking.
- School-entry health certification.
- Integration with national digital health systems and electronic medical records.

---

## Vision

To ensure that every child has a secure digital health identity, every caregiver is supported to complete life-saving immunizations, and every health system has the data needed to protect children from vaccine-preventable diseases.

Medfinet is not just an immunization record system; it is a digital public health infrastructure that combines identity, continuity of care, and positive incentives to improve child health outcomes at scale.
