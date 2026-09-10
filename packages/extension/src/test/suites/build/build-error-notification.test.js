// Build-layer tests for Manager.getBuildErrorNotificationArgs() — the notifly
// argv the build-error reporter spawns (#104).
//
// Build messages routinely carry apostrophes and parentheses ("the app's
// package.json has no version (Chrome refuses …)"). The reporter used to
// interpolate the message into a single shell string, which the shell then
// mangled — the report survived, the notification died with a syntax error.
// The contract now is an ARGV ARRAY handed to a shell-free spawn, so every
// character of the message reaches notifly verbatim.

const path = require('path');
const { spawnSync } = require('child_process');

const Manager = require(path.join(__dirname, '..', '..', '..', 'build.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

// The live message from the versionless-manifest package test — apostrophe,
// parentheses, quotes and a colon in one string.
const NASTY = `Cannot build the manifest: the extension app's package.json has no "version" (Chrome refuses to load a manifest without one)`;

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'Manager — build-error notification argv is shell-free',
  tests: [
    {
      name: 'returns an argv array, never a shell string',
      run: (ctx) => {
        const args = Manager.getBuildErrorNotificationArgs('Package', NASTY);
        ctx.expect(Array.isArray(args)).toBe(true);
        ctx.expect(args.every((a) => typeof a === 'string')).toBe(true);
      },
    },
    {
      name: 'an apostrophe-bearing message is ONE verbatim arg (no quoting, no escapes)',
      run: (ctx) => {
        const args = Manager.getBuildErrorNotificationArgs('Package', NASTY);
        const message = args[args.indexOf('--message') + 1];
        ctx.expect(message).toBe(NASTY);
        ctx.expect(message.includes('\\')).toBe(false);
      },
    },
    {
      name: 'title carries the plugin name and the flags notifly expects',
      run: (ctx) => {
        const args = Manager.getBuildErrorNotificationArgs('Bundle', 'boom');
        ctx.expect(args[args.indexOf('--title') + 1]).toBe('Build Error: Bundle');
        // No --appIcon: the old value was a machine-specific absolute path (#126)
        ctx.expect(args.includes('--appIcon')).toBe(false);
        ctx.expect(args.includes('--timeout')).toBe(true);
        ctx.expect(args.includes('--sound')).toBe(true);
      },
    },
    {
      // The end-to-end proof, run against a REAL child process (no shell, no mock):
      // every arg arrives at the child byte-identical, apostrophes and all. The
      // old shell string never got this far — /bin/sh died parsing it.
      name: 'the argv survives a real shell-free spawn byte-identical',
      run: (ctx) => {
        const args = Manager.getBuildErrorNotificationArgs('Package', NASTY);
        const printer = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
        const result = spawnSync(process.execPath, ['-e', printer, '--', ...args], { encoding: 'utf8' });

        ctx.expect(result.status).toBe(0);
        ctx.expect(result.stderr).toBe('');
        ctx.expect(JSON.parse(result.stdout)).toEqual(args);
      },
    },
    {
      // notifly is an optional local nicety: on a machine without it the spawn
      // used to dump a raw `spawn notifly ENOENT` error after the suite (#123).
      // The ENOENT here comes from a REAL spawn of a binary that cannot exist.
      name: 'a real missing-binary ENOENT prints ONE friendly note, no error dump',
      run: (ctx) => {
        const result = spawnSync('omega-notifly-does-not-exist-xyz', ['--title', 'x'], { shell: false });
        ctx.expect(result.error.code).toBe('ENOENT');

        const warns = [];
        const errors = [];
        const origWarn = console.warn;
        const origError = console.error;
        console.warn = (...args) => warns.push(args.join(' '));
        console.error = (...args) => errors.push(args.join(' '));
        try {
          Manager.reportNotificationFailure(result.error);
        } finally {
          console.warn = origWarn;
          console.error = origError;
        }

        ctx.expect(warns.length).toBe(1);
        ctx.expect(warns[0]).toContain('notifly not installed — skipping desktop notification');
        ctx.expect(warns[0].includes('ENOENT')).toBe(false);
        ctx.expect(warns[0].includes('spawnSync')).toBe(false);
        ctx.expect(errors.length).toBe(0);
      },
    },
    {
      name: 'every other spawn failure keeps the logged-not-thrown error',
      run: (ctx) => {
        const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });

        const warns = [];
        const errors = [];
        const origWarn = console.warn;
        const origError = console.error;
        console.warn = (...args) => warns.push(args.join(' '));
        console.error = (...args) => errors.push(args.join(' '));
        try {
          Manager.reportNotificationFailure(failure);
        } finally {
          console.warn = origWarn;
          console.error = origError;
        }

        ctx.expect(errors.length).toBe(1);
        ctx.expect(errors[0]).toContain('Failed to send notification');
        ctx.expect(warns.length).toBe(0);
      },
    },
  ],
});
