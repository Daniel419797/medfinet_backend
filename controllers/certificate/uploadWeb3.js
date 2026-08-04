const { Web3Storage, File } = require('web3.storage');
const config = require('../../config');

function makeStorageClient() {
  return new Web3Storage({ token: config.storage.web3StorageToken });
}

async function uploadVaccinationRecord(vaccineData) {
  const metadata = JSON.stringify(vaccineData, null, 2);
  const files = [
    new File([metadata], 'vaccination.json', { type: 'application/json' }),
  ];

  const client = makeStorageClient();
  const cid = await client.put(files);
  const gatewayUrl = config.storage.ipfsGatewayTemplate
    .replace('{cid}', cid)
    .replace('{path}', 'vaccination.json');

  return cid;
}

module.exports = uploadVaccinationRecord;
