const { normalizeDisplayName, normalizeNameKey } = require('../../backend/src/shared/utils/nameKey');
const {
  MANAGED_NAME_KEY_INDEX_NAMES,
  TRANSFORMER_NAME_KEY_INDEX_NAME,
  canonicalTransformerName,
  canonicalTransformerNameKey,
  isNameKeyIndex,
} = require('../../backend/src/database/transformerNameKeyMigration');

describe('canonical transformer identity rules', () => {
  it('normalizes the display name to trimmed NFC', () => {
    expect(normalizeDisplayName('  Trafo Kanonik  ')).toBe('Trafo Kanonik');
    expect(normalizeDisplayName('Cafe\u0301 Trafo')).toBe('Caf\u00e9 Trafo');
    expect(canonicalTransformerName('Cafe\u0301 Trafo')).toBe('Caf\u00e9 Trafo');
  });

  it('derives one case-folded key from Unicode-equivalent names', () => {
    expect(normalizeNameKey('Caf\u00e9 Trafo')).toBe('caf\u00e9 trafo');
    expect(normalizeNameKey('Cafe\u0301 Trafo')).toBe('caf\u00e9 trafo');
    expect(normalizeNameKey('  CAF\u00c9 TRAFO ')).toBe('caf\u00e9 trafo');
    expect(canonicalTransformerNameKey('Cafe\u0301 Trafo')).toBe(
      canonicalTransformerNameKey('Caf\u00e9 Trafo'),
    );
  });

  it('uses Unicode full case folding for canonical transformer identity', () => {
    expect(normalizeNameKey('\u039f\u03a3')).toBe(normalizeNameKey('\u03bf\u03c3'));
    expect(normalizeNameKey('\u039f\u03a3')).toBe(normalizeNameKey('\u03bf\u03c2'));
    expect(normalizeNameKey('Stra\u00dfe')).toBe(normalizeNameKey('strasse'));
    expect(normalizeNameKey('Stra\u00dfe')).toBe(normalizeNameKey('STRASSE'));
    expect(normalizeNameKey('Tra\u017fo')).toBe(normalizeNameKey('TRA\u017fO'));

    // Case folding changes only the identity key; the operator-visible name
    // keeps its canonical NFC spelling.
    expect(normalizeDisplayName('\u03bf\u03c2')).toBe('\u03bf\u03c2');
  });

  it('treats an empty or missing name as an empty key', () => {
    expect(normalizeNameKey(null)).toBe('');
    expect(normalizeNameKey(undefined)).toBe('');
    expect(normalizeNameKey('   ')).toBe('');
  });
});

describe('transformer nameKey index classification', () => {
  it('recognises only single-field ascending nameKey indexes', () => {
    expect(isNameKeyIndex({ name: 'transformer_name_key_unique', key: { nameKey: 1 } })).toBe(true);
    expect(isNameKeyIndex({ name: 'other', key: { nameKey: -1 } })).toBe(false);
    expect(isNameKeyIndex({ name: 'other', key: { nameKey: 1, feeder: 1 } })).toBe(false);
    expect(isNameKeyIndex({ name: 'feeder_1', key: { feeder: 1 } })).toBe(false);
    expect(isNameKeyIndex({ name: 'location_2dsphere', key: { location: '2dsphere' } })).toBe(false);
    expect(isNameKeyIndex(null)).toBe(false);
  });

  it('only manages the canonical index and the legacy default nameKey index', () => {
    expect(MANAGED_NAME_KEY_INDEX_NAMES).toContain(TRANSFORMER_NAME_KEY_INDEX_NAME);
    expect(MANAGED_NAME_KEY_INDEX_NAMES).toContain('nameKey_1');
    expect(MANAGED_NAME_KEY_INDEX_NAMES).not.toContain('feeder_1');
    expect(MANAGED_NAME_KEY_INDEX_NAMES).not.toContain('location_2dsphere');
  });
});
