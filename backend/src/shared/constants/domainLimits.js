// Canonical field and operational limits shared by direct writes, imports,
// model validation, and electrical analysis. Keeping the limits in one module
// prevents the import path from accepting values that the direct API rejects.
module.exports = Object.freeze({
  CUSTOMER_NAME_MAX_LENGTH: 300,
  CUSTOMER_TARIFF_MAX_LENGTH: 100,
  CUSTOMER_POWER_RAW_MAX_LENGTH: 100,
  CUSTOMER_ADDRESS_MAX_LENGTH: 1000,
  MAX_POWER_VA: Number.MAX_SAFE_INTEGER,

  TRANSFORMER_NAME_MAX_LENGTH: 200,
  TRANSFORMER_FEEDER_MAX_LENGTH: 200,
  TRANSFORMER_CAPACITY_MAX_LENGTH: 200,
  TRANSFORMER_BRAND_MAX_LENGTH: 200,
  TRANSFORMER_GROUNDING_MAX_LENGTH: 200,
  TRANSFORMER_RAW_COORDINATES_MAX_LENGTH: 500,
  // Unicode full case folding can expand a code point (for example ß -> ss or
  // ﬃ -> ffi). The server-owned key therefore permits three code units per
  // code unit in the 200-character display name.
  TRANSFORMER_NAME_KEY_MAX_LENGTH: 600,

  // Alias registry limits. The alias display name mirrors the transformer
  // display name bound and the server-owned alias key permits three code
  // units per code unit because Unicode full case folding can expand a code
  // point (for example ß -> ss or ﬃ -> ffi).
  TRANSFORMER_ALIAS_NAME_MAX_LENGTH: 200,
  TRANSFORMER_ALIAS_KEY_MAX_LENGTH: 600,
  TRANSFORMER_ALIAS_REASON_MAX_LENGTH: 1000,
  TRANSFORMER_ALIAS_SOURCE_MAX_LENGTH: 64,
  TRANSFORMER_ALIAS_SOURCE_VERSION_MAX_LENGTH: 100,

  // These are deliberately well above distribution-transformer operating
  // values while keeping all derived electrical arithmetic finite.
  MAX_CAPACITY_KVA: 1_000_000,
  MAX_CURRENT_AMPS: 100_000,
  MEASUREMENT_TEXT_MAX_LENGTH: 300,
});
