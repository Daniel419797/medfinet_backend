const algosdk = require("algosdk");
const config = require('../config');

const algodClient = new algosdk.Algodv2(
  config.algorand.algodToken,
  config.algorand.algodServer,
  config.algorand.algodPort
);

module.exports = { algodClient, algosdk };
