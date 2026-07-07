/**
 * SSOT shim for line-based file merging (.env / .gitignore / CLAUDE.md).
 *
 * The real merge logic lives in @omegajs/devkit/merge-line-files (reached through
 * the `src/utils/merge-line-files.js` shim so vendoring rewrites one path) — a
 * key-based merge that keeps each KEY under its template header and
 * promotes/migrates keys between the Default/Custom sections correctly. This file
 * used to contain a SECOND, positional implementation that zipped comment lines
 * and value lines by index; an off-by-one there is what historically scrambled
 * consumers' `.env` files. That duplicate is gone — this module now just
 * re-exports the canonical impl and adds the marker-name aliases the setup tests
 * (`env-file.js`, `gitignore.js`) consume.
 */

const {
  mergeLineBasedFiles,
  hasSectionMarkers,
  DEFAULT_MARKER,
  CUSTOM_MARKER,
} = require('../../../../utils/merge-line-files.js');

module.exports = {
  mergeLineBasedFiles,
  hasSectionMarkers,
  // Names the setup tests import (aliases of the canonical markers).
  DEFAULT_SECTION_MARKER: DEFAULT_MARKER,
  CUSTOM_SECTION_MARKER: CUSTOM_MARKER,
};
