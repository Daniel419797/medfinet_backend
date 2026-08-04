const DEFAULT_IN_APP_TEMPLATES = [
  {
    key: 'REWARD_GRANTED',
    body: 'You received {{credits}} credits from {{campaignName}}.',
    variableNames: ['credits', 'campaignName'],
  },
  {
    key: 'REWARD_REDEEMED',
    body: '{{credits}} credits were redeemed at {{merchantName}} for {{category}}.',
    variableNames: ['credits', 'merchantName', 'category'],
  },
  {
    key: 'SETTLEMENT_PAID',
    body: 'A settlement of {{credits}} credits was paid to {{merchantName}}.',
    variableNames: ['credits', 'merchantName'],
  },
  {
    key: 'APPOINTMENT_SCHEDULED',
    body: 'A {{appointmentKind}} appointment is scheduled for {{scheduledFor}} at {{facilityName}}.',
    variableNames: ['appointmentKind', 'scheduledFor', 'facilityName'],
  },
  {
    key: 'APPOINTMENT_STATUS_CHANGED',
    body: 'Your {{appointmentKind}} appointment for {{scheduledFor}} is now {{status}}.',
    variableNames: ['appointmentKind', 'scheduledFor', 'status'],
  },
  {
    key: 'REFERRAL_OPENED',
    body: 'A {{priority}} priority {{referralType}} referral was opened for {{destination}}.',
    variableNames: ['priority', 'referralType', 'destination'],
  },
  {
    key: 'REFERRAL_STATUS_CHANGED',
    body: 'Your {{referralType}} referral is now {{status}}.',
    variableNames: ['referralType', 'status'],
  },
  {
    key: 'EMERGENCY_ACCESS_ACTIVATED',
    body: 'Emergency record access was activated for {{reasonCode}} and expires at {{expiresAt}}.',
    variableNames: ['reasonCode', 'expiresAt'],
  },
  {
    key: 'VACCINE_DUE',
    body: '{{childName}} is due for {{vaccineCode}} dose {{doseNumber}}. Due by {{dueAt}}. Visit {{facilityName}} to complete.',
    variableNames: ['childName', 'vaccineCode', 'doseNumber', 'dueAt', 'facilityName'],
  },
];

const DEFAULT_SMS_TEMPLATES = [
  {
    key: 'APPOINTMENT_SCHEDULED',
    body: 'Medfinet: {{appointmentKind}} appointment on {{scheduledFor}} at {{facilityName}}.',
    variableNames: ['appointmentKind', 'scheduledFor', 'facilityName'],
  },
  {
    key: 'APPOINTMENT_STATUS_CHANGED',
    body: 'Medfinet: Your {{appointmentKind}} appointment for {{scheduledFor}} is now {{status}}.',
    variableNames: ['appointmentKind', 'scheduledFor', 'status'],
  },
  {
    key: 'REFERRAL_OPENED',
    body: 'Medfinet: {{priority}} priority {{referralType}} referral opened for {{destination}}.',
    variableNames: ['priority', 'referralType', 'destination'],
  },
  {
    key: 'REFERRAL_STATUS_CHANGED',
    body: 'Medfinet: Your {{referralType}} referral is now {{status}}.',
    variableNames: ['referralType', 'status'],
  },
  {
    key: 'EMERGENCY_ACCESS_ACTIVATED',
    body: 'Medfinet: Emergency record access activated for {{reasonCode}}. Expires {{expiresAt}}.',
    variableNames: ['reasonCode', 'expiresAt'],
  },
  {
    key: 'REWARD_GRANTED',
    body: 'Medfinet: You received {{credits}} credits from {{campaignName}}.',
    variableNames: ['credits', 'campaignName'],
  },
  {
    key: 'REWARD_REDEEMED',
    body: 'Medfinet: {{credits}} credits redeemed at {{merchantName}} for {{category}}.',
    variableNames: ['credits', 'merchantName', 'category'],
  },
  {
    key: 'SETTLEMENT_PAID',
    body: 'Medfinet: Settlement of {{credits}} credits paid to {{merchantName}}.',
    variableNames: ['credits', 'merchantName'],
  },
  {
    key: 'VACCINE_DUE',
    body: 'Medfinet: {{childName}} is due for {{vaccineCode}} dose {{doseNumber}} by {{dueAt}}. Visit {{facilityName}}.',
    variableNames: ['childName', 'vaccineCode', 'doseNumber', 'dueAt', 'facilityName'],
  },
];

const USSD_LOCATION_BODIES = {
  en: '{{facilityName}}. Address: {{address}}. Phone: {{phone}}. Hours: {{openingHours}}. Programmes: {{programmes}}.',
  ha: '{{facilityName}}. Adireshi: {{address}}. Waya: {{phone}}. Lokaci: {{openingHours}}. Shirye-shirye: {{programmes}}.',
  yo: '{{facilityName}}. Adiresi: {{address}}. Foonu: {{phone}}. Akoko: {{openingHours}}. Eto: {{programmes}}.',
  ig: '{{facilityName}}. Adreesị: {{address}}. Ekwentị: {{phone}}. Oge: {{openingHours}}. Mmemme: {{programmes}}.',
};

const DEFAULT_USSD_SMS_TEMPLATES = Object.entries(USSD_LOCATION_BODIES).map(([locale, body]) => ({
  key: 'USSD_FACILITY_DETAILS',
  locale,
  channel: 'SMS',
  body,
  variableNames: ['facilityName', 'address', 'phone', 'openingHours', 'programmes'],
}));

function defaultNotificationTemplates(organizationId, actorSubjectId, activatedAt) {
  const templates = [
    ...DEFAULT_IN_APP_TEMPLATES.map((template) => ({ ...template, locale: 'en', channel: 'IN_APP' })),
    ...DEFAULT_SMS_TEMPLATES.map((template) => ({ ...template, locale: 'en', channel: 'SMS' })),
    ...DEFAULT_USSD_SMS_TEMPLATES,
  ];
  return templates.map((template) => ({
    organizationId,
    key: template.key,
    version: 1,
    locale: template.locale,
    channel: template.channel,
    status: 'ACTIVE',
    subject: null,
    body: template.body,
    variableNames: template.variableNames,
    createdBySubjectId: actorSubjectId,
    activatedBySubjectId: actorSubjectId,
    activatedAt,
  }));
}

module.exports = {
  DEFAULT_IN_APP_TEMPLATES,
  DEFAULT_SMS_TEMPLATES,
  DEFAULT_USSD_SMS_TEMPLATES,
  defaultNotificationTemplates,
};
