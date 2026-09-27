/**
 * The brand-root `omega migrate` harness the migrate suites share: a staged
 * brand on disk, the real command run from it with its console captured, and
 * one report block read back by its heading.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const migrateCommand = require('../../src/commands/migrate.js');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
}

/** A brand root carrying `source` as its config/omega.json5 and the installed manager. */
function stageBrand(source) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-migrate-')));
  const brand = path.join(scratch, 'brand');
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'package.json'), JSON.stringify({ name: 'fixture-brand', private: true }));
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), source);
  // The installed manager the register line is read from
  fs.mkdirSync(path.join(brand, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(path.join(__dirname, '..', '..'), path.join(brand, 'node_modules', '@omega.js', 'manager'), 'dir');
  return brand;
}

/** Run the command from `brand` with console.log captured. */
async function runMigrate(brand, options = {}) {
  const cwd0 = process.cwd();
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  process.chdir(brand);

  try {
    await migrateCommand({ _: ['migrate'], ...options });
    return { text: lines.join('\n'), code: process.exitCode };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

/** The lines of one block: from its heading line to the next unindented line. */
function block(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.trim() !== '' && !line.startsWith(' '));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

module.exports = { write, stageBrand, runMigrate, block };
