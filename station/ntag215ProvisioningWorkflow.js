class ProvisioningWorkflowError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProvisioningWorkflowError';
    this.code = code;
  }
}

class Ntag215ProvisioningWorkflow {
  constructor({ api, station, attestor, deviceId }) {
    const apiMethods = ['createDraft', 'prepare', 'activate', 'cancel'];
    if (!api || apiMethods.some((method) => typeof api[method] !== 'function')) {
      throw new ProvisioningWorkflowError(
        'INVALID_PROVISIONING_API',
        'Provisioning API must implement createDraft, prepare, activate, and cancel'
      );
    }
    if (!station?.inspect || !station?.personalize) {
      throw new ProvisioningWorkflowError(
        'INVALID_NTAG215_STATION',
        'Station must implement inspect and personalize'
      );
    }
    if (!attestor?.signPreparation || !attestor?.signActivation) {
      throw new ProvisioningWorkflowError(
        'INVALID_STATION_ATTESTOR',
        'Attestor must sign preparation and activation evidence'
      );
    }
    if (typeof deviceId !== 'string' || !deviceId.trim()) {
      throw new ProvisioningWorkflowError('INVALID_DEVICE_ID', 'Approved station deviceId is required');
    }
    this.api = api;
    this.station = station;
    this.attestor = attestor;
    this.deviceId = deviceId.trim();
  }

  async provision(childId, options = {}) {
    let draft;
    let phase = 'CREATE_DRAFT';
    try {
      draft = await this.api.createDraft(childId, options);
      phase = 'INSPECT_CARD';
      const inspection = await this.station.inspect();
      const preparationInput = {
        personalizationToken: draft.personalizationToken,
        ...inspection,
        deviceId: this.deviceId,
      };
      phase = 'AUTHORIZE_CARD';
      const prepared = await this.api.prepare(draft.binding.id, {
        ...preparationInput,
        deviceSignature: await this.attestor.signPreparation(
          draft.binding.id,
          preparationInput
        ),
      });

      phase = 'PERSONALIZE_CARD';
      const physicalEvidence = await this.station.personalize({
        manifest: draft.manifest,
        access: prepared.access,
        inspectedUid: inspection.uid,
      });
      const activationInput = {
        personalizationToken: draft.personalizationToken,
        cardToken: draft.cardToken,
        uc: physicalEvidence.uc,
        ndefReadback: physicalEvidence.ndefReadback,
        configurationPageHex: physicalEvidence.configurationPageHex,
        accessPageHex: physicalEvidence.accessPageHex,
        packResponseHex: physicalEvidence.packResponseHex,
        writeProtected: physicalEvidence.writeProtected,
        configurationLocked: physicalEvidence.configurationLocked,
        deviceId: this.deviceId,
      };
      phase = 'ACTIVATE_CARD';
      const activated = await this.api.activate(draft.binding.id, {
        ...activationInput,
        deviceSignature: await this.attestor.signActivation(
          draft.binding.id,
          activationInput
        ),
      });
      return {
        binding: activated.binding || activated,
        uid: inspection.uid,
        status: 'ACTIVE',
      };
    } catch (cause) {
      if (draft?.binding?.id && phase !== 'ACTIVATE_CARD') {
        await this.cancelSafely(draft.binding.id, phase);
      }
      throw new ProvisioningWorkflowError(
        'NTAG215_PROVISIONING_FAILED',
        `NTAG215 provisioning failed during ${phase}`,
        cause
      );
    } finally {
      if (typeof this.station.close === 'function') await this.station.close();
    }
  }

  async cancelSafely(bindingId, phase) {
    try {
      await this.api.cancel(bindingId, {
        reason: `Station aborted during ${phase}; quarantine physical card`,
      });
    } catch {
      throw new ProvisioningWorkflowError(
        'NFC_CANCELLATION_FAILED',
        'Provisioning failed and the pending binding could not be cancelled; quarantine card and escalate'
      );
    }
  }
}

module.exports = { Ntag215ProvisioningWorkflow, ProvisioningWorkflowError };
