const { DomainError } = require('../../utils/domainError');
const { requiredText } = require('../identityService');

const MAX_FIELDS = 60;

function normalizeFieldList(values, field) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_FIELDS) {
    throw new DomainError(400, 'VALIDATION_ERROR', `${field} must contain between 1 and ${MAX_FIELDS} fields`);
  }
  return values.map((value) => requiredText(value, field, 160));
}

const CANONICAL_ALIASES = Object.freeze({
  dob: 'dateofbirth',
  birthdate: 'dateofbirth',
  firstname: 'givenname',
  lastname: 'familyname',
  sex: 'gender',
  vaccinename: 'vaccinecode',
});

function normalizeKey(value) {
  const key = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return CANONICAL_ALIASES[key] || key;
}

function similarity(left, right) {
  const a = normalizeKey(left);
  const b = normalizeKey(right);
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.75;
  return 0;
}

function rulesCorrespondences(sourceFields, targetFields) {
  const correspondences = [];
  const usedTargets = new Set();
  for (const sourceField of sourceFields) {
    const candidates = targetFields
      .map((targetField) => ({
        targetField,
        score: similarity(sourceField, targetField),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (best && !usedTargets.has(best.targetField)) {
      usedTargets.add(best.targetField);
      correspondences.push({
        sourceField,
        targetField: best.targetField,
        confidence: best.score,
        notes: best.score === 1 ? 'exact field name match' : 'similar field name match',
      });
    }
  }
  return correspondences;
}

function createMappingAssistService(options = {}) {
  const ai = options.ai || (() => {
    const config = require('../../config');
    const { createAiClient } = require('./aiClient');
    return config.ai.enabled ? createAiClient(config.ai) : createAiClient({ provider: 'disabled' });
  })();

  async function suggest(input) {
    const connectionType = requiredText(input.connectionType, 'connectionType', 30).toUpperCase();
    if (!['FHIR_R4', 'DHIS2'].includes(connectionType)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'connectionType must be FHIR_R4 or DHIS2');
    }
    const resourceType = requiredText(input.resourceType, 'resourceType', 60);
    const sourceFields = normalizeFieldList(input.sourceFields, 'sourceFields');
    const targetFields = normalizeFieldList(input.targetFields, 'targetFields');
    const fallback = () => ({ correspondences: rulesCorrespondences(sourceFields, targetFields) });

    if (!ai.enabled) {
      return {
        source: 'rules',
        model: null,
        connectionType,
        resourceType,
        correspondences: rulesCorrespondences(sourceFields, targetFields),
      };
    }

    const { value: parsed, fellBack } = await ai.completeJson({
      system: [
        'You are an interoperability specialist for a health data platform (Medfinet).',
        `Suggest field mappings from source fields to ${connectionType} ${resourceType} target fields.`,
        'Only map fields where the meaning clearly matches. Do not invent target fields.',
        'Confidence must be 0..1. Notes must be one short phrase.',
        'Return correspondences only for fields you are confident about.',
      ].join('\n'),
      user: `Source fields: ${JSON.stringify(sourceFields)}\nTarget fields: ${JSON.stringify(targetFields)}`,
      schema: {
        correspondences: [{
          sourceField: 'string',
          targetField: 'string',
          confidence: 'number',
          notes: 'string',
        }],
      },
      fallback,
      maxTokens: 400,
    });

    const targetSet = new Set(targetFields);
    const sourceSet = new Set(sourceFields);
    const correspondences = (parsed.correspondences || [])
      .filter((entry) => (
        sourceSet.has(entry.sourceField)
        && targetSet.has(entry.targetField)
        && typeof entry.confidence === 'number'
      ))
      .map((entry) => ({
        sourceField: entry.sourceField,
        targetField: entry.targetField,
        confidence: Math.min(1, Math.max(0, entry.confidence)),
        notes: entry.notes || null,
      }));
    return {
      source: fellBack ? 'rules' : 'ai',
      model: fellBack ? null : ai.model,
      connectionType,
      resourceType,
      correspondences,
    };
  }

  return { suggest };
}

module.exports = {
  createMappingAssistService,
  rulesCorrespondences,
  similarity,
  normalizeKey,
};