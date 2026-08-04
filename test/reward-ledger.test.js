const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ledgerEntries,
  householdAvailable,
  householdReserved,
  merchantPayable,
  campaignExpense,
} = require('../services/rewardLedger');

test('creates exactly balanced debit and credit journal legs', () => {
  const entries = ledgerEntries(
    'org-1',
    campaignExpense('campaign-1'),
    householdAvailable('account-1'),
    125n
  ).create;
  const debit = entries.reduce((total, entry) => total + entry.debit, 0n);
  const credit = entries.reduce((total, entry) => total + entry.credit, 0n);

  assert.equal(entries.length, 2);
  assert.equal(debit, 125n);
  assert.equal(credit, 125n);
  assert.equal(entries[0].organizationId, 'org-1');
});

test('uses distinct control accounts for availability, reservations, and payables', () => {
  assert.notEqual(householdAvailable('a'), householdReserved('a'));
  assert.notEqual(householdReserved('a'), merchantPayable('m'));
});
