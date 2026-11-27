const { parsePointCoordinates } = require('../../backend/src/shared/utils/geoParser');

describe('parsePointCoordinates', () => {
  it('keeps canonical WKT in longitude-latitude order', () => {
    const result = parsePointCoordinates('POINT (98.676652 3.666219)');

    expect(result.isValid).toBe(true);
    expect(result.format).toBe('wkt');
    expect(result.coordinates).toEqual([98.676652, 3.666219]);
    expect(result.geojson).toEqual({
      type: 'Point',
      coordinates: [98.676652, 3.666219],
    });
  });

  it('reads labeled pairs as latitude and longitude regardless of label order', () => {
    const result = parsePointCoordinates('longitude: 98.676652, latitude: 3.666219');

    expect(result.isValid).toBe(true);
    expect(result.coordinates).toEqual([98.676652, 3.666219]);
  });

  it('requires an explicit order for an unlabeled numeric pair', () => {
    const ambiguous = parsePointCoordinates('3.666219, 98.676652');
    const explicit = parsePointCoordinates('3.666219, 98.676652', {
      inputFormat: 'lat-long',
    });

    expect(ambiguous.isValid).toBe(false);
    expect(ambiguous.error.code).toBe('AMBIGUOUS_COORDINATE_ORDER');
    expect(explicit.isValid).toBe(true);
    expect(explicit.coordinates).toEqual([98.676652, 3.666219]);
  });

  it('parses Indonesian decimal-comma pairs with explicit latitude-first order', () => {
    const result = parsePointCoordinates('3,666219, 98,676652', {
      inputFormat: 'indonesian-lat-long',
    });

    expect(result.isValid).toBe(true);
    expect(result.coordinates).toEqual([98.676652, 3.666219]);
  });

  it('rejects coordinates outside the ULP Labuhan operational bounds', () => {
    const result = parsePointCoordinates('POINT (101.676652 3.666219)');

    expect(result.isValid).toBe(false);
    expect(result.error.code).toBe('OUTSIDE_OPERATIONAL_BOUNDS');
  });
});
