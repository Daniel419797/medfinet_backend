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
    idempotencyKey: `certificate-nft:v${proof.fingerprintVersion}:${proof.aggregateId}:${proof.fingerprint}`,
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

function validateConfirmedMint(result, prepared, network) {
  const assetId = asBigInt(result?.assetId);
  if (!assetId || assetId <= 0n || !positiveRound(result?.blockHeight)) {
    throw new DomainError(502, 'CERTIFICATE_NFT_MINT_UNCONFIRMED', 'Algorand did not return a confirmed certificate NFT');
  }
  if (
    result.network !== network
    || result.txId !== prepared.txId
    || !result.creatorAddress
    || result.creatorAddress !== prepared.creatorAddress
  ) {
    throw new DomainError(502, 'CERTIFICATE_NFT_MINT_INVALID', 'Algorand returned incomplete certificate NFT evidence');
  }
  return assetId;
}

function createCertificateNftService(adapter, repository, options = {}) {
  const receiptStore = repository || new CertificateNftRepository();
  const now = options.now || (() => new Date());

  async function finalize(input, network, receipt, result) {
    const prepared = {
      txId: receipt.txId,
      creatorAddress: receipt.creatorAddress,
    };
    const assetId = validateConfirmedMint(result, prepared, network);
    const confirmation = await receiptStore.confirm(
      input.organizationId,
      input.proofId,
      receipt.txId,
      {
        assetId,
        blockHeight: result.blockHeight,
        confirmedAt: now(),
      },
    );
    const stored = confirmation.receipt;
    if (!receiptMatches(stored, input, network)) {
      throw new DomainError(
        409,
        'CERTIFICATE_NFT_RECEIPT_MISMATCH',
        'Certificate NFT receipt conflicted with the current vaccination proof',
      );
    }
    if (!confirmation.updated) {
      const sameConfirmedMint = stored?.status === 'CONFIRMED'
        && asBigInt(stored.assetId) === assetId
        && stored.txId === receipt.txId;
      if (!sameConfirmedMint) {
        throw new DomainError(
          409,
          'CERTIFICATE_NFT_MINT_COLLISION',
          'Certificate NFT confirmation conflicted with an existing mint receipt',
        );
      }
    }
    return stored;
  }

  async function resumePending(input, network, receipt) {
    if (!receiptMatches(receipt, input, network)) {
      throw new DomainError(
        409,
        'CERTIFICATE_NFT_RECEIPT_MISMATCH',
        'Stored certificate NFT intent does not match the current vaccination proof',
      );
    }
    if (receipt.status === 'CONFIRMED') return receipt;
    if (receipt.status !== 'PENDING' || !receipt.txId || !receipt.creatorAddress) {
      throw new DomainError(
        409,
        'CERTIFICATE_NFT_RECEIPT_INVALID',
        'Stored certificate NFT intent is incomplete',
      );
    }

    const chainTransaction = await adapter.getTransaction(receipt.txId);
    if (chainTransaction?.lookupStatus === 'FOUND') {
      const createdAssetId = asBigInt(chainTransaction.createdAssetId);
      if (
        chainTransaction.txId !== receipt.txId
        || chainTransaction.type !== 'acfg'
        || chainTransaction.sender !== receipt.creatorAddress
        || chainTransaction.signer !== receipt.creatorAddress
      ) {
        throw new DomainError(
          409,
          'CERTIFICATE_NFT_MINT_TRANSACTION_MISMATCH',
          'Stored certificate NFT transaction does not match Algorand',
        );
      }
      if (!chainTransaction.confirmed || !positiveRound(chainTransaction.confirmedRound)) {
        throw new DomainError(
          503,
          'CERTIFICATE_NFT_MINT_PENDING',
          'Certificate NFT transaction is awaiting Algorand confirmation',
        );
      }
      if (!createdAssetId || createdAssetId <= 0n) {
        throw new DomainError(
          502,
          'CERTIFICATE_NFT_MINT_INVALID',
          'Confirmed certificate NFT transaction did not create an asset',
        );
      }
      return finalize(input, network, receipt, {
        assetId: createdAssetId,
        txId: receipt.txId,
        blockHeight: chainTransaction.confirmedRound,
        network,
        creatorAddress: receipt.creatorAddress,
      });
    }

    if (!receipt.signedTransaction) {
      throw new DomainError(
        503,
        'CERTIFICATE_NFT_RECONCILIATION_REQUIRED',
        'Certificate NFT mint intent cannot be safely resubmitted',
      );
    }
    const result = await adapter.submitPreparedCertificateNft({
      txId: receipt.txId,
      signedTransaction: Buffer.from(receipt.signedTransaction, 'base64'),
      creatorAddress: receipt.creatorAddress,
    });
    return finalize(input, network, receipt, result);
  }

  async function mint(input) {
    validateMintInput(input);
    const network = adapter?.networkId;
    if (!network) {
      throw new DomainError(503, 'CERTIFICATE_NFT_NETWORK_UNAVAILABLE', 'Algorand network is unavailable for certificate NFT minting');
    }

    const existing = await receiptStore.findByProofId(input.organizationId, input.proofId);
    if (existing) return resumePending(input, network, existing);

    const prepared = await adapter.prepareCertificateNft({
      metadataHash: Buffer.from(input.fingerprint, 'hex'),
      assetName: CERTIFICATE_NFT_ASSET_NAME,
      unitName: CERTIFICATE_NFT_UNIT_NAME,
    });
    if (
      prepared?.network !== network
      || !prepared?.txId
      || !prepared?.creatorAddress
      || !prepared?.signedTransaction
    ) {
      throw new DomainError(
        502,
        'CERTIFICATE_NFT_PREPARATION_INVALID',
        'Algorand returned an incomplete certificate NFT mint intent',
      );
    }

    const pending = await receiptStore.createPending({
      organizationId: input.organizationId,
      immunizationId: input.immunizationId,
      proofId: input.proofId,
      fingerprintVersion: input.fingerprintVersion,
      fingerprint: input.fingerprint,
      network,
      txId: prepared.txId,
      creatorAddress: prepared.creatorAddress,
      signedTransaction: Buffer.from(prepared.signedTransaction).toString('base64'),
    });
    if (!pending.receipt) {
      throw new DomainError(
        503,
        'CERTIFICATE_NFT_RECEIPT_UNAVAILABLE',
        'Certificate NFT mint intent could not be persisted',
      );
    }
    if (!pending.inserted) {
      return resumePending(input, network, pending.receipt);
    }

    const result = await adapter.submitPreparedCertificateNft(prepared);
    return finalize(input, network, pending.receipt, result);
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
    networkIntegrity: null,
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
  const networkIntegrity = receipt.network === expected.network && adapter.networkId === expected.network;
  const proofIntegrity = Boolean(
    receipt.organizationId === expected.organizationId
    && receipt.immunizationId === expected.immunizationId
    && receipt.proofId === expected.proofId
    && receipt.fingerprintVersion === expected.fingerprintVersion
    && receipt.fingerprint === expected.fingerprint
    && networkIntegrity
    && receipt.txId
  );
  if (!proofIntegrity) {
    return emptyInspection(receipt, adapter, {
      status: 'MISMATCH',
      reason: 'NFT_RECEIPT_CLAIM_MISMATCH',
      receiptIntegrity: false,
      networkIntegrity,
    });
  }
  if (receipt.status === 'PENDING') {
    return emptyInspection(receipt, adapter, {
      status: 'PENDING',
      reason: null,
      receiptIntegrity: true,
      networkIntegrity,
    });
  }

  const expectedAssetId = asBigInt(receipt.assetId);
  const receiptIntegrity = Boolean(
    receipt.status === 'CONFIRMED'
    && expectedAssetId
    && expectedAssetId > 0n
    && receipt.blockHeight != null
    && receipt.confirmedAt
  );
  if (!receiptIntegrity) {
    return emptyInspection(receipt, adapter, {
      status: 'MISMATCH',
      reason: 'NFT_RECEIPT_CONFIRMATION_INVALID',
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
      reason: 'NFT_MINT_TRANSACTION_LOOKUP_UNAVAILABLE',
      receiptIntegrity,
      networkIntegrity,
      assetIntegrity: null,
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
  const integrityVerified = receiptIntegrity
    && assetIntegrity
    && transactionIntegrity;
  const status = integrityVerified
    ? (chainConfirmed ? 'CONFIRMED' : 'UNCONFIRMED')
    : 'MISMATCH';
  const verified = integrityVerified && chainConfirmed;

  return {
    status,
    reason: status === 'MISMATCH' ? 'NFT_CHAIN_EVIDENCE_MISMATCH' : null,
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
