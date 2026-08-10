const crypto = require('node:crypto');

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
    assetId: row.assetId,
    txId: row.txId,
    blockHeight: row.blockHeight,
    creatorAddress: row.creatorAddress,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
  };
}

class CertificateNftRepository {
  constructor(prismaClient) {
    this._prisma = prismaClient || require('../utils/prisma').prisma;
  }

  async findByProofId(organizationId, proofId) {
    const rows = await this._prisma.$queryRawUnsafe(
      `SELECT
        "id", "organizationId", "immunizationId", "proofId",
        "fingerprintVersion", "fingerprint", "network", "assetId",
        "txId", "blockHeight", "creatorAddress", "confirmedAt", "createdAt"
       FROM "certificate_nft_receipts"
       WHERE "organizationId" = $1 AND "proofId" = $2
       LIMIT 1`,
      organizationId,
      proofId,
    );
    return normalizeRow(rows?.[0]);
  }

  async save(receipt) {
    const id = receipt.id || crypto.randomUUID();
    await this._prisma.$executeRawUnsafe(
      `INSERT INTO "certificate_nft_receipts" (
        "id", "organizationId", "immunizationId", "proofId",
        "fingerprintVersion", "fingerprint", "network", "assetId",
        "txId", "blockHeight", "creatorAddress", "confirmedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT ("organizationId", "proofId") DO NOTHING`,
      id,
      receipt.organizationId,
      receipt.immunizationId,
      receipt.proofId,
      receipt.fingerprintVersion,
      receipt.fingerprint,
      receipt.network,
      receipt.assetId,
      receipt.txId,
      receipt.blockHeight,
      receipt.creatorAddress,
      receipt.confirmedAt,
    );
    return this.findByProofId(receipt.organizationId, receipt.proofId);
  }
}

module.exports = CertificateNftRepository;
