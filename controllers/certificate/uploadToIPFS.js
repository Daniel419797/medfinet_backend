const { NFTStorage, File } = require("nft.storage");
const fs = require("fs");
const config = require('../../config');

const client = new NFTStorage({ token: config.storage.nftStorageApiToken });

async function uploadToIPFS(imagePath, metadata) {
  const image = await fs.promises.readFile(imagePath);

  const metadataContent = {
    name: "Vaccination Certificate",
    description: "Blockchain-based immunization record",
    image: new File([image], "certificate.png", { type: "image/png" }),
    properties: metadata,
  };

  const metadataCid = await client.store(metadataContent);
  return metadataCid.url; // ipfs://...
}

module.exports = uploadToIPFS;
