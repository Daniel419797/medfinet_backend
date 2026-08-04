const { DomainError } = require('../../utils/domainError');
const { requiredText } = require('../identityService');

const MAX_TEXT_LENGTH = 500;

const INTENTS = Object.freeze([
  'APPOINTMENT',
  'VACCINATION',
  'CARD_HELP',
  'CLINIC',
  'CALLBACK',
  'CONSENT',
  'PROGRAMME',
  'DELIVERY',
  'REWARDS',
  'EMERGENCY',
  'CLIMATE',
  'LANGUAGE',
  'OTHER',
]);

const KEYWORDS = Object.freeze({
  EMERGENCY: ['emergency', 'urgent', 'accident', 'bleed', 'unconscious', 'danger', 'seizure', 'convulsion', 'can\'t breathe', 'not breathing', 'gaggawa', 'mawuyacin'],
  CLIMATE: ['flood', 'outbreak', 'cholera', 'evacuat', 'storm', 'heat', 'drought', 'ambaliya', 'gudun hijira', 'annoba'],
  VACCINATION: ['vaccin', 'immuni', 'shot', 'needle', 'polio', 'penta', 'bcg', 'measles', 'rigakaf', 'allurar', 'injection'],
  APPOINTMENT: ['appointment', 'appoint', 'clinic visit', 'follow-up', 'follow up', 'check-up', 'checkup', 'see the doctor', 'alaka', 'neman alaka'],
  CARD_HELP: ['card', 'nfc', 'lost', 'replacement', 'replace', 'kati', 'katin'],
  CALLBACK: ['callback', 'call me', 'call back', 'phone call', 'kirani', 'a kira ni'],
  CONSENT: ['consent', 'approve', 'share', 'access my', 'permission', 'yarda', 'amince'],
  PROGRAMME: ['programme', 'enroll', 'enrol', 'register', 'nutrition', 'outreach', 'shirin', 'neman shiga'],
  DELIVERY: ['delivery', 'received', 'receive', 'supplement', 'food', 'formula', 'sabis', 'karba'],
  REWARDS: ['reward', 'points', 'redemption', 'redeem', 'wallet', 'lada', 'maki', 'fansa'],
  LANGUAGE: ['language', 'english', 'hausa', 'yoruba', 'igbo', 'translate', 'harshe', 'yare'],
  CLINIC: [
    'clinic', 'hospital', 'facility', 'centre', 'center', 'where is', 'address',
    'asibiti', 'find clinic', 'fever', 'diarrhea', 'diarrhoea', 'vomiting',
    'vomit', 'rash', 'cough', 'malaria', 'sick', 'ill', 'headache', 'pain',
    'weak', 'appetite', 'ciwo', 'zazzabi', 'kududdufi',
  ],
});

function normalizeIntake(input) {
  const text = requiredText(input.text, 'text', MAX_TEXT_LENGTH);
  const locale = input.locale === 'ha' || input.locale === 'yo' || input.locale === 'ig'
    ? input.locale
    : 'en';
  return { text, locale };
}

function keywordIntent(text) {
  const lower = text.toLowerCase();
  const scores = Object.entries(KEYWORDS).map(([intent, keywords]) => ({
    intent,
    score: keywords.reduce(
      (total, keyword) => total + (lower.includes(keyword) ? 1 : 0),
      0
    ),
  }));
  const best = scores.sort((left, right) => right.score - left.score)[0];
  if (!best || best.score === 0) return 'OTHER';
  if (best.intent === 'EMERGENCY' || best.intent === 'CLIMATE') return best.intent;
  const ties = scores.filter((entry) => entry.score === best.score);
  if (ties.length > 1) {
    if (ties.some((entry) => entry.intent === 'VACCINATION')) return 'VACCINATION';
    if (ties.some((entry) => entry.intent === 'APPOINTMENT')) return 'APPOINTMENT';
  }
  return best.intent;
}

function rulesIntake(text, locale) {
  const intent = keywordIntent(text);
  return {
    intent,
    urgent: intent === 'EMERGENCY',
    summary: text.slice(0, 120),
    locale,
  };
}

function createUssdIntakeService(options = {}) {
  const ai = options.ai || (() => {
    const config = require('../../config');
    const { createAiClient } = require('./aiClient');
    return config.ai.enabled ? createAiClient(config.ai) : createAiClient({ provider: 'disabled' });
  })();

  async function parse(context, input) {
    const normalized = normalizeIntake(input);
    if (!ai.enabled) {
      return { ...rulesIntake(normalized.text, normalized.locale), source: 'rules', model: null };
    }
    const fallback = () => rulesIntake(normalized.text, normalized.locale);
    const { value: parsed, fellBack } = await ai.completeJson({
      system: [
        'You are a triage assistant for a rural health SMS/USSD service (Medfinet).',
        'Classify the caregiver message into exactly one of these intents:',
        INTENTS.join(', '),
        'Choose EMERGENCY only for immediate life-threatening danger.',
        'Return a very short summary of what the caregiver needs (under 20 words).',
      ].join('\n'),
      user: `Caregiver message (${normalized.locale}): ${normalized.text}`,
      schema: { intent: 'string', urgent: 'boolean', summary: 'string' },
      fallback,
      maxTokens: 120,
    });
    const intent = INTENTS.includes(parsed.intent) ? parsed.intent : 'OTHER';
    return {
      intent,
      urgent: parsed.urgent === true,
      summary: parsed.summary || normalized.text.slice(0, 120),
      locale: normalized.locale,
      source: fellBack ? 'rules' : 'ai',
      model: fellBack ? null : ai.model,
    };
  }

  return { parse };
}

module.exports = {
  createUssdIntakeService,
  keywordIntent,
  rulesIntake,
  normalizeIntake,
  INTENTS,
  KEYWORDS,
};