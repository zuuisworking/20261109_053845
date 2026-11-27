const customerService = require('../../backend/src/modules/customers/customerService');

describe('customer power normalization', () => {
  it('keeps Indonesian dotted thousands values as integer VA', () => {
    expect(customerService.parsePowerVa('1.300')).toEqual({ raw: '1.300', value: 1300 });
    expect(customerService.parsePowerVa('900')).toEqual({ raw: '900', value: 900 });
    expect(customerService.parsePowerVa('2.000.000')).toEqual({
      raw: '2.000.000',
      value: 2000000,
    });
  });

  it('accepts an explicit VA suffix without changing the canonical value', () => {
    expect(customerService.parsePowerVa('1.300 VA')).toEqual({
      raw: '1.300 VA',
      value: 1300,
    });
  });

  it('rejects fractional or non-numeric power values', () => {
    expect(() => customerService.parsePowerVa('1,3')).toThrow('Daya');
    expect(() => customerService.parsePowerVa('1.3')).toThrow('Daya');
    expect(() => customerService.parsePowerVa('unknown')).toThrow('Daya');
  });

  it('does not invent a value when power is absent', () => {
    expect(customerService.parsePowerVa(null)).toEqual({ raw: null, value: null });
    expect(customerService.parsePowerVa('')).toEqual({ raw: null, value: null });
  });
});
