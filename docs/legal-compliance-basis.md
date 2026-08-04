# Legal & Regulatory Compliance Basis — Medfinet Architectural Decisions

**Purpose:** Document the legal frameworks that drive the architectural and data-handling decisions in the Medfinet platform.

---

## Applicable Laws & Regulations

### Nigeria (Primary Jurisdiction)

| Law | Key Provisions | Impact on Platform |
|-----|---------------|-------------------|
| **Nigeria Data Protection Act (NDPA) 2023** | Data minimization, lawful processing, consent, data subject rights (access, erasure, rectification, portability, objection), breach notification, accountability | Foundation for consent governance, data subject request workflows, retention policies, encryption, audit trails |
| **National Health Act, 2014 (Sections 26–29)** | Health record confidentiality, consent requirements for disclosure, who may access health records, penalties for unlawful disclosure | All clinical data encrypted at rest, consent evaluation before any disclosure, access scoped by role + purpose |
| **Child Rights Act, 2003** | Best interests of the child (Section 1), right to identity and registration (Section 8), right to privacy (Section 10) | Child identity protection, caregiver-linked records, no identifiable data on public ledgers, strict access controls |
| **Constitution of the Federal Republic of Nigeria 1999 (Section 37)** | Right to privacy of persons, homes, correspondence, communications | Encryption, data minimization, consent, audit logging of all access |

### International Frameworks

| Framework | Relevance | Architectural Impact |
|-----------|-----------|---------------------|
| **GDPR (EU Regulation 2016/679)** | Articles 5, 7, 16, 17, 20, 21 — data subject rights, consent, erasure, portability, objection | DataSubjectRequest model with 6 right types, 30-day SLA, maker-checker identity verification |
| **UN Convention on the Rights of the Child (UNCRC)** | Article 8 (identity), Article 16 (privacy), General Comment No. 25 (digital environment) | Child-centred design, digital identity without exploitation, no permanent public records of child data |
| **AU Convention on Cyber Security and Personal Data Protection (Malabo Convention)** | Data protection principles, cross-border transfer controls | Encryption, purpose limitation, organizational accountability |
| **WHO Digital Health Guidelines** | Data governance, privacy-by-design, interoperability standards | FHIR R4 alignment, privacy-preserving analytics with minimum cell sizes, audit trails |

---

## Decisions Driven by These Laws

### 1. Consent Governance
- **Law:** NDPA § consent requirements, National Health Act §27, GDPR Art. 7
- **Implementation:** Every data disclosure evaluates active, scoped consent grants with legal basis, policy version, and capture method. Consent can be withdrawn. All disclosures logged in `DisclosureEvent`.

### 2. Data Subject Rights
- **Law:** NDPA §40 (right to erasure), §41 (right to rectification), §42 (right to portability), GDPR Art. 17, 20, 21
- **Implementation:** `DataSubjectRequest` model with ACCESS, RECTIFICATION, ERASURE, RESTRICTION, PORTABILITY, OBJECTION flows. 30-day response deadline. Maker-checker approval.

### 3. Encryption at Rest and in Transit
- **Law:** NDPA § accountability & security, National Health Act §26, Nigerian Constitution §37
- **Implementation:** AES-256-GCM for integration payloads and USSD sessions at rest. All fields hashed with HMAC-SHA-256 or scrypt before storage where possible (phone numbers, device IDs, PINs).

### 4. Data Retention and Legal Holds
- **Law:** NDPA § data minimization & storage limitation, National Health Act § record keeping
- **Implementation:** `DataRetentionPolicy` model with categories (AUDIT_EVIDENCE, CLINICAL_RECORD, IDENTITY_RECORD, etc.), versioned policies, maker-checker activation. `LegalHold` model to prevent deletion when required by law.

### 5. No Identifiable Data on Public Blockchains / NFTs
- **Law:** NDPA § right to erasure (immutable ledgers make deletion impossible), § data minimization, National Health Act § confidentiality, Child Rights Act §10, GDPR Art. 17, UNCRC Art. 16
- **Implementation:** Only non-identifying SHA-256 proof hashes are anchored on Algorand. Clinical data stays off-chain. The README states: *"Public blockchain records may contain only non-identifying proof material."*

### 6. Privacy-Preserving Analytics
- **Law:** NDPA § data minimization, National Health Act § confidentiality
- **Implementation:** `AnalyticsPublicationPolicy` with minimum cell size (default 10), maximum geography (STATE level). Internal metrics separate from published reports.

### 7. Role-Based Access Control
- **Law:** NDPA § accountability, National Health Act §27 (who may access), Child Rights Act §10
- **Implementation:** Organization roles (OWNER, ADMIN, HEALTH_WORKER, etc.), facility/programme scoping, access purpose header, consent evaluation middleware.

### 8. Audit Trail
- **Law:** NDPA § accountability, National Health Act § record keeping
- **Implementation:** Every data mutation creates an immutable `AuditEvent` with actor, action, entity, purpose, and timestamp.

---

## Why Child Data on Blockchain / NFTs Is Legally Impossible

Putting identifiable child health data onto a public blockchain or into NFT metadata would violate the law in multiple ways:

| Legal Requirement | Blockchain/NFT Conflict |
|------------------|------------------------|
| **Right to erasure** (NDPA §40, GDPR Art. 17) | Blockchain is immutable — data can never be deleted, even if legally required |
| **Right to rectification** (NDPA §41, GDPR Art. 16) | On-chain data cannot be updated or corrected |
| **Data minimization** (NDPA §, GDPR Art. 5(1)(c)) | Publishing full data is the opposite of minimization |
| **Confidentiality of health records** (National Health Act §26) | Public blockchain exposes data globally with no access control |
| **Best interests of the child** (Child Rights Act §1) | Permanent, immutable public record of a child is inherently harmful |
| **Right to privacy** (Constitution §37, UNCRC Art. 16) | Uncontrolled, irrevocable public disclosure |

This is why the project's P0 risk in the UNICEF readiness plan was precisely: *"Sensitive vaccination data was included in public blockchain/IPFS material"* — fixed by anchoring only a non-identifying proof hash (see `docs/unicef-climate-ventures-readiness-plan.md` and `controllers/vaccination.js:13`).

---

## References in This Repository

- `docs/unicef-climate-ventures-readiness-plan.md` — P0 risk on blockchain identifiable data (line 160), prohibition of public blockchain/IPFS storage of child data (line 427)
- `docs/production-decision-brief.md` — "Identifiable or clinical information must never be written to a public blockchain" (line 20)
- `docs/production-requirements-matrix.md` — Data governance, Nigerian legal/privacy review requirements
- `README.md` — "Public blockchain records may contain only non-identifying proof material" (line 46)
- `controllers/vaccination.js` — "Only a non-identifying hash is anchored publicly. Clinical data remains off-chain." (line 13)
- `prisma/schema.prisma` — `DataSubjectRequest`, `DataRetentionPolicy`, `LegalHold`, `ConsentGrant`, `DisclosureEvent` models
