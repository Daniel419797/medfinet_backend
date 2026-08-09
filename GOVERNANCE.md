# Medfinet Governance

## Purpose

Medfinet is an open-source, pre-production child-health continuity project. Governance should keep the project technically sound, clinically cautious, privacy-preserving and maintainable across deployments with different infrastructure and regulatory contexts.

## Roles

### Lead maintainer

The initial lead maintainer is **Daniel Praise (`@Daniel419797`)**. The lead maintainer has final responsibility for releases, repository administration, security coordination, project scope and decisions that carry legal, privacy or clinical-safety consequences.

### Maintainers

Maintainers review issues and pull requests, guide contributors, uphold project policies and may merge changes within their areas of responsibility. New maintainers may be invited based on sustained, constructive contributions, technical judgement, reliability and alignment with the Code of Conduct.

### Contributors

Anyone may propose changes through issues and pull requests. A contribution does not automatically grant maintainer status or decision-making authority.

## Decision making

- Routine implementation decisions are made through review and consensus where practical.
- The smallest reversible decision is preferred when evidence is incomplete.
- Changes involving clinical workflows, database schemas, privacy, authorization, cryptographic signing, public claims or external standards may require additional domain review.
- The lead maintainer may reject or defer changes that create unacceptable safety, legal, security, maintenance or compatibility risk.
- Significant decisions should be documented in issues, pull requests or decision records so the rationale remains public.

## Releases

A release may be published only after applicable checks pass, migrations and operational impact are documented, and known limitations are clear. A successful build does not by itself establish clinical approval, production readiness or regulatory compliance.

## Security and private matters

Security reports, exposed personal data, credentials, partner information and incident details are handled privately under [SECURITY.md](./SECURITY.md). These matters are not decided in public issues until disclosure is safe and appropriate.

## Conflicts of interest

Reviewers should disclose material conflicts of interest and avoid approving changes where their impartiality is reasonably in doubt.

## Amendments

Governance changes are proposed through pull requests. Material changes should remain open long enough for community review before being merged, except when an urgent security or legal concern requires immediate action.
