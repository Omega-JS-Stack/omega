// Unit tests for src/machine-tools.js: the one list of the tools a target type
// needs on the machine (npm installs none of them), and the one helper that
// names what an enabled set of targets is missing.
//
// The probes run through an injected execFn that throws for a missing tool, the
// way a failed child does, so no case here touches the real java or firebase.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MACHINE_TOOLS, machineToolsFor, missingMachineTools, machineToolLine } = require('../src/machine-tools.js');

const PLATFORMS = ['darwin', 'win32', 'linux'];

/** The list entry for one tool of the backend type. */
const backendTool = (name) => MACHINE_TOOLS.backend.find((tool) => tool.name === name);

/**
 * An execFn stand-in: records every probe it is handed, and throws for the
 * tools named in `missing` ('*' fails every probe).
 */
function probeRunner(missing = []) {
  const calls = [];
  const nameOf = Object.fromEntries(Object.values(MACHINE_TOOLS).flat().map((tool) => [tool.probe[0], tool.name]));
  const execFn = (file, args) => {
    calls.push([file, ...(args || [])]);
    if (missing.includes('*') || missing.includes(nameOf[file])) {
      throw Object.assign(new Error(`spawnSync ${file} ENOENT`), { code: 'ENOENT' });
    }
    return '';
  };
  return { execFn, calls };
}

test('exports the expected surface', () => {
  assert.equal(typeof MACHINE_TOOLS, 'object');
  assert.equal(typeof machineToolsFor, 'function');
  assert.equal(typeof missingMachineTools, 'function');
  assert.equal(typeof machineToolLine, 'function');
});

test('the list: a backend needs java and firebase, the other types need nothing npm does not bring', () => {
  assert.deepEqual(Object.keys(MACHINE_TOOLS).sort(), ['backend', 'desktop', 'extension', 'web']);
  assert.deepEqual(MACHINE_TOOLS.backend.map((tool) => tool.name), ['java', 'firebase']);
  for (const type of ['web', 'desktop', 'extension']) assert.deepEqual(MACHINE_TOOLS[type], [], type);
});

test('every entry carries a probe, a reason and an install command per platform', () => {
  for (const tool of Object.values(MACHINE_TOOLS).flat()) {
    assert.ok(Array.isArray(tool.probe) && tool.probe.length > 0, `${tool.name}: probe is [file, ...args]`);
    assert.equal(typeof tool.probe[0], 'string', `${tool.name}: the probe opens on the file to run`);
    assert.ok(typeof tool.why === 'string' && tool.why.length > 0, `${tool.name}: why`);
    assert.deepEqual(Object.keys(tool.install).sort(), [...PLATFORMS].sort(), `${tool.name}: one command per platform`);
    for (const platform of PLATFORMS) {
      assert.ok(typeof tool.install[platform] === 'string' && tool.install[platform].length > 0, `${tool.name} on ${platform}`);
    }
  }
});

test('machineToolsFor: a Firebase backend gets the backend list, a custom backend and every other type get none', () => {
  assert.deepEqual(machineToolsFor({ type: 'backend' }).map((tool) => tool.name), ['java', 'firebase'], 'firebase is the default project type');
  assert.deepEqual(machineToolsFor({ type: 'backend', projectType: 'firebase' }).map((tool) => tool.name), ['java', 'firebase']);
  assert.deepEqual(machineToolsFor({ type: 'backend', projectType: 'custom' }), []);
  for (const type of ['web', 'desktop', 'extension']) assert.deepEqual(machineToolsFor({ type }), [], type);
});

test('#1032 case 1: a backend whose Java probe fails gets one java row, with the platform\'s install command', () => {
  for (const platform of PLATFORMS) {
    const { execFn } = probeRunner(['java']);

    const missing = missingMachineTools([{ name: 'backend', type: 'backend' }], { platform, execFn });

    assert.equal(missing.length, 1, `${platform}: ${JSON.stringify(missing)}`);
    assert.deepEqual(missing[0], {
      target: 'backend',
      type: 'backend',
      name: 'java',
      why: backendTool('java').why,
      install: backendTool('java').install[platform],
    });
  }
  assert.notEqual(backendTool('java').install.darwin, backendTool('java').install.win32, 'the install command is picked per platform');
});

test('#1032 case 1: machineToolLine holds the name, the target and the install command', () => {
  const line = machineToolLine({
    target: 'api',
    type: 'backend',
    name: 'java',
    why: 'the Firebase emulators run on it',
    install: 'brew install openjdk',
  });

  assert.equal(line, 'java is not installed (the api target needs it: the Firebase emulators run on it). Install with: brew install openjdk');
});

test('#1032 case 1: the row the helper returns reads as the one line', () => {
  const { execFn } = probeRunner(['java']);
  const [miss] = missingMachineTools([{ name: 'backend', type: 'backend' }], { platform: 'linux', execFn });

  const line = machineToolLine(miss);

  assert.ok(line.startsWith('java is not installed (the backend target needs it: '), line);
  assert.ok(line.endsWith(`). Install with: ${backendTool('java').install.linux}`), line);
});

test('#1032 case 2: with both probes passing, nothing is missing', () => {
  const { execFn, calls } = probeRunner([]);

  assert.deepEqual(missingMachineTools([{ name: 'backend', type: 'backend' }], { platform: 'darwin', execFn }), []);
  assert.deepEqual(calls, MACHINE_TOOLS.backend.map((tool) => tool.probe), 'each tool was probed with its own probe');
});

test('#1032 case 3: a custom backend, or a web, desktop or extension target, is missing nothing even with every probe failing', () => {
  const targets = [
    { name: 'api', type: 'backend', projectType: 'custom' },
    { name: 'web', type: 'web' },
    { name: 'desktop', type: 'desktop' },
    { name: 'extension', type: 'extension' },
  ];
  const { execFn } = probeRunner(['*']);

  assert.deepEqual(missingMachineTools(targets, { platform: 'darwin', execFn }), []);
});

test('#1032 case 4: a brand with no backend target runs no Java or Firebase probe at all', () => {
  const { execFn, calls } = probeRunner(['*']);

  missingMachineTools([{ name: 'web', type: 'web' }, { name: 'desktop', type: 'desktop' }], { platform: 'darwin', execFn });
  missingMachineTools([], { platform: 'darwin', execFn });

  assert.deepEqual(calls, []);
});

test('one row per missing tool per target, each naming its own target', () => {
  const { execFn } = probeRunner(['java', 'firebase']);

  const missing = missingMachineTools([
    { name: 'api', type: 'backend' },
    { name: 'web', type: 'web' },
    { name: 'admin', type: 'backend' },
  ], { platform: 'darwin', execFn });

  assert.deepEqual(missing.map((row) => `${row.target}:${row.name}`).sort(), ['admin:firebase', 'admin:java', 'api:firebase', 'api:java']);
});

test('the probe\'s shell flag follows the host, never the platform passed in for the install line', () => {
  const shells = [];
  const execFn = (file, args, options) => { shells.push(options.shell); return ''; };

  missingMachineTools([{ name: 'backend', type: 'backend' }], { platform: process.platform === 'win32' ? 'linux' : 'win32', execFn });

  assert.deepEqual(shells, MACHINE_TOOLS.backend.map(() => process.platform === 'win32'));
});
