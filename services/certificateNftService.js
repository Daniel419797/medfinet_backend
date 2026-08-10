const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const CertificateNftRepository = require('./certificateNftRepository');
const { addressString, positiveRound } = require('./blockchain/algorandValues');

const CERTIFICATE_NFT_ASSET_NAME = 'Medfinet Vaccine Certificate';
const CERTIFICATE_NFT_UNIT_NAME = 'MFVAX';
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const ALGORAND_ZERO_ADDRESS = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

function isUnsetAddress(value) {
  const normalized = addressString(value);
  return !normalized || normalized === ALGORAND_ZERO_ADDRESS;
}

function asBigInt(value) {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function sameBytes(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateMintInput(input) {
  if (!input?.organizationId || !input?.immunizationId || !input?.proofId) {
    throw new DomainError(400, 'CERTIFICATE_NFT_INPUT_INVALID', 'Certificate NFT proof identity is incomplete');
  }
  if (!Number.isInteger(input.fingerprintVersion) || input.fingerprintVersion < 1) {
    throw new DomainError(400, 'CERTIFICATE_NFT_INPUT_INVALID', 'Certificate NFT fingerprint version is invalid');
  }
  if (!FINGERPRINT_PATTERN.test(String(input.fingerprint || ''))) {
    throw new DomainError(400, 'CERTIFICATE_NFT_INPUT_INVALID', 'Certificate NFT fingerprint must be a SHA-256 digest');
  }
}

function certificateNftOutboxData(record, proof) {
  return {
    organizationId: record.organizationId,
    eventType: 'BLOCKCHAIN_CERTIFICATE_NFT_REQUESTED',
    aggregateType: 'certificate-nft',
    aggregateId: proof.aggregateId,
    idempotencyKey: `certificate-nft:v${proof.fingerprintVersion}:${proof.aggregateId}`,
    payload: {
      immunizationId: record.id,
      proofId: proof.anchorId,
      fingerprint: proof.fingerprint,
      fingerprintVersion: proof.fingerprintVersion,
      tenantId: record.organizationId,
    },
  };
}

function receiptMatches(receipt, input, network) {
  return Boolean(
    receipt
    && receipt.organizationId === input.organizationId
    && receipt.immunizationId === input.immunizationId
    && receipt.proofId === input.proofId
    && receipt.fingerprint === input.fingerprint
    && receipt.fingerprintVersion === input.fingerprintVersion
    && receipt.network === network
  );
}

function createCertificateNftService(adapter, repository, options = {}) {
  const receiptStore = repository || new CertificateNftRepository();
  const now = options.now || (() => new Date());

  async function mint(input) {
    validateMintInput(input);
    const network = adapter?.networkId;
    if (!network) {
      throw new DomainError(503, 'CERTIFICATE_NFT_NETWORK_UNAVAILABLE', 'Algorand network is unavailable for certificate NFT minting');
    }

    const existing = await receiptStore.findByProofId(input.organizationId, input.proofId);
    if (existing) {
      if (!receiptMatches(existing, input, network)) {
        throw new DomainError(
          409,
          'CERTIFICATE_NFT_RECEIPT_MISMATCH',
          'Stored certificate NFT evidence does not match the current vaccination proof',
        );
      }
      return existing;
    }

    const result = await adapter.mintCertificateNft({
      metadataHash: Buffer.from(input.fingerprint, 'hex'),
      assetName: CERTIFICATE_NFT_ASSET_NAME,
      unitName: CERTIFICATE_NFT_UNIT_NAME,
    });
    const assetId = asBigInt(result?.assetId);
    if (!assetId || assetId <= 0n || !positiveRound(result?.blockHeight)) {
      throw new DomainError(502, 'CERTIFICATE_NFT_MINT_UNCONFIRMED', 'Algorand did not return a confirmed certificate NFT');
    }
    if (result.network !== network || !result.txId || !result.creatorAddress) {
      throw new DomainError(502, 'CERTIFICATE_NFT_MINT_INVALID', 'Algorand returned incomplete certificate NFT evidence');
    }

    const stored = await receiptStore.save({
      organizationId: input.organizationId,
      immunizationId: input.immunizationId,
      proofId: input.proofId,
      fingerprintVersion: input.fingerprintVersion,
      fingerprint: input.fingerprint,
      network,
      assetId,
      txId: result.txId,
      blockHeight: result.blockHeight,
      creatorAddress: result.creatorAddress,
      confirmedAt: now(),
    });
    if (!receiptMatches(stored, input, network)) {
      throw new DomainError(
        409,
        'CERTIFICATE_NFT_RECEIPT_MISMATCH',
        'Certificate NFT receipt conflicted with an existing proof',
      );
    }
    return stored;
  }

  return { mint };
}

function emptyInspection(receipt, adapter, overrides = {}) {
  return {
    status: 'UNAVAILABLE',
    reason: 'NFT_VERIFICATION_CONTEXT_INCOMPLETE',
    assetId: receipt?.assetId == null ? null : String(receipt.assetId),
    mintTxId: receipt?.txId || null,
    blockHeight: receipt?.blockHeight == null ? null : String(receipt.blockHeight),
    confirmedAt: receipt?.confirmedAt || null,
    network: adapter?.networkName || null,
    networkId: adapter?.networkId || receipt?.network || null,
    explorerUrl: receipt?.txId && adapter ? adapter.getExplorerUrl(receipt.txId) : null,
    receiptIntegrity: false,
    transactionIntegrity: null,
    assetIntegrity: null,
    metadataIntegrity: null,
    supplyIntegrity: null,
    immutableIntegrity: null,
    chainConfirmed: null,
    verified: false,
    ...overrides,
  };
}

async function inspectCertificateNftReceipt(receipt, adapter, expected) {
  if (!receipt || !adapter || !expected) return emptyInspection(receipt, adapter);
  const expectedAssetId = asBigInt(receipt.assetId);
  const networkIntegrity = receipt.network === expected.network && adapter.networkId === expected.network;
  const receiptIntegrity = Boolean(
    expectedAssetId
    && expectedAssetId > 0n
    && receipt.organizationId === expected.organizationId
    && receipt.immunizationId === expected.immunizationId
    && receipt.proofId === expected.proofId
    && receipt.fingerprintVersion === expected.fingerprintVersion
    && receipt.fingerprint === expected.fingerprint
    && networkIntegrity
    && receipt.txId
  );
  if (!receiptIntegrity) {
    return emptyInspection(receipt, adapter, {
      status: 'MISMATCH',
      reason: 'NFT_RECEIPT_CLAIM_MISMATCH',
      receiptIntegrity: false,
      networkIntegrity,
    });
  }

  const [asset, transaction] = await Promise.all([
    adapter.getAsset(expectedAssetId),
    adapter.getTransaction(receipt.txId),
  ]);
  if (asset?.lookupStatus !== 'FOUND') {
    return emptyInspection(receipt, adapter, {
      status: 'UNAVAILABLE',
      reason: asset?.unavailableReason || 'NFT_ASSET_LOOKUP_UNAVAILABLE',
      receiptIntegrity,
      networkIntegrity,
    });
  }
  if (transaction?.lookupStatus !== 'FOUND') {
    return emptyInspection(receipt, adapter, {
      status: 'UNAVAILABLE',
      reason: transaction?.unavailableReason || 'NFT_MINT_TRANSACTION_LOOKUP_UNAVAILABLE',
      receiptIntegrity,
      networkIntegrity,
    });
  }

  const platformAddress = addressString(adapter.platformAccount);
  const metadataIntegrity = sameBytes(
    asset.metadataHash,
    Buffer.from(expected.fingerprint, 'hex'),
  );
  const supplyIntegrity = asBigInt(asset.total) === 1n && Number(asset.decimals) === 0;
  const immutableIntegrity = Boolean(
    asset.defaultFrozen === false
    && isUnsetAddress(asset.manager)
    && isUnsetAddress(asset.reserve)
    && isUnsetAddress(asset.freeze)
    && isUnsetAddress(asset.clawback)
  );
  const assetIntegrity = Boolean(
    asBigInt(asset.assetId) === expectedAssetId
    && asset.creator === platformAddress
    && asset.assetName === CERTIFICATE_NFT_ASSET_NAME
    && asset.unitName === CERTIFICATE_NFT_UNIT_NAME
    && !asset.url
    && metadataIntegrity
    && supplyIntegrity
    && immutableIntegrity
  );
  const transactionIntegrity = Boolean(
    transaction.txId === receipt.txId
    && transaction.type === 'acfg'
    && transaction.sender === platformAddress
    && transaction.signer === platformAddress
    && asBigInt(transaction.createdAssetId) === expectedAssetId
  );
  const chainConfirmed = transaction.confirmed === true
    && positiveRound(transaction.confirmedRound);
  const verified = receiptIntegrity
    && assetIntegrity
    && transactionIntegrity
    && chainConfirmed;

  return {
    status: verified ? 'CONFIRMED' : 'MISMATCH',
    reason: verified ? null : 'NFT_CHAIN_EVIDENCE_MISMATCH',
    assetId: String(expectedAssetId),
    mintTxId: receipt.txId,
    blockHeight: receipt.blockHeight == null ? null : String(receipt.blockHeight),
    confirmedAt: receipt.confirmedAt,
    network: adapter.networkName,
    networkId: adapter.networkId,
    explorerUrl: adapter.getExplorerUrl(receipt.txId),
    receiptIntegrity,
    networkIntegrity,
    transactionIntegrity,
    assetIntegrity,
    metadataIntegrity,
    supplyIntegrity,
    immutableIntegrity,
    chainConfirmed,
    verified,
  };
}

module.exports = {
  CERTIFICATE_NFT_ASSET_NAME,
  CERTIFICATE_NFT_UNIT_NAME,
  certificateNftOutboxData,
  createCertificateNftService,
  inspectCertificateNftReceipt,
};
