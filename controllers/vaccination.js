const { issueVaccinationRecord } = require('../algorand/algorand');
const config = require('../config');


exports.issueRecord = async (req, res) => {
  try {
    const vaccinationData = req.body;
    
    // Validate data
    if (!vaccinationData.childIdHash || !vaccinationData.vaccineId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Only a non-identifying hash is anchored publicly. Clinical data remains off-chain.
    const unsignedTxn = await issueVaccinationRecord(
      config.algorand.vaccinationProofUrl,
      vaccinationData
    );
    
    res.json({
      success: true,
      unsignedTxn,
      proofUrl: config.algorand.vaccinationProofUrl,
      message: 'Vaccination proof prepared for blockchain submission'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to issue vaccination record' });
  }
};
