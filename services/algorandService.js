// src/services/algorand.service.js
const algosdk = require('algosdk');
const config = require('../config');

class AlgorandService {
  constructor() {
    this.algodClient = new algosdk.Algodv2(
      config.algorand.algodToken,
      config.algorand.algodServer,
      config.algorand.algodPort
    );

    this.indexerClient = new algosdk.Indexer(
      config.algorand.indexerToken,
      config.algorand.indexerServer,
      config.algorand.indexerPort
    );

    // Platform wallet for fees (in production, use secure key management)
    this.platformWallet = algosdk.mnemonicToSecretKey(
      config.algorand.platformWalletMnemonic
    );
  }

  async getSuggestedParams() {
    return await this.algodClient.getTransactionParams().do();
  }

  async waitForConfirmation(txId) {
    let lastRound = await this.algodClient.status().do();
    lastRound = lastRound['last-round'];

    try {
        // This function handles the polling loop, statusAfterBlock, etc.
        const confirmedTx = await algosdk.waitForConfirmation(
          this.algodClient,
          txId,
          config.algorand.confirmationRounds
        );
        return confirmedTx;
    } catch (error) {
        throw error; // Propagate the error up the chain
    }
  }

  async getAccountBalance(address) {
    try {
      const accountInfo = await this.algodClient.accountInformation(address).do();
      return Number(accountInfo.amount);
    } catch (error) {
      throw new Error(`Failed to get account balance: ${error}`);
    }
  }

  async verifyTransaction(txId) {
    try {
      const txInfo = await this.algodClient.pendingTransactionInformation(txId).do();
      return txInfo['confirmed-round'] !== undefined;
    } catch (error) {
      return false;
    }
  }

  async createUnsignedDonationTransaction(params) {
    const suggestedParams = await this.getSuggestedParams();
    
    return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: params.from,
      to: params.to,
      amount: Math.floor(params.amount * 1000000), // Convert to microAlgos
      note: params.note,
      suggestedParams,
    });
  }

  async sendSignedTransaction(signedTxn) {
    try {
      if (Array.isArray(signedTxn)) {
        // Must be EXACTLY an array of Uint8Array
        const normalized = signedTxn.map(tx => new Uint8Array(tx));
        const txId = await this.algodClient.sendRawTransaction(normalized).do();
        return txId.txid;
      } else {
        // single txn
        const txId = await this.algodClient.sendRawTransaction(
          new Uint8Array(signedTxn)
        ).do();
        return txId.txid;
      }
    } catch (error) {
      throw new Error(`Failed to send transaction: ${error}`);
    }
  }

  getPlatformAddress() {
    return this.platformWallet.addr.toString();
  }
}

module.exports = AlgorandService;
