// Libraries
const Manager = new (require('../../build.js'));
const logger = Manager.logger('fontawesome');
const { series } = require('gulp');
const { emitIcons } = require('@omega.js/devkit/icons');

// Emit the brand's Font Awesome set (C4 cp112) into dist/assets/fa —
// the extension-page icon renderer fetches from
// chrome.runtime.getURL('assets/fa/<style>/<name>.svg'), so the packaged
// extension carries its icons offline, Pro included when the brand
// supplies one (OMEGA_FONTAWESOME_ROOT or a fontawesome-pro install).
// One task run per build — no watcher (the set only changes when the
// brand's supply does).
function fontawesome(complete) {
  const result = emitIcons({ outDir: 'dist' });

  // Log
  logger.log(`Emitted ${result.files} icons → ${result.dest}`);

  // Complete
  return complete();
}

// Default Task
module.exports = series(fontawesome);
