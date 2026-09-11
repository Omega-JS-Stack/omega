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

const { isDeveloperIdSigned, readCodesign } = require(path.join(__dirname, '..', '..', '..', 'hooks', 'notarize.js'));

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
  description: 'notarize: only a Developer ID signed app is submitted (#872)',
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
  ],
});
