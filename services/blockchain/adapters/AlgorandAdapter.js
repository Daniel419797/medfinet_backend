const algosdk = require('algosdk');
const ChainAdapter = require('../ChainAdapter');
const { addressString, positiveRound } = require('../algorandValues');

function transactionNote(value) {
  if (!value) return null;
  return typeof value === 'string'
    ? Buffer.from(value, 'base64')
    : Buffer.from(value);
}

function isNotFound(error) {
  return [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.response?.statusCode,
  ].some((value) => Number(value) === 404);
}

async function withTimeout(request, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Algorand request timed out after ${timeoutMs}ms`);
      error.name = 'AlgorandRequestTimeoutError';
      error.code = 'ALGORAND_REQUEST_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

class AlgorandAdapter extends ChainAdapter {
  constructor(config, dependencies = {}) {
    super();
    const resolvedConfig = config?.network
      ? config
      : require('../networkRegistry').getNetworkConfig();
    this.config = resolvedConfig;
    this._sdk = dependencies.sdk || algosdk;
    this.client = dependencies.client || new this._sdk.Algodv2(
      resolvedConfig.algodToken || '',
      resolvedConfig.algodServer,
      resolvedConfig.algodPort
    );
    this.platformAccount = dependencies.platformAccount
      || this._sdk.mnemonicToSecretKey(resolvedConfig.platformWalletMnemonic);
    this._confirmationRounds = resolvedConfig.confirmationRounds || 4;
    this._fee = resolvedConfig.fee || 1_000;
    this._requestTimeoutMs = resolvedConfig.requestTimeoutMs || 10_000;
  }

  get defaultFee() {
    return this._fee;
  }

  get networkName() {
    if (this.config.networkName) return this.config.networkName;
    const host = new URL(this.config.algodServer).hostname;
    if (host.includes('testnet')) return 'Algorand TestNet';
    if (host.includes('mainnet')) return 'Algorand MainNet';
    return 'Algorand';
  }

  get networkId() {
    return this.config.network || null;
  }

  get chainId() {
    return this.config.chainId || null;
  }

  async submitTransaction(note, fee) {
    const params = await this.client.getTransactionParams().do();
    const txn = this._sdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.platformAccount.addr,
      receiver: this.platformAccount.addr,
      amount: 0,
      note,
      suggestedParams: {
        ...params,
        fee: fee || this._fee,
        flatFee: true,
      },
    });
    const signed = txn.signTxn(this.platformAccount.sk);
    const { txid: txId } = await this.client.sendRawTransaction(signed).do();
    const confirmed = await this._sdk.waitForConfirmation(
      this.client, txId, this._confirmationRounds
    );
    const confirmedRound = confirmed.confirmedRound;
    if (!positiveRound(confirmedRound)) {
      throw new Error(`Algorand transaction ${txId} did not reach a confirmed round`);
    }
    return {
      txId,
      blockHeight: confirmedRound,
      confirmations: this._confirmationRounds,
      network: this.networkId,
    };
  }

  async prepareCertificateNft({ metadataHash, assetName, unitName }, fee) {
    const digest = Buffer.from(metadataHash || []);
    if (digest.length !== 32) {
      throw new Error('Certificate NFT metadata hash must be exactly 32 bytes');
    }
    const params = await this.client.getTransactionParams().do();
    const txn = this._sdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
      sender: this.platformAccount.addr,
      total: 1n,
      decimals: 0,
      defaultFrozen: false,
      unitName,
      assetName,
      assetMetadataHash: Uint8Array.from(digest),
      suggestedParams: {
        ...params,
        fee: fee || this._fee,
        flatFee: true,
      },
    });
    const txId = txn.txID();
    if (!txId) throw new Error('Unable to derive certificate NFT transaction ID');
    return {
      txId,
      signedTransaction: Buffer.from(txn.signTxn(this.platformAccount.sk)),
      network: this.networkId,
      creatorAddress: addressString(this.platformAccount),
    };
  }

  async submitPreparedCertificateNft(prepared) {
    if (!prepared?.txId || !prepared?.signedTransaction) {
      throw new Error('Prepared certificate NFT transaction is incomplete');
    }
    const submitted = await this.client
      .sendRawTransaction(Buffer.from(prepared.signedTransaction))
      .do();
    const submittedTxId = submitted?.txid || prepared.txId;
    if (submittedTxId !== prepared.txId) {
      throw new Error('Algorand returned an unexpected certificate NFT transaction ID');
    }
    const confirmed = await this._sdk.waitForConfirmation(
      this.client,
      prepared.txId,
      this._confirmationRounds,
    );
    const confirmedRound = confirmed.confirmedRound;
    const assetId = confirmed.assetIndex ?? confirmed['asset-index'];
    if (!positiveRound(confirmedRound) || assetId === undefined || assetId === null) {
      throw new Error(`Algorand certificate NFT ${prepared.txId} did not confirm with an asset ID`);
    }
    return {
      assetId,
      txId: prepared.txId,
      blockHeight: confirmedRound,
      confirmations: this._confirmationRounds,
      network: this.networkId,
      creatorAddress: prepared.creatorAddress || addressString(this.platformAccount),
    };
  }

  async mintCertificateNft(input, fee) {
    const prepared = await this.prepareCertificateNft(input, fee);
    return this.submitPreparedCertificateNft(prepared);
  }

  async getTransaction(txId) {
    try {
      const pending = await withTimeout(
        this.client.pendingTransactionInformation(txId).do(),
        this._requestTimeoutMs,
      );
      const signed = pending.txn;
      const transaction = signed?.txn;
      const payment = transaction?.payment;
      const confirmedRound = pending.confirmedRound;
      const roundTime = pending.roundTime ?? pending['round-time'];
      let actualTxId = null;
      try {
        actualTxId = transaction?.txID?.() || null;
      } catch {
        actualTxId = null;
      }
      return {
        lookupStatus: 'FOUND',
        txId: actualTxId,
        note: transactionNote(transaction?.note),
        timestamp: roundTime
          ? new Date(Number(roundTime) * 1000).toISOString()
          : null,
        confirmedRound,
        confirmed: positiveRound(confirmedRound),
        type: transaction?.type || null,
        sender: addressString(transaction?.sender),
        signer: addressString(signed?.sgnr || transaction?.sender),
        receiver: addressString(payment?.receiver),
        amount: payment?.amount ?? null,
        createdAssetId: pending.assetIndex ?? pending['asset-index'] ?? null,
        rekeyTo: addressString(transaction?.rekeyTo),
        closeRemainderTo: addressString(payment?.closeRemainderTo),
      };
    } catch (error) {
      if (isNotFound(error)) {
        return {
          lookupStatus: 'UNAVAILABLE',
          unavailableReason: 'TRANSACTION_NOT_RETAINED_OR_NOT_FOUND',
        };
      }
      throw error;
    }
  }

  async getAsset(assetId) {
    try {
      const asset = await withTimeout(
        this.client.getAssetByID(assetId).do(),
        this._requestTimeoutMs,
      );
      const params = asset?.params || {};
      const metadataHash = params.metadataHash ?? params['metadata-hash'] ?? null;
      const defaultFrozen = params.defaultFrozen ?? params['default-frozen'] ?? null;
      return {
        lookupStatus: 'FOUND',
        assetId: asset?.index ?? asset?.['asset-id'] ?? null,
        creator: addressString(params.creator ?? params['creator']),
        total: params.total ?? params['total'] ?? null,
        decimals: params.decimals ?? params['decimals'] ?? null,
        defaultFrozen: defaultFrozen === null ? null : Boolean(defaultFrozen),
        unitName: params.unitName ?? params['unit-name'] ?? null,
        assetName: params.name ?? params.assetName ?? params['asset-name'] ?? null,
        url: params.url ?? params['url'] ?? null,
        metadataHash: metadataHash ? Buffer.from(metadataHash) : null,
        manager: addressString(params.manager ?? params['manager']),
        reserve: addressString(params.reserve ?? params['reserve']),
        freeze: addressString(params.freeze ?? params['freeze']),
        clawback: addressString(params.clawback ?? params['clawback']),
      };
    } catch (error) {
      if (isNotFound(error)) {
        return {
          lookupStatus: 'UNAVAILABLE',
          unavailableReason: 'ASSET_NOT_FOUND',
        };
      }
      throw error;
    }
  }

  async getBalance(address) {
    const info = await this.client.accountInformation(address).do();
    return info.amount;
  }

  async isReachable() {
    try {
      await this.client.healthCheck().do();
      return true;
    } catch {
      return false;
    }
  }

  getExplorerUrl(txId) {
    return `${this.config.explorerTransactionUrl}/${txId}`;
  }
}

module.exports = AlgorandAdapter;
