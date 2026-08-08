const algosdk = require('algosdk');
const fs = require('node:fs');
const path = require('node:path');
const AlgorandService = require('./algorandService');

class SmartContractService {
  constructor(network) {
    this.algorandService = new AlgorandService(network);
    this.network = this.algorandService.network;
  }

  async createCampaignEscrow(campaignData) {
    try {
      const approvalProgram = await this.compileTealProgram('campaign_escrow_approval.teal');
      const clearProgram = await this.compileTealProgram('campaign_escrow_clear.teal');
      const suggestedParams = await this.algorandService.getSuggestedParams();
      const platformWallet = this.algorandService.getPlatformAddress();

      const txn = algosdk.makeApplicationCreateTxnFromObject({
        sender: platformWallet,
        suggestedParams,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        approvalProgram,
        clearProgram,
        numGlobalByteSlices: 8,
        numGlobalInts: 8,
        numLocalByteSlices: 0,
        numLocalInts: 0,
        appArgs: [
          new TextEncoder().encode(campaignData.creator),
          algosdk.encodeUint64(campaignData.targetAmount),
          algosdk.encodeUint64(campaignData.endTime),
          new TextEncoder().encode(platformWallet),
        ],
      });

      const signedTxn = txn.signTxn(this.algorandService.platformWallet.sk);
      const txId = await this.algorandService.sendSignedTransaction(signedTxn);
      const result = await this.algorandService.waitForConfirmation(txId);
      const appId = Number(result.applicationIndex || result['application-index']);
      const escrowAddress = algosdk.getApplicationAddress(appId).toString();

      return { escrowAddress, appId, txId, network: this.network };
    } catch (error) {
      throw new Error(`Failed to create campaign escrow on ${this.network}: ${error.message}`);
    }
  }

  async donateToCampaign({ appId, donor, amount }) {
    try {
      const suggestedParams = await this.algorandService.getSuggestedParams();
      const appAddress = algosdk.getApplicationAddress(Number(appId)).toString();
      const amountMicroAlgos = Math.floor(Number(amount) * 1_000_000);

      if (!algosdk.isValidAddress(donor)) {
        throw new Error('Donor wallet is not a valid Algorand address');
      }
      if (!Number.isSafeInteger(amountMicroAlgos) || amountMicroAlgos <= 0) {
        throw new Error('Donation amount must be greater than zero');
      }

      const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: donor,
        receiver: appAddress,
        amount: amountMicroAlgos,
        suggestedParams,
      });
      const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: donor,
        suggestedParams,
        appIndex: Number(appId),
        appArgs: [new TextEncoder().encode('donate')],
      });
      const transactions = [paymentTxn, appCallTxn];
      algosdk.assignGroupID(transactions);

      return {
        transactions,
        txId: paymentTxn.txID(),
        network: this.network,
      };
    } catch (error) {
      throw new Error(`Failed to create donation transaction on ${this.network}: ${error.message || error}`);
    }
  }

  async withdrawFunds({ appId, creator }) {
    try {
      if (!algosdk.isValidAddress(creator)) {
        throw new Error('Creator wallet is not a valid Algorand address');
      }

      const suggestedParams = await this.algorandService.getSuggestedParams();
      const withdrawTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: creator,
        suggestedParams,
        appIndex: Number(appId),
        appArgs: [new TextEncoder().encode('withdraw')],
      });
      const acknowledgementTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: creator,
        receiver: creator,
        amount: 0,
        suggestedParams,
      });
      const transactions = [withdrawTxn, acknowledgementTxn];
      algosdk.assignGroupID(transactions);

      return {
        transactions,
        txId: withdrawTxn.txID(),
        network: this.network,
      };
    } catch (error) {
      throw new Error(`Failed to create withdrawal transaction on ${this.network}: ${error.message || error}`);
    }
  }

  async getCampaignState(appId) {
    try {
      const appInfo = await this.algorandService.algodClient
        .getApplicationByID(Number(appId))
        .do();
      return appInfo.params['global-state'];
    } catch (error) {
      throw new Error(`Failed to get campaign state on ${this.network}: ${error.message || error}`);
    }
  }

  async compileTealProgram(filename) {
    try {
      const contractsPath = path.join(process.cwd(), filename);
      if (!fs.existsSync(contractsPath)) {
        throw new Error(`TEAL file not found: ${contractsPath}`);
      }
      const tealCode = fs.readFileSync(contractsPath, 'utf8');
      const compileResponse = await this.algorandService.algodClient.compile(tealCode).do();
      return new Uint8Array(Buffer.from(compileResponse.result, 'base64'));
    } catch (error) {
      throw new Error(`Failed to compile TEAL program: ${error.message}`);
    }
  }
}

module.exports = SmartContractService;
