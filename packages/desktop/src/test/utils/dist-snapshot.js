// Fingerprint a build-output tree: one line per file — relative path, size, mtime.
//
// Used by the boot layer to prove a boot-test run leaves the project's REAL dist/
// untouched (#110): the runner records the snapshot before the test build, ships it in
// the boot spec, and the boot suite re-reads the same tree from inside the booted app
// and compares. A missing tree snapshots as the empty string, so "absent before, absent
// after" passes and "absent before, written during the run" fails.

const fs = require('fs');
const path = require('path');

module.exports = function distSnapshot(dir) {
  const lines = [];
  walk(dir, dir, lines);
  return lines.sort().join('\n');
};

function walk(root, current, out) {
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch (e) {
    return;   // absent (or unreadable) tree — nothing to fingerprint
  }

  for (const entry of entries) {
    const abs = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, abs, out);
      continue;
    }
    // lstat, not stat — a symlink is recorded as itself, never followed.
    const stats = fs.lstatSync(abs);
    out.push(`${path.relative(root, abs)}\t${stats.size}\t${stats.mtimeMs}`);
  }
}
