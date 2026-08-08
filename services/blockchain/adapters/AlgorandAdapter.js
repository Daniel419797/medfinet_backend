const algosdk = require('algosdk');
const ChainAdapter = require('../ChainAdapter');

class AlgorandAdapter extends ChainAdapter {
  constructor(config) {
    super();
    const resolvedConfig = config?.network
      ? config
      : require('../networkRegistry').getNetworkConfig();
    this.config = resolvedConfig;
    this.client = new algosdk.Algodv2(
      resolvedConfig.algodToken || '',
      resolvedConfig.algodServer,
      resolvedConfig.algodPort
    );
    this.platformAccount = algosdk.mnemonicToSecretKey(
      resolvedConfig.platformWalletMnemonic
    );
    this._confirmationRounds = resolvedConfig.confirmationRounds || 4;
    this._fee = resolvedConfig.fee || 1_000;
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
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: this.platformAccount.addr,
      to: this.platformAccount.addr,
      amount: 0,
      note,
      suggestedParams: {
        ...params,
        fee: fee || this._fee,
        flatFee: true,
      },
    });
    const signed = txn.signTxn(this.platformAccount.sk);
    const { txId } = await this.client.sendRawTransaction(signed).do();
    const confirmed = await algosdk.waitForConfirmation(
      this.client, txId, this._confirmationRounds
    );
    return {
      txId,
      blockHeight: confirmed['confirmed-round'],
      confirmations: this._confirmationRounds,
      network: this.networkId,
    };
  }

  async getTransaction(txId) {
    try {
      const tx = await this.client.pendingTransactionInformation(txId).do();
      return {
        txId,
        note: tx.txn.txn.note ? Buffer.from(tx.txn.txn.note, 'base64') : null,
        timestamp: tx['round-time'] ? new Date(tx['round-time'] * 1000).toISOString() : null,
        confirmed: tx.confirmedRound !== undefined && tx.confirmedRound !== null,
      };
    } catch {
      return null;
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
