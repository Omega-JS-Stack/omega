// Main-layer tests for runtime.log per lock mode: the clear-or-keep decision
// (the one lock reader, `singleInstanceOff(config)`, and whether this launch
// holds the lock) and the file transport's line format. The harness booted
// main.js on the default config, which keeps the single-instance lock on.

const fs = require('fs');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const LoggerLite = require('../../../lib/logger-lite.js');

const DIST_DIR = path.join(__dirname, '..', '..', '..');
const LIB_DIR = path.join(DIST_DIR, 'lib');

// An inline read of the lock: only the helper's own body may hold one
const INLINE_LOCK_READ = /singleInstance\s*[!=]==?\s*false/g;

// The file line with the lock on: `[<time>] [<level>] <scope> <text>`, no pid
const LOCK_ON_LINE = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[info\] /;

// The file line with the lock off: `[<time>] [<level>] [pid <n>] <scope> <text>`;
// electron-log pads after the level to align levels, so the gaps are ` +`
function lockOffLine(pid) {
  return new RegExp(`^\\[\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\] \\[info\\] +\\[pid ${pid}\\] `);
}

// The configs that keep the lock on: only an explicit `false` turns it off
const LOCK_ON_CONFIGS = [
  { protocol: {} },
  { protocol: { singleInstance: true } },
];

// The one `singleInstanceOff` the desktop lib exports, whichever lib file is its
// home; a second distinct function by that name, or an inline lock read anywhere
// else in dist, is a second reader and fails.
function findSingleInstanceOff() {
  const found = new Set();
  for (const name of fs.readdirSync(LIB_DIR)) {
    const file = path.join(LIB_DIR, name);
    if (!name.endsWith('.js') || !fs.readFileSync(file, 'utf8').includes('singleInstanceOff')) continue;
    const mod = require(file);
    if (typeof mod.singleInstanceOff === 'function') found.add(mod.singleInstanceOff);
    if (typeof mod === 'function' && mod.name === 'singleInstanceOff') found.add(mod);
  }
  if (found.size !== 1) {
    throw new Error(`expected ONE singleInstanceOff exported from ${LIB_DIR}, found ${found.size}`);
  }
  const reads = inlineLockReads();
  if (reads.length !== 1) {
    throw new Error(`expected ONE inline lock read (the helper's), found ${reads.length}: ${reads.join(', ')}`);
  }
  return [...found][0];
}

// Every `<file>:<n>` in dist (vendor skipped) holding an inline lock read
function inlineLockReads() {
  const reads = [];
  for (const rel of fs.readdirSync(DIST_DIR, { recursive: true })) {
    if (!rel.endsWith('.js') || rel.split(path.sep)[0] === 'vendor') continue;
    const count = (fs.readFileSync(path.join(DIST_DIR, rel), 'utf8').match(INLINE_LOCK_READ) || []).length;
    if (count) reads.push(`${rel}:${count}`);
  }
  return reads;
}

// Every runtime.log line holding `marker`, read after writing it through LoggerLite
function writeAndRead(marker) {
  new LoggerLite('runtime-log-test').log(marker);
  return fs.readFileSync(LoggerLite.getLogFilePath(), 'utf8')
    .split('\n')
    .filter((line) => line.includes(marker));
}

// Stands in for an earlier launch: a line already in runtime.log, then this
// process's boot point recorded after it, as a fresh launch's transport records it
function earlierLaunch() {
  const marker = `earlier-launch-marker-${Date.now()}`;
  fs.appendFileSync(LoggerLite.getLogFilePath(), `${marker}\n`);
  LoggerLite._internals.recordBootSize();
  return marker;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'runtime.log per lock mode (main)',
  stopOnFailure: false,
  tests: [
    {
      name: 'lock on: the boot cleared runtime.log, so its first line is this process\'s init line',
      run: (ctx) => {
        const singleInstanceOff = findSingleInstanceOff();
        ctx.expect(singleInstanceOff(ctx.omega.config), 'the harness config').toBe(false);
        for (const config of LOCK_ON_CONFIGS) {
          ctx.expect(singleInstanceOff(config), JSON.stringify(config)).toBe(false);
        }

        const firstLine = fs.readFileSync(LoggerLite.getLogFilePath(), 'utf8').split('\n')[0];
        ctx.expect(firstLine).toContain('Initializing @omega.js/desktop (main)...');
        ctx.expect(firstLine).toContain(`pid=${process.pid} `);
      },
    },
    {
      name: 'lock off: the clear keeps another launch\'s lines',
      run: (ctx) => {
        const singleInstanceOff = findSingleInstanceOff();
        ctx.expect(singleInstanceOff({ protocol: { singleInstance: false } })).toBe(true);

        const earlier = earlierLaunch();
        LoggerLite.setSingleInstanceOff(true);
        try {
          LoggerLite.clearEarlierLaunches(true);
          ctx.expect(fs.readFileSync(LoggerLite.getLogFilePath(), 'utf8')).toContain(earlier);
        } finally {
          LoggerLite.setSingleInstanceOff(false);
        }
      },
    },
    {
      name: 'lock on, not held (a duplicate launch): the clear leaves the running copy\'s lines',
      run: (ctx) => {
        const earlier = earlierLaunch();
        LoggerLite.clearEarlierLaunches(false);
        ctx.expect(fs.readFileSync(LoggerLite.getLogFilePath(), 'utf8')).toContain(earlier);
      },
    },
    {
      name: 'lock on and held: the clear drops earlier launches\' lines and keeps this launch\'s own',
      run: (ctx) => {
        const earlier = earlierLaunch();
        const own = `own-launch-marker-${Date.now()}`;
        new LoggerLite('runtime-log-test').log(own);
        LoggerLite.clearEarlierLaunches(true);

        const lines = fs.readFileSync(LoggerLite.getLogFilePath(), 'utf8').split('\n');
        ctx.expect(lines.join('\n')).not.toContain(earlier);
        ctx.expect(lines[0]).toContain(own);
      },
    },
    {
      name: 'lock off: every file line carries [pid <process.pid>] after the level',
      run: (ctx) => {
        LoggerLite.setSingleInstanceOff(true);
        try {
          const lines = writeAndRead(`lock-off-marker-${Date.now()}`);
          ctx.expect(lines.length).toBe(1);
          ctx.expect(lines[0]).toMatch(lockOffLine(process.pid));
        } finally {
          LoggerLite.setSingleInstanceOff(false);
        }
      },
    },
    {
      name: 'lock on: a file line carries no pid',
      run: (ctx) => {
        const lines = writeAndRead(`lock-on-marker-${Date.now()}`);
        ctx.expect(lines.length).toBe(1);
        ctx.expect(lines[0]).toMatch(LOCK_ON_LINE);
        ctx.expect(lines[0]).not.toContain('[pid ');
      },
    },
  ],
});
