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
    requestTimeoutMs: 50,
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
  assert.equal(result.network, 'testnet');
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
  assert.equal(transaction.lookupStatus, 'FOUND');
  assert.equal(transaction.confirmed, true);
  assert.equal(transaction.confirmedRound, 88n);
  assert.equal(transaction.sender, 'PLATFORM-ACCOUNT');
  assert.equal(transaction.signer, 'PLATFORM-ACCOUNT');
  assert.equal(transaction.receiver, 'PLATFORM-ACCOUNT');
  assert.equal(transaction.amount, 0n);
  assert.deepEqual(transaction.note, Buffer.from([0, 1, 9]));
});

test('reports an unavailable lookup when algod cannot retain or find a transaction', async () => {
  const notFound = new Error('not found');
  notFound.status = 404;
  const client = {
    pendingTransactionInformation: () => ({
      do: async () => { throw notFound; },
    }),
  };
  const adapter = new AlgorandAdapter(config(), {
    sdk: {},
    client,
    platformAccount: { addr: 'PLATFORM-ACCOUNT', sk: Buffer.from('secret') },
  });

  const transaction = await adapter.getTransaction('TX-1');

  assert.deepEqual(transaction, {
    lookupStatus: 'UNAVAILABLE',
    unavailableReason: 'TRANSACTION_NOT_RETAINED_OR_NOT_FOUND',
  });
});

test('bounds stalled algod transaction lookups', async () => {
  const client = {
    pendingTransactionInformation: () => ({
      do: async () => new Promise(() => {}),
    }),
  };
  const adapter = new AlgorandAdapter(
    { ...config(), requestTimeoutMs: 10 },
    {
      sdk: {},
      client,
      platformAccount: { addr: 'PLATFORM-ACCOUNT', sk: Buffer.from('secret') },
    },
  );

  await assert.rejects(
    adapter.getTransaction('TX-1'),
    (error) => error.code === 'ALGORAND_REQUEST_TIMEOUT',
  );
});

test('mints a 1-of-1 immutable certificate asset using only the fingerprint as metadata hash', async () => {
  let assetInput;
  const fingerprint = Buffer.from('ab'.repeat(32), 'hex');
  const client = {
    getTransactionParams: () => ({ do: async () => ({ minFee: 1_000 }) }),
    sendRawTransaction: () => ({ do: async () => ({ txid: 'NFT-TX-1' }) }),
  };
  const sdk = {
    makeAssetCreateTxnWithSuggestedParamsFromObject(input) {
      assetInput = input;
      return { signTxn: () => Buffer.from('signed-nft') };
    },
    waitForConfirmation: async () => ({
      confirmedRound: 99n,
      assetIndex: 123456n,
    }),
  };
  const account = { addr: 'PLATFORM-ACCOUNT', sk: Buffer.from('secret') };
  const adapter = new AlgorandAdapter(config(), {
    sdk,
    client,
    platformAccount: account,
  });

  const result = await adapter.mintCertificateNft({
    metadataHash: fingerprint,
    assetName: 'Medfinet Vaccine Certificate',
    unitName: 'MFVAX',
  });

  assert.equal(assetInput.sender, account.addr);
  assert.equal(assetInput.total, 1n);
  assert.equal(assetInput.decimals, 0);
  assert.equal(assetInput.defaultFrozen, false);
  assert.equal(assetInput.assetName, 'Medfinet Vaccine Certificate');
  assert.equal(assetInput.unitName, 'MFVAX');
  assert.deepEqual(Buffer.from(assetInput.assetMetadataHash), fingerprint);
  for (const field of ['assetURL', 'manager', 'reserve', 'freeze', 'clawback', 'note']) {
    assert.equal(Object.hasOwn(assetInput, field), false, `${field} must not publish certificate data`);
  }
  assert.equal(result.assetId, 123456n);
  assert.equal(result.txId, 'NFT-TX-1');
  assert.equal(result.blockHeight, 99n);
  assert.equal(result.network, 'testnet');
  assert.equal(result.creatorAddress, 'PLATFORM-ACCOUNT');
});

test('reads certificate asset parameters needed for on-chain verification', async () => {
  const client = {
    getAssetByID: (assetId) => ({
      do: async () => ({
        index: assetId,
        params: {
          creator: 'PLATFORM-ACCOUNT',
          total: 1n,
          decimals: 0,
          defaultFrozen: false,
          unitName: 'MFVAX',
          name: 'Medfinet Vaccine Certificate',
          metadataHash: Uint8Array.from(Buffer.from('cd'.repeat(32), 'hex')),
        },
      }),
    }),
  };
  const adapter = new AlgorandAdapter(config(), {
    sdk: {},
    client,
    platformAccount: { addr: 'PLATFORM-ACCOUNT', sk: Buffer.from('secret') },
  });

  const asset = await adapter.getAsset(987n);

  assert.equal(asset.lookupStatus, 'FOUND');
  assert.equal(asset.assetId, 987n);
  assert.equal(asset.creator, 'PLATFORM-ACCOUNT');
  assert.equal(asset.total, 1n);
  assert.equal(asset.decimals, 0);
  assert.equal(asset.url, null);
  assert.equal(asset.manager, null);
  assert.equal(asset.reserve, null);
  assert.equal(asset.freeze, null);
  assert.equal(asset.clawback, null);
  assert.equal(asset.metadataHash.length, 32);
});
