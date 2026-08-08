const algosdk = require('algosdk');
const { getNetworkConfig } = require('./blockchain/networkRegistry');

class AlgorandService {
  constructor(network) {
    this.config = getNetworkConfig(network);
    this.network = this.config.network;
    this.algodClient = new algosdk.Algodv2(
      this.config.algodToken || '',
      this.config.algodServer,
      this.config.algodPort
    );
    this.platformWallet = algosdk.mnemonicToSecretKey(
      this.config.platformWalletMnemonic
    );
  }

  async getSuggestedParams() {
    return this.algodClient.getTransactionParams().do();
  }

  async waitForConfirmation(txId) {
    return algosdk.waitForConfirmation(
      this.algodClient,
      txId,
      this.config.confirmationRounds
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
      throw new Error(`Failed to send transaction on ${this.network}: ${error.message || error}`);
    }
  }

  getPlatformAddress() {
    return this.platformWallet.addr.toString();
  }
}

module.exports = AlgorandService;
