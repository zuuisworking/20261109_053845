const { parseCapacityKva } = require('../../backend/src/shared/utils/capacityParser');

describe('parseCapacityKva', () => {
  it('parses one positive kVA value and an optional kVA suffix', () => {
    expect(parseCapacityKva('100 kVA')).toMatchObject({ value: 100, error: null });
    expect(parseCapacityKva('160')).toMatchObject({ value: 160, error: null });
    expect(parseCapacityKva('100,5 kVA')).toMatchObject({ value: 100.5, error: null });
  });

  it('treats dotted thousands as Indonesian thousands', () => {
    expect(parseCapacityKva('1.300 kVA')).toMatchObject({ value: 1300, error: null });
  });

  it('keeps a multi-valued label ambiguous without inventing a numeric value', () => {
    const result = parseCapacityKva('500/300/865');

    expect(result.value).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.code).toBe('AMBIGUOUS_CAPACITY');
    expect(result.error).toMatch(/persetujuan operator/i);
  });

  it('rejects malformed, zero, and negative values', () => {
    expect(parseCapacityKva('not-a-capacity').error).toMatch(/satu angka kVA/i);
    expect(parseCapacityKva('0 kVA').error).toMatch(/lebih besar dari 0/i);
    expect(parseCapacityKva('-100 kVA').error).toMatch(/lebih besar dari 0/i);
  });

  it('represents a missing value as null without an error', () => {
    expect(parseCapacityKva(null)).toEqual({
      value: null,
      error: null,
      code: null,
      ambiguous: false,
    });
    expect(parseCapacityKva('   ')).toEqual({
      value: null,
      error: null,
      code: null,
      ambiguous: false,
    });
  });
});
