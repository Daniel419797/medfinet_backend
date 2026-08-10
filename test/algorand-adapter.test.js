const assert = require('node:assert/strict');
const test = require('node:test');
const AlgorandAdapter = require('../services/blockchain/adapters/AlgorandAdapter');

function config() {
  return {
    network: 'testnet',
    networkName: 'Algorand TestNet',
    chainId: 416002,
    algodServer: 'algod-service',
    algodPort: 443,
    algodToken: '',
    explorerTransactionUrl: 'explorer-service',
    platformWalletMnemonic: 'unused-with-injected-account',
    confirmationRounds: 4,
    fee: 1_000,
  };
}

test('builds an SDK v3 self-payment and persists the positive confirmed round', async () => {
  let paymentInput;
  const client = {
    getTransactionParams: () => ({ do: async () => ({ fee: 1_000 }) }),
    sendRawTransaction: () => ({ do: async () => ({ txid: 'TX-1' }) }),
  };
  const sdk = {
    makePaymentTxnWithSuggestedParamsFromObject(input) {
      paymentInput = input;
      return { signTxn: () => Buffer.from('signed') };
    },
    waitForConfirmation: async () => ({ confirmedRound: 88n }),
  };
  const account = { addr: 'PLATFORM-ACCOUNT', sk: Buffer.from('secret') };
  const adapter = new AlgorandAdapter(config(), {
    sdk,
    client,
    platformAccount: account,
  });

  const result = await adapter.submitTransaction(Buffer.alloc(35), 1_000);

  assert.equal(paymentInput.sender, account.addr);
  assert.equal(paymentInput.receiver, account.addr);
  assert.equal(Object.hasOwn(paymentInput, 'from'), false);
  assert.equal(Object.hasOwn(paymentInput, 'to'), false);
  assert.equal(paymentInput.amount, 0);
  assert.equal(result.txId, 'TX-1');
  assert.equal(result.blockHeight, 88n);
});

test('does not report confirmed when Algorand returns round zero', async () => {
  const client = {
    getTransactionParams: () => ({ do: async () => ({}) }),
    sendRawTransaction: () => ({ do: async () => ({ txid: 'TX-1' }) }),
  };
  const sdk = {
    makePaymentTxnWithSuggestedParamsFromObject: () => ({
      signTxn: () => Buffer.from('signed'),
    }),
    waitForConfirmation: async () => ({ confirmedRound: 0n }),
  };
  const adapter = new AlgorandAdapter(config(), {
    sdk,
    client,
    platformAccount: { addr: 'PLATFORM-ACCOUNT', sk: Buffer.from('secret') },
  });

  await assert.rejects(
    adapter.submitTransaction(Buffer.alloc(35), 1_000),
    /did not reach a confirmed round/,
  );
});

test('reads exact transaction identity and payment semantics from the SDK response', async () => {
  const inner = {
    type: 'pay',
    sender: 'PLATFORM-ACCOUNT',
    note: Uint8Array.from([0, 1, 9]),
    payment: {
      receiver: 'PLATFORM-ACCOUNT',
      amount: 0n,
    },
    txID: () => 'TX-1',
  };
  const client = {
    pendingTransactionInformation: () => ({
      do: async () => ({
        confirmedRound: 88n,
        txn: { txn: inner },
      }),
    }),
  };
  const adapter = new AlgorandAdapter(config(), {
    sdk: {},
    client,
    platformAccount: { addr: 'PLATFORM-ACCOUNT', sk: Buffer.from('secret') },
  });

  const transaction = await adapter.getTransaction('TX-1');

  assert.equal(transaction.txId, 'TX-1');
  assert.equal(transaction.confirmed, true);
  assert.equal(transaction.confirmedRound, 88n);
  assert.equal(transaction.sender, 'PLATFORM-ACCOUNT');
  assert.equal(transaction.signer, 'PLATFORM-ACCOUNT');
  assert.equal(transaction.receiver, 'PLATFORM-ACCOUNT');
  assert.equal(transaction.amount, 0n);
  assert.deepEqual(transaction.note, Buffer.from([0, 1, 9]));
});
