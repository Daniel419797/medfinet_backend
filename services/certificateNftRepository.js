const crypto = require('node:crypto');

const RECEIPT_COLUMNS = `
  "id", "organizationId", "immunizationId", "proofId",
  "fingerprintVersion", "fingerprint", "network", "status", "assetId",
  "txId", "blockHeight", "creatorAddress", "signedTransaction",
  "confirmedAt", "createdAt", "updatedAt"`;

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    immunizationId: row.immunizationId,
    proofId: row.proofId,
    fingerprintVersion: Number(row.fingerprintVersion),
    fingerprint: row.fingerprint,
    network: row.network,
    status: row.status,
    assetId: row.assetId,
    txId: row.txId,
    blockHeight: row.blockHeight,
    creatorAddress: row.creatorAddress,
    signedTransaction: row.signedTransaction,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

class CertificateNftRepository {
  constructor(prismaClient) {
    this._prisma = prismaClient || require('../utils/prisma').prisma;
  }

  async findByProofId(organizationId, proofId) {
    const rows = await this._prisma.$queryRawUnsafe(
      `SELECT ${RECEIPT_COLUMNS}
       FROM "certificate_nft_receipts"
       WHERE "organizationId" = $1 AND "proofId" = $2
       LIMIT 1`,
      organizationId,
      proofId,
    );
    return normalizeRow(rows?.[0]);
  }

  async createPending(intent) {
    const id = intent.id || crypto.randomUUID();
    const rows = await this._prisma.$queryRawUnsafe(
      `INSERT INTO "certificate_nft_receipts" (
        "id", "organizationId", "immunizationId", "proofId",
        "fingerprintVersion", "fingerprint", "network", "status",
        "txId", "creatorAddress", "signedTransaction"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9, $10)
      ON CONFLICT ("organizationId", "proofId") DO NOTHING
      RETURNING ${RECEIPT_COLUMNS}`,
      id,
      intent.organizationId,
      intent.immunizationId,
      intent.proofId,
      intent.fingerprintVersion,
      intent.fingerprint,
      intent.network,
      intent.txId,
      intent.creatorAddress,
      intent.signedTransaction,
    );
    if (rows?.[0]) {
      return { inserted: true, receipt: normalizeRow(rows[0]) };
    }
    return {
      inserted: false,
      receipt: await this.findByProofId(intent.organizationId, intent.proofId),
    };
  }

  async confirm(organizationId, proofId, txId, confirmation) {
    const updated = await this._prisma.$executeRawUnsafe(
      `UPDATE "certificate_nft_receipts"
       SET "status" = 'CONFIRMED',
           "assetId" = $4,
           "blockHeight" = $5,
           "confirmedAt" = $6,
           "signedTransaction" = NULL,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "organizationId" = $1
         AND "proofId" = $2
         AND "txId" = $3
         AND "status" = 'PENDING'`,
      organizationId,
      proofId,
      txId,
      confirmation.assetId,
      confirmation.blockHeight,
      confirmation.confirmedAt,
    );
    return {
      updated: updated === 1,
      receipt: await this.findByProofId(organizationId, proofId),
    };
  }
}

module.exports = CertificateNftRepository;
