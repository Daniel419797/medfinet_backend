function ledgerEntries(organizationId, debitAccount, creditAccount, amount) {
  return {
    create: [
      {
        organizationId,
        accountCode: debitAccount,
        debit: amount,
        credit: 0n,
      },
      {
        organizationId,
        accountCode: creditAccount,
        debit: 0n,
        credit: amount,
      },
    ],
  };
}

function householdAvailable(accountId) {
  return `HOUSEHOLD_AVAILABLE:${accountId}`;
}

function householdReserved(accountId) {
  return `HOUSEHOLD_RESERVED:${accountId}`;
}

function merchantPayable(merchantId) {
  return `MERCHANT_PAYABLE:${merchantId}`;
}

function campaignExpense(campaignId) {
  return `CAMPAIGN_EXPENSE:${campaignId}`;
}

module.exports = {
  ledgerEntries,
  householdAvailable,
  householdReserved,
  merchantPayable,
  campaignExpense,
};
