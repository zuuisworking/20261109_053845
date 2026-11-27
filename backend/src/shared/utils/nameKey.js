const { caseFold } = require('unicode-case-folding');

// Canonical transformer identity rules.
//
// The display name keeps its operator-visible spelling but is always stored
// NFC-normalized and trimmed. The business key is the Unicode full
// case-folded form of that display name, so two records are the same
// transformer only when their nameKey values are identical.
//
// Full case folding is intentionally different from String#toLowerCase:
// for example, Greek final sigma, long s, and German sharp s have explicit
// case-folding mappings. The identity key therefore must never fall back to
// locale-sensitive lowercasing.
function normalizeDisplayName(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFC');
}

function normalizeNameKey(value) {
  return caseFold(
    String(value ?? '')
      .normalize('NFC')
      .trim(),
  ).normalize('NFC');
}

module.exports = { normalizeDisplayName, normalizeNameKey };
