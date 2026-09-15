// The notarize hook's Developer ID gate
// ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
//
// electron-builder SKIPS mac code signing when it finds no identity ("cannot find
// valid Developer ID Application identity ... 0 identities found") and ships the
// ad-hoc signature the linker left. The hook then notarized it anyway, because
// APPLE_API_KEY was set, and notarytool rejected the submission: "Failed to
// codesign your application with code: 1" ended the whole mac leg of a build that
// had otherwise succeeded.
//
// The seam is codesign's OWN report: a pure predicate over its text, plus an
// injectable exec for reading it. Both fixtures below are the verbatim output of
// run 34584322778 and of a signed build.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const notarizeHook = require(path.join(__dirname, '..', '..', '..', 'hooks', 'notarize.js'));
const { isDeveloperIdSigned, readCodesign } = notarizeHook;
const { stapleAndProve } = require(path.join(__dirname, '..', '..', '..', 'hooks', 'lib', 'notarize-tools.js'));

// What the real tools print when they are happy. A fake `run` answers by
// command, so the SEQUENCE and the refusal are both provable offline.
const TOOL_OUTPUT = {
  'stapler staple': 'Processing: /tmp/App.app\nThe staple and validate action worked!',
  'stapler validate': 'Processing: /tmp/App.app\nThe validate action worked!',
  'spctl --assess': '/tmp/App.app: accepted\nsource=Notarized Developer ID',
  'notarytool submit': '  status: Accepted\n  message: Successfully received submission info',
};

function fakeTools(overrides = {}) {
  const commands = [];
  const answers = { ...TOOL_OUTPUT, ...overrides };

  const run = async (command) => {
    commands.push(command);
    const key = Object.keys(answers).find((needle) => command.includes(needle));
    const answer = key ? answers[key] : '';
    if (answer instanceof Error) throw answer;
    return answer;
  };

  return { run, commands };
}

// What the runner's own `codesign -dv --verbose=2` printed for the unsigned app.
const ADHOC = `Executable=/Users/runner/work/playground-omega/targets/desktop/release/mac-universal/OMEGA Playground.app/Contents/MacOS/OMEGA Playground
Identifier=Electron
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20400 size=392 flags=0x20002(adhoc,linker-signed) hashes=9+0 location=embedded
Signature=adhoc
Info.plist=not bound
TeamIdentifier=not set
Sealed Resources=none`;

// The same report for a build that DID find the identity.
const SIGNED = `Executable=/Users/runner/work/app/release/mac-universal/App.app/Contents/MacOS/App
Identifier=dev.omegajs.app
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=30+7 location=embedded
Signature size=9000
Authority=Developer ID Application: ITW Creative Works (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=ABCDE12345
Sealed Resources version=2 rules=13 files=40`;

// An app with no signature at all: codesign exits NON-ZERO and says so.
const UNSIGNED_ERROR = 'OMEGA Playground.app: code object is not signed at all';

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'notarize: only a Developer ID signed app is submitted (#872), and the staple is PROVED (#891)',
  tests: [
    {
      name: 'an ad-hoc signature is not a Developer ID signature',
      run: (ctx) => {
        ctx.expect(isDeveloperIdSigned(ADHOC)).toBe(false);
        ctx.expect(isDeveloperIdSigned(UNSIGNED_ERROR)).toBe(false);
        ctx.expect(isDeveloperIdSigned('')).toBe(false);
        ctx.expect(isDeveloperIdSigned(undefined)).toBe(false);
      },
    },
    {
      name: 'a Developer ID Application authority is',
      run: (ctx) => {
        ctx.expect(isDeveloperIdSigned(SIGNED)).toBe(true);

        // A signature from some OTHER authority cannot be notarized either.
        ctx.expect(isDeveloperIdSigned(SIGNED.replace('Authority=Developer ID Application:', 'Authority=Apple Development:'))).toBe(false);
      },
    },
    {
      name: 'the report is read with stderr folded in, and a failing codesign is the answer',
      run: async (ctx) => {
        const commands = [];
        const report = await readCodesign('/tmp/App.app', (cmd) => {
          commands.push(cmd);
          return Promise.resolve(SIGNED);
        });

        // codesign writes its report to STDERR and exits 0, so a plain stdout
        // read comes back EMPTY and every app would look unsigned.
        ctx.expect(commands[0]).toContain('2>&1');
        ctx.expect(commands[0]).toContain('/tmp/App.app');
        ctx.expect(isDeveloperIdSigned(report)).toBe(true);

        // An unsigned app exits non-zero; the report rides in the rejection.
        const failed = await readCodesign('/tmp/App.app', () => Promise.reject(new Error(UNSIGNED_ERROR)));
        ctx.expect(failed).toContain('not signed at all');
        ctx.expect(isDeveloperIdSigned(failed)).toBe(false);
      },
    },
    // ── The staple and its PROOF (#891) ─────────────────────────────────────
    // Proof run one published an app no other Mac would open. Notarizing is
    // half the job: the ticket has to be stapled, and the staple has to be
    // read back, or an offline Mac still refuses.
    {
      name: 'stapling runs staple → validate → spctl, in that order, on the .app',
      run: async (ctx) => {
        const { run, commands } = fakeTools();

        await stapleAndProve({ filePath: '/tmp/App.app', kind: 'app', run });

        ctx.expect(commands.length).toBe(3);
        ctx.expect(commands[0]).toContain('xcrun stapler staple "/tmp/App.app"');
        ctx.expect(commands[1]).toContain('xcrun stapler validate "/tmp/App.app"');
        ctx.expect(commands[2]).toContain('spctl --assess --type execute -vv "/tmp/App.app"');
        // The verdict these tools write to stderr is the RUNNER's to capture
        // (notarize-tools.test.js), never a shell fold on the command.
      },
    },
    {
      name: 'a DMG is assessed as an OPENED image against its own signature',
      run: async (ctx) => {
        const { run, commands } = fakeTools({ 'spctl --assess': '/tmp/App.dmg: accepted\nsource=Notarized Developer ID' });

        await stapleAndProve({ filePath: '/tmp/App.dmg', kind: 'dmg', run });

        ctx.expect(commands[2]).toContain('spctl --assess --type open --context context:primary-signature -vv "/tmp/App.dmg"');
      },
    },
    {
      name: 'a REJECTED assessment throws: the release step never runs',
      run: async (ctx) => {
        // spctl exits non-zero and says so on stderr
        const rejected = fakeTools({ 'spctl --assess': new Error('/tmp/App.app: rejected\nsource=no usable signature') });
        await ctx.expect(() => stapleAndProve({ filePath: '/tmp/App.app', kind: 'app', run: rejected.run })).toThrow(/Gatekeeper refused/);

        // ...and so does a staple that never took, or a ticket that does not read back
        const unstapled = fakeTools({ 'stapler staple': new Error('The staple and validate action failed! Error 65.') });
        await ctx.expect(() => stapleAndProve({ filePath: '/tmp/App.app', kind: 'app', run: unstapled.run })).toThrow(/could not staple/);

        const unreadable = fakeTools({ 'stapler validate': new Error('The validate action failed! Error 65.') });
        await ctx.expect(() => stapleAndProve({ filePath: '/tmp/App.app', kind: 'app', run: unreadable.run })).toThrow(/carries no valid notarization ticket/);
      },
    },
    // ── The hook's own refusals (#891) ──────────────────────────────────────
    // Both of these used to be `logger.warn` + `return`, and BOTH of them were
    // hit on the run that shipped an unsigned app.
    {
      name: 'a mac build with no APPLE_* credentials THROWS instead of skipping',
      run: async (ctx) => {
        const prior = { key: process.env.APPLE_API_KEY, id: process.env.APPLE_API_KEY_ID, issuer: process.env.APPLE_API_ISSUER };
        delete process.env.APPLE_API_KEY;
        delete process.env.APPLE_API_KEY_ID;
        delete process.env.APPLE_API_ISSUER;

        try {
          await ctx.expect(() => notarizeHook({ electronPlatformName: 'darwin', appOutDir: '/tmp' })).toThrow(/APPLE_API_KEY/);
          // A non-mac leg is still the ONE legitimate skip
          ctx.expect(await notarizeHook({ electronPlatformName: 'win32', appOutDir: '/tmp' })).toBe(undefined);
        } finally {
          if (prior.key) process.env.APPLE_API_KEY = prior.key;
          if (prior.id) process.env.APPLE_API_KEY_ID = prior.id;
          if (prior.issuer) process.env.APPLE_API_ISSUER = prior.issuer;
        }
      },
    },
    {
      name: 'an ad-hoc signed .app THROWS instead of publishing unnotarized',
      run: async (ctx) => {
        const prior = { key: process.env.APPLE_API_KEY, id: process.env.APPLE_API_KEY_ID, issuer: process.env.APPLE_API_ISSUER };
        const keyFile = path.join(require('os').tmpdir(), `AuthKey_NOTARIZE_TEST.p8`);
        require('fs').writeFileSync(keyFile, 'fixture-key');
        process.env.APPLE_API_KEY = keyFile;
        process.env.APPLE_API_KEY_ID = 'TESTKEYID1';
        process.env.APPLE_API_ISSUER = 'issuer-uuid';

        try {
          const { run } = fakeTools({ 'codesign -dv': ADHOC });
          await ctx.expect(() => notarizeHook(
            { electronPlatformName: 'darwin', appOutDir: '/tmp', packager: { appInfo: { productFilename: 'App' } } },
            { run },
          )).toThrow(/is NOT Developer ID signed/);
        } finally {
          require('fs').rmSync(keyFile, { force: true });
          for (const [name, value] of [['APPLE_API_KEY', prior.key], ['APPLE_API_KEY_ID', prior.id], ['APPLE_API_ISSUER', prior.issuer]]) {
            if (value) process.env[name] = value;
            else delete process.env[name];
          }
        }
      },
    },
  ],
});
