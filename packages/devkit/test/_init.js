/**
 * Devkit's test lifecycle hook: before the first case, sweep the dead-pid
 * `.temp/<suite>-<pid>` dirs earlier runs left (fixtures are per-pid); files stay.
 */
const fs = require('node:fs');
const path = require('node:path');

const TEMP_DIR = path.join(__dirname, '..', '.temp');

/** Whether a pid names a live process. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = () => ({
  setup() {
    if (!fs.existsSync(TEMP_DIR)) return;
    for (const entry of fs.readdirSync(TEMP_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/-(\d+)$/);
      if (!match || alive(parseInt(match[1], 10))) continue;
      fs.rmSync(path.join(TEMP_DIR, entry.name), { recursive: true, force: true });
    }
  },
});
