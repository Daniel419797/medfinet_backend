// src/utils/constants.js
const config = require('../config');

const PLATFORM_FEE_PERCENTAGE = config.campaign.platformFeePercentage;
const MIN_DONATION_AMOUNT = config.campaign.minimumDonationAmount;
const CAMPAIGN_DURATION_DAYS_MAX = config.campaign.maximumDurationDays;

module.exports = {
	PLATFORM_FEE_PERCENTAGE,
	MIN_DONATION_AMOUNT,
	CAMPAIGN_DURATION_DAYS_MAX,
};
