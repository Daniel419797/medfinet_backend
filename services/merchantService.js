const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { requiredText } = require('./identityService');

const MERCHANT_ROLES = new Set(['OWNER', 'CASHIER', 'SETTLEMENT']);

function normalizeCategories(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50) {
    throw new DomainError(
      400,
      'VALIDATION_ERROR',
      'eligibleCategories must contain between 1 and 50 values'
    );
  }
  return [...new Set(values.map((value) => (
    requiredText(value, 'eligibleCategory', 80).toUpperCase()
  )))];
}

function audit(context, action, entityType, entityId, metadata) {
  return {
    organizationId: context.organizationId,
    actorSubjectId: context.actorSubjectId,
    action,
    entityType,
    entityId,
    purpose: context.purpose,
    ...(metadata ? { metadata } : {}),
  };
}

function createMerchantService(prismaClient, { now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function createMerchant(context, input) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const merchant = await transaction.merchant.create({
        data: {
          organizationId: context.organizationId,
          name: requiredText(input.name, 'name', 160),
          code: requiredText(input.code, 'code', 60).toUpperCase(),
          eligibleCategories: normalizeCategories(input.eligibleCategories),
          createdBySubjectId: context.actorSubjectId,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'merchant.created', 'merchant', merchant.id),
      });
      return merchant;
    });
  }

  async function approveMerchant(context, merchantId, input) {
    const settlementAccountRef = requiredText(
      input.settlementAccountRef,
      'settlementAccountRef',
      200
    );
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.merchant.findFirst({
        where: { id: merchantId, organizationId: context.organizationId },
      });
      if (!existing) throw new DomainError(404, 'MERCHANT_NOT_FOUND', 'Merchant not found');
      if (existing.status !== 'PENDING') {
        throw new DomainError(409, 'MERCHANT_NOT_PENDING', 'Only pending merchants can be approved');
      }
      const approvedAt = now();
      const merchant = await transaction.merchant.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          settlementAccountRef,
          approvedBySubjectId: context.actorSubjectId,
          approvedAt,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'merchant.approved', 'merchant', merchant.id),
      });
      return merchant;
    });
  }

  async function suspendMerchant(context, merchantId, input) {
    const reason = requiredText(input.reason, 'reason', 500);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const existing = await transaction.merchant.findFirst({
        where: {
          id: merchantId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
        },
      });
      if (!existing) {
        throw new DomainError(404, 'ACTIVE_MERCHANT_NOT_FOUND', 'Active merchant not found');
      }
      const merchant = await transaction.merchant.update({
        where: { id: existing.id },
        data: {
          status: 'SUSPENDED',
          suspendedAt: now(),
          suspensionReason: reason,
        },
      });
      await transaction.auditEvent.create({
        data: audit(context, 'merchant.suspended', 'merchant', merchant.id, { reason }),
      });
      return merchant;
    });
  }

  async function upsertMerchantMember(context, merchantId, input) {
    if (!MERCHANT_ROLES.has(input.role)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'Merchant membership role is unsupported');
    }
    const subjectId = requiredText(input.subjectId, 'subjectId', 160);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const merchant = await transaction.merchant.findFirst({
        where: { id: merchantId, organizationId: context.organizationId },
        select: { id: true },
      });
      if (!merchant) throw new DomainError(404, 'MERCHANT_NOT_FOUND', 'Merchant not found');
      const organizationMembership = await transaction.organizationMembership.findUnique({
        where: {
          organizationId_subjectId: {
            organizationId: context.organizationId,
            subjectId,
          },
        },
      });
      if (organizationMembership && organizationMembership.role !== 'MERCHANT') {
        throw new DomainError(
          409,
          'SUBJECT_HAS_DIFFERENT_ORGANIZATION_ROLE',
          'The subject already has a non-merchant organization role'
        );
      }
      if (!organizationMembership) {
        await transaction.organizationMembership.create({
          data: {
            organizationId: context.organizationId,
            subjectId,
            role: 'MERCHANT',
          },
        });
      } else if (organizationMembership.status !== 'ACTIVE') {
        await transaction.organizationMembership.update({
          where: { id: organizationMembership.id },
          data: { status: 'ACTIVE' },
        });
      }
      const membership = await transaction.merchantMembership.upsert({
        where: { merchantId_subjectId: { merchantId, subjectId } },
        create: {
          organizationId: context.organizationId,
          merchantId,
          subjectId,
          role: input.role,
          createdBySubjectId: context.actorSubjectId,
        },
        update: { role: input.role, status: 'ACTIVE' },
      });
      await transaction.auditEvent.create({
        data: audit(
          context,
          'merchant.membership-upserted',
          'merchant-membership',
          membership.id,
          { merchantId, subjectId, role: input.role }
        ),
      });
      return membership;
    });
  }

  return {
    createMerchant,
    approveMerchant,
    suspendMerchant,
    upsertMerchantMember,
  };
}

module.exports = { createMerchantService, normalizeCategories, MERCHANT_ROLES };
