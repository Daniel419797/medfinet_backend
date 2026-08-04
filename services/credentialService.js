const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');
const {
  CREDENTIAL_KINDS,
  timestamp,
  tokenDigest,
  withoutTokenHash,
  audit,
} = require('./clinicalValidation');

function validateKind(kind) {
  if (!CREDENTIAL_KINDS.has(kind)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'kind must be QR, NFC, or RECOVERY');
  }
  return kind;
}

function rejectSecureNfc(kind) {
  if (kind === 'NFC') {
    throw new DomainError(
      400,
      'SECURE_NFC_PROVISIONING_REQUIRED',
      'NFC credentials must use the protected NTAG215 provisioning workflow'
    );
  }
}

function createToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: tokenDigest(token) };
}

function expiryData(expiresAt) {
  return expiresAt ? { expiresAt: timestamp(expiresAt, 'expiresAt') } : {};
}

function createCredentialService(prismaClient) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function requireChild(transaction, context, childId) {
    const child = await transaction.child.findFirst({
      where: { id: childId, organizationId: context.organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!child) throw new DomainError(404, 'CHILD_NOT_FOUND', 'Active child not found');
  }

  async function issue(context, childId, input) {
    const kind = validateKind(input.kind);
    rejectSecureNfc(kind);
    const generated = createToken();
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await requireChild(transaction, context, childId);
      const credential = await transaction.childCredential.create({
        data: {
          organizationId: context.organizationId,
          childId,
          tokenHash: generated.tokenHash,
          kind,
          issuedBySubjectId: context.actorSubjectId,
          ...expiryData(input.expiresAt),
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'credential.issued', 'credential', credential.id, {
          childId,
          kind,
        }),
      });
      return { credential: withoutTokenHash(credential), token: generated.token };
    });
  }

  async function issueBulk(context, input) {
    const requests = input.credentials;
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > 100) {
      throw new DomainError(
        400,
        'VALIDATION_ERROR',
        'credentials must contain between 1 and 100 issuance requests'
      );
    }
    const seen = new Set();
    const normalized = requests.map((request, index) => {
      const childId = requiredText(request.childId, `credentials[${index}].childId`, 100);
      if (seen.has(childId)) {
        throw new DomainError(400, 'VALIDATION_ERROR', 'Each child may appear only once per batch');
      }
      seen.add(childId);
      return {
        childId,
        kind: validateKind(request.kind),
        ...expiryData(request.expiresAt),
        ...createToken(),
      };
    });
    normalized.forEach(({ kind }) => rejectSecureNfc(kind));
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const children = await transaction.child.findMany({
        where: {
          organizationId: context.organizationId,
          id: { in: [...seen] },
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (children.length !== normalized.length) {
        throw new DomainError(
          404,
          'CHILD_NOT_FOUND',
          'Every credential request must reference an active child'
        );
      }
      const issued = [];
      for (const request of normalized) {
        const credential = await transaction.childCredential.create({
          data: {
            organizationId: context.organizationId,
            childId: request.childId,
            tokenHash: request.tokenHash,
            kind: request.kind,
            issuedBySubjectId: context.actorSubjectId,
            ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
          },
        });
        issued.push({
          credential: withoutTokenHash(credential),
          token: request.token,
        });
      }
      await transaction.auditEvent.create({
        data: audit(context, 'credential.bulk-issued', 'credential-batch', crypto.randomUUID(), {
          count: issued.length,
          childIds: normalized.map(({ childId }) => childId),
        }),
      });
      return issued;
    });
  }

  async function list(context, childId, input = {}) {
    const take = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
    const statuses = new Set(['ACTIVE', 'REVOKED', 'ROTATED', 'EXPIRED']);
    if (input.status && !statuses.has(input.status)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'status is unsupported');
    }
    return withTenantTransaction(database, context.organizationId, (transaction) => (
      transaction.childCredential.findMany({
        where: {
          organizationId: context.organizationId,
          ...(childId ? { childId } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        select: {
          id: true,
          childId: true,
          kind: true,
          status: true,
          issuedBySubjectId: true,
          expiresAt: true,
          revokedAt: true,
          revokedReason: true,
          replacesCredentialId: true,
          lastScannedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      })
    ));
  }

  async function get(context, credentialId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const credential = await transaction.childCredential.findFirst({
        where: { id: credentialId, organizationId: context.organizationId },
        select: {
          id: true,
          childId: true,
          kind: true,
          status: true,
          issuedBySubjectId: true,
          expiresAt: true,
          revokedAt: true,
          revokedReason: true,
          replacesCredentialId: true,
          lastScannedAt: true,
          createdAt: true,
          updatedAt: true,
          replacements: { select: { id: true, status: true, createdAt: true } },
          scans: {
            select: {
              id: true,
              actorSubjectId: true,
              purpose: true,
              outcome: true,
              deviceId: true,
              scannedAt: true,
            },
            orderBy: { scannedAt: 'desc' },
            take: 50,
          },
        },
      });
      if (!credential) throw new DomainError(404, 'CREDENTIAL_NOT_FOUND', 'Credential not found');
      return credential;
    });
  }

  async function resolve(context, token, input = {}) {
    const digest = tokenDigest(requiredText(token, 'token', 200));
    const deviceId = requiredText(input.deviceId, 'deviceId', 120);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const device = await transaction.fieldDevice.findFirst({
        where: {
          id: deviceId,
          organizationId: context.organizationId,
          subjectId: context.actorSubjectId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!device) {
        throw new DomainError(
          403,
          'DEVICE_ACCESS_DENIED',
          'Credential scans must use an active device registered to the worker'
        );
      }
      const credential = await transaction.childCredential.findFirst({
        where: {
          tokenHash: digest,
          organizationId: context.organizationId,
          kind: { not: 'NFC' },
        },
        include: { child: true },
      });
      const valid = credential
        && credential.status === 'ACTIVE'
        && (!credential.expiresAt || credential.expiresAt > new Date());
      if (!valid) {
        throw new DomainError(
          404,
          'CREDENTIAL_NOT_FOUND',
          'Credential is invalid, expired, or revoked'
        );
      }
      await transaction.credentialScan.create({
        data: {
          organizationId: context.organizationId,
          credentialId: credential.id,
          actorSubjectId: context.actorSubjectId,
          purpose: context.purpose,
          outcome: 'RESOLVED',
          deviceId,
        },
      });
      await Promise.all([
        transaction.childCredential.update({
          where: { id: credential.id },
          data: { lastScannedAt: new Date() },
        }),
        transaction.fieldDevice.update({
          where: { id: deviceId },
          data: { lastSeenAt: new Date() },
        }),
      ]);
      await transaction.auditEvent.create({
        data: audit(context, 'credential.resolved', 'credential', credential.id),
      });
      return { credential: withoutTokenHash(credential), child: credential.child };
    });
  }

  async function revoke(context, credentialId, input) {
    const reason = requiredText(input.reason, 'reason', 300);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.childCredential.findFirst({
        where: { id: credentialId, organizationId: context.organizationId },
      });
      if (!existing) throw new DomainError(404, 'CREDENTIAL_NOT_FOUND', 'Credential not found');
      if (existing.status !== 'ACTIVE') {
        throw new DomainError(409, 'CREDENTIAL_NOT_ACTIVE', 'Only active credentials can be revoked');
      }
      if (existing.kind === 'NFC') {
        throw new DomainError(
          400,
          'SECURE_NFC_LIFECYCLE_REQUIRED',
          'NFC credentials must use the secure NFC revocation workflow'
        );
      }
      const credential = await transaction.childCredential.update({
        where: { id: credentialId },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'credential.revoked', 'credential', credential.id, { reason }),
      });
      return withoutTokenHash(credential);
    });
  }

  async function replace(context, credentialId, input) {
    const kind = validateKind(input.kind);
    rejectSecureNfc(kind);
    const reason = requiredText(input.reason, 'reason', 300);
    const generated = createToken();
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.childCredential.findFirst({
        where: { id: credentialId, organizationId: context.organizationId },
      });
      if (!existing) throw new DomainError(404, 'CREDENTIAL_NOT_FOUND', 'Credential not found');
      if (existing.status !== 'ACTIVE') {
        throw new DomainError(409, 'CREDENTIAL_NOT_ACTIVE', 'Only active credentials can be replaced');
      }
      if (existing.kind === 'NFC') {
        throw new DomainError(
          400,
          'SECURE_NFC_LIFECYCLE_REQUIRED',
          'NFC credentials must use the secure NFC replacement workflow'
        );
      }
      await transaction.childCredential.update({
        where: { id: existing.id },
        data: { status: 'ROTATED', revokedAt: new Date(), revokedReason: reason },
      });
      const credential = await transaction.childCredential.create({
        data: {
          organizationId: context.organizationId,
          childId: existing.childId,
          tokenHash: generated.tokenHash,
          kind,
          issuedBySubjectId: context.actorSubjectId,
          replacesCredentialId: existing.id,
          ...expiryData(input.expiresAt),
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'credential.replaced', 'credential', credential.id, {
          childId: existing.childId,
          replacedCredentialId: existing.id,
          kind,
          reason,
        }),
      });
      return { credential: withoutTokenHash(credential), token: generated.token };
    });
  }

  return { issue, issueBulk, list, get, resolve, revoke, replace };
}

module.exports = { createCredentialService };
