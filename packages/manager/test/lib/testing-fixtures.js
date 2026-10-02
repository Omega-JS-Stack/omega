/**
 * Fixtures for the testing service's suites: staged brand roots and targets,
 * recording fetch/exec fakes keyed by URL and command, and runService, which
 * drives the real service through the same injection seam runManage exposes.
 */
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { OPERATIONS } = require('../../src/config.js');
const service = require('../../src/services/testing/index.js');

const HOMEPAGE = 'https://fixture-brand.test';
const GIT_CMD = 'git status --porcelain -- .';

function stageBrand() {
  return mkdtempSync(join(tmpdir(), 'omega-testing-'));
}

/**
 * Mark targets as deployed: live-check failures only ERROR when a deploy
 * record exists, and record-less brands get the "not deployed yet" nudge.
 */
function seedDeployRecord(root, ...targets) {
  const records = Object.fromEntries(targets.map((target) => [target, { at: '2026-07-17T00:00:00.000Z' }]));
  jetpack.write(join(root, '.omega', 'state.json'), { deploy: records });
}

function brandConfig(overrides = {}) {
  return {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: HOMEPAGE },
    targets: { web: { type: 'web' }, backend: { type: 'backend' } },
    ...overrides,
  };
}

/** Stage targets/web, optionally with a built dist and a framework dep. */
function stageWebTarget(root, { dist = true, declared = null, installed = null } = {}) {
  const targetPath = join(root, 'targets', 'web');
  jetpack.write(join(targetPath, 'package.json'), {
    name: 'fixture-web',
    private: true,
    ...(declared ? { dependencies: { '@omega.js/web': declared } } : {}),
  });
  if (dist) {
    jetpack.write(join(targetPath, 'dist', 'index.html'), '<!doctype html><title>fixture</title>');
  }
  if (installed) {
    jetpack.write(join(targetPath, 'node_modules', '@omega.js/web', 'package.json'), {
      name: '@omega.js/web',
      version: installed,
    });
  }
  return { name: 'web', dir: 'targets/web', path: targetPath, target: 'web' };
}

/** Stage targets/backend in the src/dist pillar shape: the framework dep on the
 * ONE target manifest, staged dist/ as build output. */
function stageBackendTarget(root, { installed = '5.9.0' } = {}) {
  const targetPath = join(root, 'targets', 'backend');
  jetpack.write(join(targetPath, 'package.json'), {
    name: 'fixture-backend',
    private: true,
    dependencies: { '@omega.js/backend': 'file:../../../../packages/backend' },
  });
  jetpack.write(join(targetPath, 'firebase.json'), {});
  jetpack.write(join(targetPath, 'dist', 'package.json'), { name: 'fixture-backend-functions', private: true });
  if (installed) {
    jetpack.write(join(targetPath, 'node_modules', '@omega.js/backend', 'package.json'), {
      name: '@omega.js/backend',
      version: installed,
    });
  }
  return { name: 'backend', dir: 'targets/backend', path: targetPath, target: 'backend' };
}

/**
 * Recording fetch fake keyed by URL. Spec per URL: { status, body? } (body
 * absent → json() throws like a non-JSON response), an Error (network
 * failure, reusable), or an array of those consumed one per call.
 */
function fakeFetch(responses = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (!(url in responses)) {
      throw new Error(`fakeFetch: unexpected fetch ${url}`);
    }
    let spec = responses[url];
    if (Array.isArray(spec)) {
      if (spec.length === 0) throw new Error(`fakeFetch: exhausted responses for ${url}`);
      spec = spec.shift();
    }
    if (spec instanceof Error) throw spec;
    return {
      status: spec.status,
      json: async () => {
        if (!('body' in spec)) throw new Error('no body');
        return structuredClone(spec.body);
      },
    };
  };
  fn.calls = calls;
  return fn;
}

/**
 * Recording exec fake keyed by exact command. Spec: stdout string or an
 * Error to throw. Records [command, cwd|null]. Unconfigured commands throw,
 * and checks that swallow exec errors (git, gh, npm view) dim out by design.
 */
function fakeExec(responses = {}) {
  const calls = [];
  const fn = (command, options = {}) => {
    calls.push([command, options.cwd || null]);
    if (!(command in responses)) {
      throw new Error(`fakeExec: unexpected command ${command}`);
    }
    const spec = responses[command];
    if (spec instanceof Error) throw spec;
    return spec;
  };
  fn.calls = calls;
  return fn;
}

async function runService(config, { root, targets, fetch, exec, options = {} }) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: root,
    brandConfig: config,
    targets,
    operations: OPERATIONS.testing,
    options: { fetch, exec, retryDelayMs: 0, ...options },
    serviceData: {},
  });
}

module.exports = {
  HOMEPAGE,
  GIT_CMD,
  stageBrand,
  seedDeployRecord,
  brandConfig,
  stageWebTarget,
  stageBackendTarget,
  fakeFetch,
  fakeExec,
  runService,
};
