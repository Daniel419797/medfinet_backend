const { prisma } = require('../utils/prisma');
const AnchorReceipt = require('./blockchain/AnchorReceipt');

class AnchorReceiptRepository {
  constructor(prismaClient = prisma) {
    this._prisma = prismaClient;
  }

  async save(receipt) {
    const data = receipt.toDatabase();
    await this._prisma.anchorReceipt.upsert({
      where: { anchorId: receipt.anchorId },
      update: data,
      create: data,
    });
    return receipt;
  }

  async findByAnchorId(anchorId) {
    const row = await this._prisma.anchorReceipt.findUnique({
      where: { anchorId },
    });
    return row ? AnchorReceipt.fromDatabase(row) : null;
  }

  async findByAnchorIdForTenant(anchorId, tenantId) {
    const row = await this._prisma.anchorReceipt.findFirst({
      where: { anchorId, tenantId },
    });
    return row ? AnchorReceipt.fromDatabase(row) : null;
  }

  async findByTxId(txId) {
    const row = await this._prisma.anchorReceipt.findUnique({
      where: { txId },
    });
    return row ? AnchorReceipt.fromDatabase(row) : null;
  }

  async listByTenant(tenantId, options = {}) {
    const { limit = 50, cursor, eventCode } = options;
    const where = { tenantId };
    if (eventCode) where.eventCode = eventCode;
    if (cursor) where.anchorId = { gt: cursor };

    const rows = await this._prisma.anchorReceipt.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: limit,
    });

    return rows.map(AnchorReceipt.fromDatabase);
  }

  async countByStatus(status) {
    return this._prisma.anchorReceipt.count({ where: { status } });
  }

  async deleteBefore(date) {
    const result = await this._prisma.anchorReceipt.deleteMany({
      where: { submittedAt: { lt: date } },
    });
    return result.count;
  }
}

module.exports = AnchorReceiptRepository;
