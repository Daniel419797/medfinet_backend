const test = require('node:test');
const assert = require('node:assert/strict');
const { createUssdEngine } = require('../services/ussdEngine');
const { publicStatus } = require('../services/nfcPublicTapService');
const { message } = require('../services/ussdMessages');

const config = {
  ussd: {
    phonePepper: 'p'.repeat(32),
    pinPepper: 'i'.repeat(32),
    otpPepper: 'o'.repeat(32),
    sessionTtlSeconds: 180,
    maxResponseCharacters: 160,
  },
  notifications: {},
};

function body(text = '') {
  return { sessionId: 'provider-1', serviceCode: '*123#', phoneNumber: '08012345678', text };
}

function harness(overrides = {}) {
  let saved;
  const baseSession = {
    id: 'session-1',
    provider: 'africas_talking',
    providerSessionId: 'provider-1',
    organizationId: 'org-1',
    caregiverId: 'caregiver-1',
    locale: 'en',
    assurance: 'PIN',
    currentMenu: 'ROOT',
    state: { inputCount: 0 },
  };
  const sessions = {
    open: async () => ({ session: overrides.session || baseSession, replay: null }),
    save: async (_session, _request, result) => { saved = result; },
  };
  const care = {
    nextAppointment: async () => null,
    requestCallback: async () => ({}),
    registerProgrammeInterest: async () => ({}),
    latestUnconfirmedDelivery: async () => null,
    activeClimateNotice: async () => null,
    requestClimateAssistance: async () => ({}),
    respondToAppointment: async () => ({}),
    confirmDelivery: async () => ({}),
    ...overrides.care,
  };
  const highRisk = {
    eligibleNfcCards: async () => [],
    pendingConsent: async () => null,
    rewardBalance: async () => ({ balance: 0n, reservedBalance: 0n }),
    pendingRewardReservation: async () => null,
    eligibleRewardItems: async () => [],
    requestCardSupport: async () => ({}),
    decideConsent: async () => ({}),
    confirmRewardReservation: async () => ({}),
    ...overrides.highRisk,
  };
  const database = {
    ussdSession: { update: async () => ({}) },
    organization: { findUnique: async () => ({ name: 'Clinic' }) },
  };
  const engine = createUssdEngine(database, {
    config,
    sessions,
    identity: { resolveRoutes: async () => ({ routes: [] }), verifySessionPin: async () => ({}) },
    care,
    highRisk,
    facilities: { search: async () => [], ...overrides.facilities },
    continuation: overrides.continuation || { queueFacilityDetails: async () => ({}) },
    otp: overrides.otp || { issue: async () => ({ challengeId: 'otp-1' }), verify: async () => ({}) },
  });
  return { engine, saved: () => saved };
}

test('root menu exposes every workflow group within one USSD response', async () => {
  const h = harness();
  const output = await h.engine.handle(body());
  assert.match(output, /^CON Medfinet/);
  for (const label of ['Appointments', 'Vaccination', 'Card help', 'Find clinic', 'Callback', 'Consent', 'Programmes', 'Delivery', 'Rewards', 'Emergency']) {
    assert.match(output, new RegExp(label));
  }
  assert.ok(output.length <= 160);
});

test('appointment menu uses safe minimum details and supports confirmation', async () => {
  let confirmed = false;
  const item = {
    id: 'appt-1', childId: 'child-1', scheduledFor: '2026-08-12T09:00:00Z',
    facility: { name: 'Community Health Centre', address: 'Main Road', phone: '0800' },
  };
  const h = harness({ care: {
    nextAppointment: async () => item,
    respondToAppointment: async (_ctx, id, input) => {
      confirmed = id === item.id && input.decision === 'CONFIRMED';
    },
  } });
  const output = await h.engine.handle(body('1'));
  assert.match(output, /^CON .*Community Health Centre/);
  const second = harness({
    session: { id: 'session-1', organizationId: 'org-1', caregiverId: 'caregiver-1', locale: 'en', currentMenu: 'APPOINTMENT', state: { inputCount: 1, item } },
    care: { respondToAppointment: async () => { confirmed = true; } },
  });
  assert.equal(await second.engine.handle(body('1*1')), 'END Appointment confirmed.');
  assert.equal(confirmed, true);
});

test('lost-card request is action-bound to OTP before suspension workflow runs', async () => {
  let issued;
  let verified = false;
  let suspended = false;
  const action = { type: 'CARD', id: 'card-1', requestType: 'LOST_CARD_SUSPENSION' };
  const first = harness({
    session: { id: 'session-1', organizationId: 'org-1', caregiverId: 'caregiver-1', locale: 'en', currentMenu: 'CARD', state: { inputCount: 1, cardId: 'card-1' } },
    otp: { issue: async (_ctx, purpose, value) => { issued = { purpose, value }; return { challengeId: 'otp-1' }; }, verify: async () => ({}) },
  });
  const prompt = await first.engine.handle(body('3*1'));
  assert.match(prompt, /^CON An SMS code/);
  assert.deepEqual(issued, { purpose: 'CARD_SUSPENSION', value: action });

  const second = harness({
    session: { id: 'session-1', organizationId: 'org-1', caregiverId: 'caregiver-1', locale: 'en', currentMenu: 'OTP', state: { inputCount: 2, otp: { challengeId: 'otp-1', purpose: 'CARD_SUSPENSION', action } } },
    highRisk: { requestCardSupport: async () => { suspended = true; } },
    otp: { issue: async () => ({}), verify: async () => { verified = true; } },
  });
  assert.match(await second.engine.handle(body('3*1*123456')), /^END Request received/);
  assert.equal(verified, true);
  assert.equal(suspended, true);
});

test('facility lookup is available to a phone without a registered caregiver account', async () => {
  const session = { id: 'session-public', locale: 'en', currentMenu: 'PUBLIC_FACILITY_AREA', state: { inputCount: 1 } };
  const h = harness({ session });
  h.engine = createUssdEngine({}, {
    config,
    sessions: { open: async () => ({ session, replay: null }), save: async () => {} },
    identity: {}, care: {}, highRisk: {}, otp: {},
    facilities: { search: async () => [{ facilityName: 'River Clinic', address: '12 Main St', phone: '0700' }] },
  });
  assert.match(await h.engine.handle(body('1*Ikeja')), /^END River Clinic/);
});

test('a card suspended by USSD returns a safe public status without enabling scanning', () => {
  const result = publicStatus({
    status: 'SUSPENDED',
    originalityVerifiedAt: new Date(),
    credential: { status: 'SUSPENDED', expiresAt: null },
  }, new Date());
  assert.equal(result.status, 'SUSPENDED');
  assert.equal(result.recognized, true);
  assert.equal(result.scannerRequired, false);
  assert.doesNotMatch(JSON.stringify(result), /child|caregiver|medical/i);
});

test('all four languages cover every interactive prompt without unresolved placeholders', () => {
  const keys = [
    'pin', 'invalid', 'root', 'done', 'none', 'otp', 'appointment', 'vaccination',
    'cardMenu', 'cardSelect', 'area', 'callback', 'consent', 'programme', 'delivery',
    'rewards', 'noRedemption', 'redemption', 'eligible', 'climate', 'climateAlert',
    'noClimateAlert', 'language', 'unregistered', 'selectAccount', 'provider',
    'preferredDate', 'dateFormat', 'appointmentConfirmed', 'location',
    'addressUnavailable', 'phoneUnavailable', 'temporaryArea',
    'smsOption', 'smsQueued',
  ];
  const values = {
    date: '12 Aug 2026', facility: 'Central Clinic', items: '1 Item', recipient: 'Clinic',
    purpose: 'vaccination', quantity: 1, unit: 'net', category: 'support', points: 450,
    amount: 20, merchant: 'Health Shop', type: 'FLOOD', name: 'Flood alert', severity: 'HIGH',
    address: 'Main Rd', phone: '0700', hours: 'Mon-Fri',
  };
  for (const locale of ['en', 'ha', 'yo', 'ig']) {
    for (const key of keys) {
      const output = message(locale, key, values);
      assert.ok(output.length > 0, `${locale}.${key} must not be empty`);
      assert.doesNotMatch(output, /\{[a-zA-Z]+\}/, `${locale}.${key} has a placeholder`);
      assert.ok(output.length <= 156, `${locale}.${key} exceeds the USSD payload limit`);
    }
  }
});

test('rewards supports eligible items, redemption confirmation, and problem reporting', async () => {
  let callbackCategory;
  const base = { id: 'session-r', organizationId: 'org-1', caregiverId: 'caregiver-1', locale: 'en' };
  const eligible = harness({
    session: { ...base, currentMenu: 'REWARDS_MENU', state: { inputCount: 1 } },
    highRisk: { eligibleRewardItems: async () => [{ name: 'Health Shop', eligibleCategories: ['NUTRITION'] }] },
  });
  assert.match(await eligible.engine.handle(body('9*1')), /^END Eligible merchants\/items/);

  const redemption = harness({
    session: { ...base, currentMenu: 'REWARDS_MENU', state: { inputCount: 1 } },
    highRisk: { pendingRewardReservation: async () => ({
      id: 'reservation-1', amount: 50n, merchant: { name: 'Health Shop' },
    }) },
  });
  assert.match(await redemption.engine.handle(body('9*2')), /^CON Confirm 50 points/);

  const problem = harness({
    session: { ...base, currentMenu: 'REWARDS_MENU', state: { inputCount: 1 } },
    care: { requestCallback: async (_ctx, category) => { callbackCategory = category; } },
  });
  assert.match(await problem.engine.handle(body('9*3')), /^END Request received/);
  assert.equal(callbackCategory, 'REWARDS');
});

test('climate response checks alerts, finds temporary clinics, and records urgent needs', async () => {
  const base = { id: 'session-c', organizationId: 'org-1', caregiverId: 'caregiver-1', locale: 'en' };
  const alert = harness({
    session: { ...base, currentMenu: 'CLIMATE_CHECK_AREA', state: { inputCount: 2 } },
    care: { activeClimateNotice: async () => ({ eventType: 'FLOOD', name: 'River Flood', severity: 'HIGH' }) },
  });
  assert.match(await alert.engine.handle(body('0*1*Ikeja')), /^END FLOOD: River Flood/);

  let temporaryOnly = false;
  const clinic = harness({
    session: { ...base, currentMenu: 'TEMPORARY_FACILITY_AREA', state: { inputCount: 2 } },
    facilities: { search: async (_area, options) => {
      temporaryOnly = options.temporaryOnly;
      return [{ facilityName: 'Flood Clinic', administrativeArea: 'Ikeja', phone: '0700' }];
    } },
  });
  assert.match(await clinic.engine.handle(body('0*5*Ikeja')), /^CON Flood Clinic/);
  assert.equal(temporaryOnly, true);

  let urgent;
  const request = harness({
    session: { ...base, currentMenu: 'CLIMATE_AREA', state: { inputCount: 2, climateType: 'URGENT_NEED' } },
    care: { requestClimateAssistance: async (_ctx, input) => { urgent = input; } },
  });
  assert.match(await request.engine.handle(body('0*6*Ikeja')), /^END Request received/);
  assert.equal(urgent.requestType, 'URGENT_NEED');
});

test('multi-card households must select a card instead of silently using the first one', async () => {
  const first = harness({ highRisk: { eligibleNfcCards: async () => [
    { id: 'card-1', child: { firstName: 'Musa' } },
    { id: 'card-2', child: { firstName: 'Amina' } },
  ] } });
  const output = await first.engine.handle(body('3'));
  assert.match(output, /^CON Select card/);
  assert.match(output, /1 Musa/);
  assert.match(output, /2 Amina/);

  const second = harness({ session: {
    id: 'session-m', organizationId: 'org-1', caregiverId: 'caregiver-1', locale: 'en',
    currentMenu: 'CARD_SELECT', state: { inputCount: 1, cards: [
      { id: 'card-1', label: '1 Musa' }, { id: 'card-2', label: '2 Amina' },
    ] },
  } });
  assert.match(await second.engine.handle(body('3*2')), /^CON Card help/);
  assert.equal(second.saved().state.cardId, 'card-2');
});

test('authenticated facility details can continue through durable SMS', async () => {
  let queued;
  const session = {
    id: 'session-sms', organizationId: 'org-1', caregiverId: 'caregiver-1', locale: 'yo',
    currentMenu: 'FACILITY_RESULT', state: { inputCount: 2, facility: {
      facilityName: 'Central Clinic', address: '12 Main Road', phone: '0700',
      openingHours: { weekdays: '08:00-17:00' }, programmeCategories: ['VACCINATION'],
    } },
  };
  const h = harness({
    session,
    continuation: { queueFacilityDetails: async (ctx, facility, locale) => {
      queued = { ctx, facility, locale };
    } },
  });
  assert.match(await h.engine.handle(body('4*Ikeja*1')), /^END A o fi alaye/);
  assert.equal(queued.ctx.caregiverId, 'caregiver-1');
  assert.equal(queued.facility.facilityName, 'Central Clinic');
  assert.equal(queued.locale, 'yo');
});
