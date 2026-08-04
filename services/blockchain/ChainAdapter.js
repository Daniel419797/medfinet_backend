class ChainAdapter {
  async submitTransaction(note, fee) {
    throw new Error('submitTransaction() must be implemented by subclass');
  }

  async getTransaction(txId) {
    throw new Error('getTransaction() must be implemented by subclass');
  }

  async getBalance(address) {
    throw new Error('getBalance() must be implemented by subclass');
  }

  async isReachable() {
    throw new Error('isReachable() must be implemented by subclass');
  }

  getExplorerUrl(txId) {
    throw new Error('getExplorerUrl() must be implemented by subclass');
  }

  get networkName() {
    throw new Error('networkName must be implemented by subclass');
  }

  get defaultFee() {
    throw new Error('defaultFee must be implemented by subclass');
  }
}

module.exports = ChainAdapter;