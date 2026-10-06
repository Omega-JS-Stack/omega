/**
 * What a concurrency fixture case leaves behind: one JSON file per label in
 * the dir `FIXTURE_OUT` names, holding its start and end times or its cwd.
 */
const fs = require('node:fs');
const path = require('node:path');

function write(label, data) {
  fs.writeFileSync(path.join(process.env.FIXTURE_OUT, `${label}.json`), JSON.stringify({ label, ...data }));
}

// Record when this case started and ended, holding it open for `ms`.
async function timed(label, ms) {
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, ms));
  write(label, { start, end: Date.now() });
}

function recordCwd(label) {
  write(label, { cwd: process.cwd() });
}

module.exports = { timed, recordCwd };
