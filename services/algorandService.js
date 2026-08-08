const algosdk = require('algosdk');
const config = require('../config');

class AlgorandService {
  constructor() {
    if (!config.algorand.enabled) {
      throw new Error('Algorand is disabled in this environment');
    }

    this.algodClient = new algosdk.Algodv2(
      config.algorand.algodToken || '',
      config.algorand.algodServer,
      config.algorand.algodPort
    );
    this.platformWallet = algosdk.mnemonicToSecretKey(
      config.algorand.platformWalletMnemonic
    );
  }

  async getSuggestedParams() {
    return this.algodClient.getTransactionParams().do();
  }

  async waitForConfirmation(txId) {
    return algosdk.waitForConfirmation(
      this.algodClient,
      txId,
      config.algorand.confirmationRounds
    );
  }

  async getAccountBalance(address) {
    try {
      const accountInfo = await this.algodClient.accountInformation(address).do();
      return Number(accountInfo.amount);
    } catch (error) {
      throw new Error(`Failed to get account balance: ${error.message || error}`);
    }
  }

  async verifyTransaction(txId) {
    try {
      const txInfo = await this.algodClient.pendingTransactionInformation(txId).do();
      return Boolean(txInfo.confirmedRound || txInfo['confirmed-round']);
    } catch {
      return false;
    }
  }

  async sendSignedTransaction(signedTxn) {
    try {
      const payload = Array.isArray(signedTxn)
        ? signedTxn.map((transaction) => new Uint8Array(transaction))
        : new Uint8Array(signedTxn);
      const result = await this.algodClient.sendRawTransaction(payload).do();
      return result.txid || result.txId;
    } catch (error) {
      throw new Error(`Failed to send transaction: ${error.message || error}`);
    }
  }

  getPlatformAddress() {
    return this.platformWallet.addr.toString();
  }
}

module.exports = AlgorandService;
