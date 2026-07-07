/**
 * Per-target health checks. Each check records into passed/warned/failed;
 * the output shape matches omega-manager's testing service so RunSummary's
 * drill-down works unchanged.
 *
 * Checks by target:
 *   web      → dist/index.html exists (the build actually produced a site)
 *   backend  → firebase.json + functions/package.json exist
 *   (all)    → app package.json parses
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

module.exports = async ({ apps }) => {
  const passed = [];
  const warned = [];
  const failed = [];

  const check = (name, ok, error) => {
    if (ok) {
      passed.push({ name });
      console.log(`      ${chalk.green('✓')} ${name}`);
    } else {
      failed.push({ name, error });
      console.log(`      ${chalk.red('✗')} ${name}${error ? chalk.dim(`: ${error}`) : ''}`);
    }
  };

  for (const app of apps.filter((a) => a.target)) {
    const pkg = jetpack.read(join(app.path, 'package.json'), 'json');
    check(`${app.name}: package.json`, !!pkg, 'missing or unparseable');

    if (app.target === 'web') {
      check(
        `${app.name}: build output`,
        jetpack.exists(join(app.path, 'dist', 'index.html')) === 'file',
        'dist/index.html missing — run the update service',
      );
    }

    if (app.target === 'backend') {
      check(
        `${app.name}: firebase.json`,
        jetpack.exists(join(app.path, 'firebase.json')) === 'file',
        'missing',
      );
      check(
        `${app.name}: functions/package.json`,
        jetpack.exists(join(app.path, 'functions', 'package.json')) === 'file',
        'missing',
      );
    }
  }

  const status = failed.length > 0 ? 'error' : warned.length > 0 ? 'warned' : 'success';

  return {
    status,
    ...(failed.length > 0 ? { error: failed.map((f) => f.name).join(', ') } : {}),
    output: {
      results: {
        passed: passed.map((p) => p.name),
        warned,
        failed,
      },
      counts: { passed: passed.length, warned: warned.length, failed: failed.length },
    },
  };
};
