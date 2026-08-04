const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createLocalizationService,
  normalizeLocale,
  SUPPORTED_LOCALES,
} = require('../services/localizationService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('normalizes the four supported Nigeria-first language choices', () => {
  assert.equal(normalizeLocale('English'), 'en');
  assert.equal(normalizeLocale('Hausa'), 'ha');
  assert.equal(normalizeLocale('Yoruba'), 'yo');
  assert.equal(normalizeLocale('Igbo'), 'ig');
  assert.deepEqual(
    SUPPORTED_LOCALES.map(({ code }) => code),
    ['en', 'ha', 'yo', 'ig']
  );
  assert.throws(
    () => normalizeLocale('unsupported'),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('returns an approved locale catalog with English fallback', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    localizationContent: {
      async findMany() {
        return [
          {
            contentKey: 'navigation.home',
            locale: 'en',
            value: 'Home',
            version: 1,
            approvedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            contentKey: 'navigation.home',
            locale: 'ha',
            value: 'Gida',
            version: 2,
            approvedAt: new Date('2026-02-01T00:00:00.000Z'),
          },
          {
            contentKey: 'navigation.settings',
            locale: 'en',
            value: 'Settings',
            version: 1,
            approvedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ];
      },
    },
  };
  const catalog = await createLocalizationService(
    databaseWithTransaction(tx)
  ).catalog({ organizationId: 'org-1' }, 'ha');

  assert.equal(catalog.messages['navigation.home'], 'Gida');
  assert.equal(catalog.messages['navigation.settings'], 'Settings');
  assert.equal(catalog.versions['navigation.home'].locale, 'ha');
});

test('requires a different administrator to approve translated content', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    localizationContent: {
      async findFirst() {
        return {
          id: 'content-1',
          status: 'DRAFT',
          createdBySubjectId: 'admin-1',
        };
      },
    },
  };
  const service = createLocalizationService(databaseWithTransaction(tx));

  await assert.rejects(
    service.activate({
      organizationId: 'org-1',
      actorSubjectId: 'admin-1',
      purpose: 'localization-administration',
    }, 'content-1'),
    (error) => error.code === 'LOCALIZATION_MAKER_CHECKER_REQUIRED'
  );
});

test('lists tenant localization drafts for the approval workflow', async () => {
  let query;
  const tx = {
    async $executeRawUnsafe() {},
    localizationContent: {
      async findMany(input) {
        query = input;
        return [{ id: 'draft-1', locale: 'ha', status: 'DRAFT' }];
      },
    },
  };
  const result = await createLocalizationService(
    databaseWithTransaction(tx)
  ).listContent({ organizationId: 'org-1' }, { locale: 'ha', status: 'DRAFT' });

  assert.equal(result.items[0].id, 'draft-1');
  assert.deepEqual(query.where, {
    organizationId: 'org-1',
    locale: 'ha',
    status: 'DRAFT',
  });
});
