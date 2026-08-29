'use strict';

// Customer identity conflict helpers. Notes arriving from request bodies can
// be either a plain string or a { reason } envelope; both collapse to a
// single trimmed string for the timeline.

function identityConflictNote(input) {
  if (typeof input === 'string') return input.trim();
  if (input && typeof input === 'object' && !Array.isArray(input)
      && typeof input.reason === 'string') return input.reason.trim();
  return '';
}

module.exports = Object.freeze({
  identityConflictNote,
});
