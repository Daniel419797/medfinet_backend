const assert = require('node:assert/strict');
const test = require('node:test');
const {
  Ntag215ProvisioningWorkflow,
  ProvisioningWorkflowError,
} = require('../station/ntag215ProvisioningWorkflow');

function dependencies({ personalizeFailure = null } = {}) {
  const calls = [];
  const api = {
    async createDraft(childId) {
      calls.push(['createDraft', childId]);
      return {
        binding: { id: 'binding-1' },
        personalizationToken: 'personalization-token',
        cardToken: 'A'.repeat(43),
        manifest: { hardwareFamily: 'NTAG_215' },
      };
    },
    async prepare(bindingId, input) {
      calls.push(['prepare', bindingId, input]);
      return { access: { passwordHex: '11223344', packHex: 'A1B2' } };
    },
    async activate(bindingId, input) {
      calls.push(['activate', bindingId, input]);
      return { binding: { id: bindingId, status: 'ACTIVE' } };
    },
    async cancel(bindingId, input) {
      calls.push(['cancel', bindingId, input]);
    },
  };
  const station = {
    async inspect() {
      calls.push(['inspect']);
      return {
        versionResponse: '0004040201001103',
        uid: '04DE5F1EACC042',
        originalitySignature: 'B'.repeat(64),
        originalityVerified: true,
      };
    },
    async personalize(input) {
      calls.push(['personalize', input]);
      if (personalizeFailure) throw personalizeFailure;
      return {
        uc: '04DE5F1EACC042x000001',
        ndefReadback: 'https://app.test/nfc/tap/public#uc=04DE5F1EACC042x000001&t=token',
        configurationPageHex: 'D4001504',
        accessPageHex: '57000000',
        packResponseHex: 'A1B2',
        writeProtected: true,
        configurationLocked: true,
      };
    },
  };
  const attestor = {
    async signPreparation(bindingId, input) {
      calls.push(['signPreparation', bindingId, input]);
      return 'preparation-signature';
    },
    async signActivation(bindingId, input) {
      calls.push(['signActivation', bindingId, input]);
      return 'activation-signature';
    },
  };
  return { api, station, attestor, calls };
}

test('binds backend authorization to inspection, physical locking, and activation', async () => {
  const fixture = dependencies();
  const workflow = new Ntag215ProvisioningWorkflow({
    ...fixture,
    deviceId: 'approved-station-1',
  });
  const result = await workflow.provision('child-1');
  assert.equal(result.status, 'ACTIVE');
  assert.deepEqual(
    fixture.calls.map(([name]) => name),
    [
      'createDraft',
      'inspect',
      'signPreparation',
      'prepare',
      'personalize',
      'signActivation',
      'activate',
    ]
  );
  const activation = fixture.calls.find(([name]) => name === 'activate')[2];
  assert.equal(activation.configurationLocked, true);
  assert.equal(activation.deviceSignature, 'activation-signature');
});

test('cancels the binding and quarantines the card when personalization fails', async () => {
  const fixture = dependencies({ personalizeFailure: new Error('reader disconnected') });
  const workflow = new Ntag215ProvisioningWorkflow({
    ...fixture,
    deviceId: 'approved-station-1',
  });
  await assert.rejects(
    workflow.provision('child-1'),
    (error) => (
      error instanceof ProvisioningWorkflowError
      && error.code === 'NTAG215_PROVISIONING_FAILED'
      && error.message.includes('PERSONALIZE_CARD')
    )
  );
  const cancellation = fixture.calls.find(([name]) => name === 'cancel');
  assert.equal(cancellation[1], 'binding-1');
  assert.match(cancellation[2].reason, /quarantine physical card/);
  assert.equal(fixture.calls.some(([name]) => name === 'activate'), false);
});
