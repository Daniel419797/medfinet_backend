const { DomainError } = require('../utils/domainError');

function clinicalAssetPublicationDisabled() {
  return new DomainError(
    410,
    'CLINICAL_ASA_PUBLICATION_DISABLED',
    'Clinical records cannot be published as Algorand assets; Medfinet anchors only privacy-preserving cryptographic evidence'
  );
}

async function issueVaccinationRecord() {
  throw clinicalAssetPublicationDisabled();
}

async function submitSignedTransaction() {
  throw clinicalAssetPublicationDisabled();
}

module.exports = {
  issueVaccinationRecord,
  submitSignedTransaction,
};
