const { DomainError } = require('../utils/domainError');
const { createAfricasTalkingAdapter } = require('./ussdProviderAdapter');
const { createUssdSessionService } = require('./ussdSessionService');
const { createUssdIdentityService } = require('./ussdIdentityService');
const { createUssdCareWorkflowService } = require('./ussdCareWorkflowService');
const { createUssdHighRiskWorkflowService } = require('./ussdHighRiskWorkflowService');
const { createUssdFacilityService } = require('./ussdFacilityService');
const { createUssdOtpService } = require('./ussdOtpService');
const { createUssdOtpDeliveryService } = require('./ussdOtpDeliveryService');
const { createUssdContinuationService } = require('./ussdContinuationService');
const { message, SUPPORTED_USSD_LOCALES } = require('./ussdMessages');

const DATE_LOCALES = { en: 'en-NG', ha: 'ha-NG', yo: 'yo-NG', ig: 'ig-NG' };

function dateText(value, locale = 'en') {
  return new Intl.DateTimeFormat(DATE_LOCALES[locale] || DATE_LOCALES.en, {
    day: 'numeric', month: 'short', year: 'numeric',
  })
    .format(new Date(value));
}

function compactJson(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.slice(0, 3).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value).slice(0, 2).map(([key, item]) => `${key}: ${item}`).join(', ');
  }
  return String(value);
}

function response(messageText, menu, state, continueSession = true, extra = {}) {
  return { message: messageText, menu, state, continueSession, ...extra };
}

function context(session) {
  return {
    sessionId: session.id,
    organizationId: session.organizationId,
    caregiverId: session.caregiverId,
  };
}

function createUssdEngine(prismaClient, options = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const config = options.config || require('../config');
  const adapter = options.adapter || createAfricasTalkingAdapter(config.ussd);
  const identity = options.identity || createUssdIdentityService(database, { config: config.ussd });
  const sessions = options.sessions || createUssdSessionService(database, { config: config.ussd });
  const care = options.care || createUssdCareWorkflowService(database);
  const highRisk = options.highRisk || createUssdHighRiskWorkflowService(database);
  const facilities = options.facilities || createUssdFacilityService(database);
  const continuation = options.continuation || createUssdContinuationService(database);
  const otp = options.otp || createUssdOtpService(database, {
    config: config.ussd,
    deliver: options.deliverOtp || createUssdOtpDeliveryService({
      config: config.notifications,
      smsConfig: config.sms,
    }),
  });

  async function beginOtp(session, state, purpose, action) {
    const issued = await otp.issue(context(session), purpose, action);
    return response(
      message(session.locale, 'otp'),
      'OTP',
      { ...state, otp: { challengeId: issued.challengeId, purpose, action } }
    );
  }

  async function executeOtpAction(session, state) {
    const pending = state.otp.action;
    if (pending.type === 'CARD') {
      await highRisk.requestCardSupport(context(session), pending.id, pending.requestType);
    } else if (pending.type === 'CONSENT') {
      await highRisk.decideConsent(context(session), pending.id, pending.decision);
    } else if (pending.type === 'REWARD') {
      await highRisk.confirmRewardReservation(context(session), pending.id, pending.decision);
    }
    return response(message(session.locale, 'done'), 'DONE', state, false);
  }

  async function routeRoot(session, choice, state) {
    const ctx = context(session);
    if (choice === '1') {
      const item = await care.nextAppointment(ctx);
      if (!item) return response(message(session.locale, 'none'), 'DONE', state, false);
      return response(message(session.locale, 'appointment', {
        date: dateText(item.scheduledFor, session.locale), facility: item.facility.name,
      }), 'APPOINTMENT', { ...state, item });
    }
    if (choice === '2') {
      const item = await care.nextAppointment(ctx, { vaccinationOnly: true });
      if (!item) return response(message(session.locale, 'none'), 'DONE', state, false);
      return response(message(session.locale, 'vaccination', {
        date: dateText(item.scheduledFor, session.locale), facility: item.facility.name,
      }), 'VACCINATION', { ...state, item });
    }
    if (choice === '3') {
      const cards = await highRisk.eligibleNfcCards(ctx);
      if (!cards.length) return response(message(session.locale, 'none'), 'DONE', state, false);
      const safeCards = cards.map((card, index) => ({
        id: card.id,
        label: `${index + 1} ${String(card.child?.firstName || `Card ${index + 1}`).slice(0, 30)}`,
      }));
      if (safeCards.length > 1) {
        return response(message(session.locale, 'cardSelect', {
          items: safeCards.map((card) => card.label).join('\n'),
        }), 'CARD_SELECT', { ...state, cards: safeCards });
      }
      return response(message(session.locale, 'cardMenu'), 'CARD', {
        ...state, cardId: safeCards[0].id,
      });
    }
    if (choice === '4') return response(message(session.locale, 'area'), 'FACILITY_AREA', state);
    if (choice === '5') return response(message(session.locale, 'callback'), 'CALLBACK', state);
    if (choice === '6') {
      const item = await highRisk.pendingConsent(ctx);
      if (!item) return response(message(session.locale, 'none'), 'DONE', state, false);
      return response(message(session.locale, 'consent', {
        recipient: item.recipientDisplayName, purpose: item.purpose,
      }), 'CONSENT', { ...state, item });
    }
    if (choice === '7') return response(message(session.locale, 'programme'), 'PROGRAMME', state);
    if (choice === '8') {
      const item = await care.latestUnconfirmedDelivery(ctx);
      if (!item) return response(message(session.locale, 'none'), 'DONE', state, false);
      return response(message(session.locale, 'delivery', item), 'DELIVERY', { ...state, item });
    }
    if (choice === '9') {
      const balance = await highRisk.rewardBalance(ctx);
      const available = balance.balance - balance.reservedBalance;
      return response(message(session.locale, 'rewards', { points: available }), 'REWARDS_MENU', {
        ...state, available: available.toString(),
      });
    }
    if (choice === '0') return response(message(session.locale, 'climate'), 'CLIMATE', state);
    if (choice === '99') return response(message(session.locale, 'language'), 'LANGUAGE', state);
    return response(message(session.locale, 'invalid'), 'ROOT', state);
  }

  async function advance(session, input) {
    const state = { ...(session.state || {}) };
    const menu = session.currentMenu;
    const ctx = context(session);
    if (menu === 'UNREGISTERED') {
      if (!input) return response(message(session.locale, 'unregistered'), menu, state);
      return input === '1' ? response(message(session.locale, 'area'), 'PUBLIC_FACILITY_AREA', state)
        : response(message(session.locale, 'invalid'), menu, state);
    }
    if (menu === 'SELECT_ORG') {
      const routes = state.routes || [];
      if (!input) {
        const names = await Promise.all(routes.map((route) => database.organization.findUnique({ where: { id: route.organizationId }, select: { name: true } })));
        return response(message(session.locale, 'selectAccount', {
          items: names.map((item, index) => (
            `${index + 1} ${item?.name || message(session.locale, 'provider')}`
          )).join('\n'),
        }), menu, state);
      }
      const selected = routes[Number(input) - 1];
      if (!selected) return response(message(session.locale, 'invalid'), menu, state);
      Object.assign(session, selected, { assurance: 'PHONE' });
      return response(message(session.locale, 'pin'), 'PIN', state, true, selected);
    }
    if (menu === 'PIN') {
      if (!input) return response(message(session.locale, 'pin'), menu, state);
      await identity.verifySessionPin(session, input);
      session.assurance = 'PIN';
      return response(`${message(session.locale, 'root')}\n99 Language`, 'ROOT', state);
    }
    if (menu === 'ROOT') return input ? routeRoot(session, input, state) : response(`${message(session.locale, 'root')}\n99 Language`, menu, state);
    if (menu === 'LANGUAGE') {
      const locale = SUPPORTED_USSD_LOCALES[Number(input) - 1];
      return locale ? response(`${message(locale, 'root')}\n99 Language`, 'ROOT', state, true, { locale })
        : response(message(session.locale, 'invalid'), menu, state);
    }
    if (menu === 'APPOINTMENT') {
      if (input === '1') await care.respondToAppointment(ctx, state.item.id, { decision: 'CONFIRMED' });
      else if (input === '2') return response(message(session.locale, 'preferredDate'), 'APPOINTMENT_DATE', state);
      else if (input === '3') {
        const facility = state.item.facility;
        const summary = message(session.locale, 'location', {
          facility: facility.name,
          address: facility.address || message(session.locale, 'addressUnavailable'),
          phone: facility.phone || '',
          hours: compactJson(facility.openingHours),
        }).slice(0, 122);
        return response(`${summary}\n${message(session.locale, 'smsOption')}`, 'FACILITY_RESULT', {
          ...state, facility: { ...facility, facilityName: facility.name },
        });
      }
      else return response(message(session.locale, 'invalid'), menu, state);
      return response(message(session.locale, 'appointmentConfirmed'), 'DONE', state, false);
    }
    if (menu === 'APPOINTMENT_DATE') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return response(message(session.locale, 'dateFormat'), menu, state);
      const start = new Date(`${input}T08:00:00+01:00`);
      const end = new Date(`${input}T17:00:00+01:00`);
      await care.respondToAppointment(ctx, state.item.id, { decision: 'RESCHEDULE_REQUESTED', preferredStart: start, preferredEnd: end });
      return response(message(session.locale, 'done'), 'DONE', state, false);
    }
    if (menu === 'VACCINATION') {
      if (input === '1') await care.respondToAppointment(ctx, state.item.id, { decision: 'CONFIRMED' });
      else if (input === '2') await care.requestCallback(ctx, 'VACCINATION', state.item.childId);
      else return response(message(session.locale, 'invalid'), menu, state);
      return response(message(session.locale, 'done'), 'DONE', state, false);
    }
    if (menu === 'CARD') {
      const types = { 1: ['LOST_CARD_SUSPENSION', 'CARD_SUSPENSION'], 2: ['REPLACEMENT_REQUEST', 'CARD_REPLACEMENT'] };
      const selected = types[input];
      if (!selected) return response(message(session.locale, 'invalid'), menu, state);
      const action = { type: 'CARD', id: state.cardId, requestType: selected[0] };
      return beginOtp(session, state, selected[1], action);
    }
    if (menu === 'CARD_SELECT') {
      const card = state.cards?.[Number(input) - 1];
      if (!card) return response(message(session.locale, 'invalid'), menu, state);
      return response(message(session.locale, 'cardMenu'), 'CARD', { ...state, cardId: card.id });
    }
    if (menu === 'FACILITY_AREA' || menu === 'PUBLIC_FACILITY_AREA') {
      const found = await facilities.search(input);
      if (!found.length) return response(message(session.locale, 'none'), 'DONE', state, false);
      const lines = found.slice(0, 2).map((f) => {
        const hours = compactJson(f.openingHours);
        const programmes = compactJson(f.programmeCategories);
        return [
          f.facilityName,
          f.address || f.administrativeArea,
          f.phone || message(session.locale, 'phoneUnavailable'),
          hours,
          programmes,
        ].filter(Boolean).join(', ');
      });
      if (menu === 'PUBLIC_FACILITY_AREA') {
        return response(lines.join('\n'), 'DONE', state, false);
      }
      return response(`${lines[0].slice(0, 122)}\n${message(session.locale, 'smsOption')}`, 'FACILITY_RESULT', {
        ...state, facility: found[0],
      });
    }
    if (menu === 'FACILITY_RESULT') {
      if (input !== '1') return response(message(session.locale, 'invalid'), menu, state);
      await continuation.queueFacilityDetails(ctx, state.facility, session.locale);
      return response(message(session.locale, 'smsQueued'), 'DONE', state, false);
    }
    if (menu === 'CALLBACK') {
      const categories = ['VACCINATION', 'NUTRITION', 'EMERGENCY', 'CARD_PROBLEM', 'GENERAL'];
      if (!categories[Number(input) - 1]) return response(message(session.locale, 'invalid'), menu, state);
      await care.requestCallback(ctx, categories[Number(input) - 1]);
      return response(message(session.locale, 'done'), 'DONE', state, false);
    }
    if (menu === 'CONSENT') {
      const decision = input === '1' ? 'APPROVE' : input === '2' ? 'DECLINE' : null;
      if (!decision) return response(message(session.locale, 'invalid'), menu, state);
      return beginOtp(session, state, 'CONSENT_DECISION', { type: 'CONSENT', id: state.item.id, decision });
    }
    if (menu === 'PROGRAMME') {
      const categories = ['VACCINATION', 'NUTRITION', 'CLIMATE_EMERGENCY', 'COMMUNITY_OUTREACH'];
      const category = categories[Number(input) - 1];
      if (!category) return response(message(session.locale, 'invalid'), menu, state);
      await care.registerProgrammeInterest(ctx, { category });
      return response(message(session.locale, 'done'), 'DONE', state, false);
    }
    if (menu === 'DELIVERY') {
      const decisions = ['CONFIRMED', 'NOT_RECEIVED', 'DISPUTED'];
      const decision = decisions[Number(input) - 1];
      if (!decision) return response(message(session.locale, 'invalid'), menu, state);
      await care.confirmDelivery(ctx, state.item.id, decision);
      return response(message(session.locale, 'done'), 'DONE', state, false);
    }
    if (menu === 'REWARDS_MENU') {
      if (input === '1') {
        const items = await highRisk.eligibleRewardItems(ctx);
        if (!items.length) return response(message(session.locale, 'none'), 'DONE', state, false);
        const labels = items.slice(0, 3).map((item) => {
          const categories = compactJson(item.eligibleCategories);
          return `${item.name}${categories ? `: ${categories}` : ''}`;
        });
        return response(message(session.locale, 'eligible', { items: labels.join('\n') }), 'DONE', state, false);
      }
      if (input === '2') {
        const item = await highRisk.pendingRewardReservation(ctx);
        if (!item) return response(message(session.locale, 'noRedemption'), 'DONE', state, false);
        const safeItem = { ...item, amount: item.amount.toString() };
        return response(message(session.locale, 'redemption', {
          amount: safeItem.amount, merchant: item.merchant.name,
        }), 'REWARD', { ...state, item: safeItem });
      }
      if (input === '3') {
        await care.requestCallback(ctx, 'REWARDS');
        return response(message(session.locale, 'done'), 'DONE', state, false);
      }
      return response(message(session.locale, 'invalid'), menu, state);
    }
    if (menu === 'REWARD') {
      const decisions = ['CONFIRMED', 'DECLINED', 'DISPUTED'];
      const decision = decisions[Number(input) - 1];
      if (!decision) return response(message(session.locale, 'invalid'), menu, state);
      return beginOtp(session, state, 'REWARD_REDEMPTION', { type: 'REWARD', id: state.item.id, decision });
    }
    if (menu === 'CLIMATE') {
      if (input === '1') {
        return response(message(session.locale, 'area'), 'CLIMATE_CHECK_AREA', state);
      }
      if (input === '5') {
        return response(message(session.locale, 'temporaryArea'), 'TEMPORARY_FACILITY_AREA', state);
      }
      const types = { 2: 'EVACUATION', 3: 'HEALTH_SUPPORT', 4: 'HOUSEHOLD_SAFETY', 6: 'URGENT_NEED' };
      if (!types[input]) return response(message(session.locale, 'invalid'), menu, state);
      return response(message(session.locale, 'area'), 'CLIMATE_AREA', {
        ...state, climateType: types[input],
      });
    }
    if (menu === 'CLIMATE_CHECK_AREA') {
      const notice = await care.activeClimateNotice(ctx, input);
      return notice
        ? response(message(session.locale, 'climateAlert', {
          type: notice.eventType, name: notice.name, severity: notice.severity,
        }), 'DONE', state, false)
        : response(message(session.locale, 'noClimateAlert'), 'DONE', state, false);
    }
    if (menu === 'TEMPORARY_FACILITY_AREA') {
      const found = await facilities.search(input, { temporaryOnly: true });
      if (!found.length) return response(message(session.locale, 'none'), 'DONE', state, false);
      const facility = found[0];
      const summary = [
        facility.facilityName,
        facility.address || facility.administrativeArea,
        facility.phone || message(session.locale, 'phoneUnavailable'),
        compactJson(facility.openingHours),
      ].filter(Boolean).join(', ').slice(0, 122);
      return response(`${summary}\n${message(session.locale, 'smsOption')}`, 'FACILITY_RESULT', {
        ...state, facility,
      });
    }
    if (menu === 'CLIMATE_AREA') {
      await care.requestClimateAssistance(ctx, { administrativeAreaCode: input, requestType: state.climateType, householdSafe: state.climateType === 'HOUSEHOLD_SAFETY' });
      return response(message(session.locale, 'done'), 'DONE', state, false);
    }
    if (menu === 'OTP') {
      await otp.verify(ctx, state.otp.challengeId, state.otp.purpose, state.otp.action, input);
      await database.ussdSession.update({
        where: { id: session.id },
        data: { assurance: 'OTP', otpVerifiedAt: new Date() },
      });
      return executeOtpAction(session, state);
    }
    throw new DomainError(409, 'USSD_MENU_INVALID', 'The session cannot continue');
  }

  async function handle(body) {
    const request = adapter.parse(body);
    const opened = await sessions.open(request, identity);
    if (opened.replay) return opened.replay;
    const session = opened.session;
    const state = session.state || {};
    const expected = Number(state.inputCount || 0);
    if (request.inputs.length > expected + 1) throw new DomainError(409, 'USSD_INPUT_SEQUENCE_INVALID', 'Input sequence is invalid');
    const input = request.inputs.length > expected ? request.inputs[expected] : '';
    const result = await advance(session, input);
    result.state = { ...(result.state || state), inputCount: request.inputs.length };
    const formatted = adapter.format(result);
    result.formatted = formatted;
    await sessions.save(session, request, result);
    return formatted;
  }

  return { handle };
}

module.exports = { createUssdEngine };
