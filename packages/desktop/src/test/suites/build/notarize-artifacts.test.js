// The DMG hook: artifactBuildCompleted notarizes, staples and PROVES each disk
// image BEFORE electron-builder uploads it
// ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
//
// The ticket the afterSign hook staples to the .app rides INSIDE the image, so
// a downloaded .dmg is assessed on its own and an unstapled one is refused on an
// offline Mac. And the hook has to run per artifact: `afterAllArtifactBuild`
// fires after every upload is queued, so run 34738410986 published a signed
// and notarized image that carried no staple. Offline by construction here:
// `xcrun` and `spctl` are a fake runner injected through the hook's own option,
// never a global.

const fs = require('fs');
const os = require('os');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const notarizeArtifacts = require(path.join(__dirname, '..', '..', '..', 'hooks', 'notarize-artifacts.js'));

const ACCEPTED = {
  'notarytool submit': '  status: Accepted\n  message: Successfully received submission info',
  'stapler staple': 'The staple and validate action worked!',
  'stapler validate': 'The validate action worked!',
  'spctl --assess': '/tmp/App.dmg: accepted\nsource=Notarized Developer ID',
};

function fakeTools(overrides = {}) {
  const commands = [];
  const answers = { ...ACCEPTED, ...overrides };

  const run = async (command) => {
    commands.push(command);
    const key = Object.keys(answers).find((needle) => command.includes(needle));
    const answer = key ? answers[key] : '';
    if (answer instanceof Error) throw answer;
    return answer;
  };

  return { run, commands };
}

// The credentials the hook needs, restored after each case.
function withCredentials(body) {
  const prior = {
    APPLE_API_KEY: process.env.APPLE_API_KEY,
    APPLE_API_KEY_ID: process.env.APPLE_API_KEY_ID,
    APPLE_API_ISSUER: process.env.APPLE_API_ISSUER,
  };
  const keyFile = path.join(os.tmpdir(), 'AuthKey_ARTIFACTS_TEST.p8');
  fs.writeFileSync(keyFile, 'fixture-key');
  process.env.APPLE_API_KEY = keyFile;
  process.env.APPLE_API_KEY_ID = 'TESTKEYID1';
  process.env.APPLE_API_ISSUER = 'issuer-uuid';

  const restore = () => {
    fs.rmSync(keyFile, { force: true });
    for (const [name, value] of Object.entries(prior)) {
      if (value) process.env[name] = value;
      else delete process.env[name];
    }
  };

  return Promise.resolve(body(keyFile)).finally(restore);
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'notarize-artifacts: every DMG is notarized, stapled and proved before its upload (#891)',
  tests: [
    {
      name: 'a .dmg artifact is submitted, stapled, validated and assessed; other artifacts are ignored',
      run: (ctx) => withCredentials(async (keyFile) => {
        const { run, commands } = fakeTools();

        // electron-builder calls the hook once per artifact, with that
        // artifact's `file`, before it queues the upload.
        for (const file of ['/tmp/App-1.0.0.dmg', '/tmp/App-1.0.0-mac.zip', '/tmp/latest-mac.yml']) {
          await notarizeArtifacts({ file }, { run });
        }

        ctx.expect(commands.length).toBe(4);
        ctx.expect(commands[0]).toContain('xcrun notarytool submit "/tmp/App-1.0.0.dmg"');
        ctx.expect(commands[0]).toContain(`--key "${keyFile}" --key-id "TESTKEYID1" --issuer "issuer-uuid" --wait`);
        ctx.expect(commands[1]).toContain('xcrun stapler staple "/tmp/App-1.0.0.dmg"');
        ctx.expect(commands[2]).toContain('xcrun stapler validate "/tmp/App-1.0.0.dmg"');
        ctx.expect(commands[3]).toContain('spctl --assess --type open --context context:primary-signature -vv "/tmp/App-1.0.0.dmg"');
        // The .zip and the update feed are never submitted
        ctx.expect(commands.some((command) => command.includes('.zip') || command.includes('.yml'))).toBe(false);
      }),
    },
    {
      name: 'a non-DMG artifact is a no-op: the linux and windows legs never reach a tool',
      run: async (ctx) => {
        const { run, commands } = fakeTools();

        await notarizeArtifacts({ file: '/tmp/App.AppImage' }, { run });
        await notarizeArtifacts({ file: '/tmp/App.exe' }, { run });
        ctx.expect(commands).toEqual([]);
      },
    },
    {
      name: 'a rejected submission throws, so the artifact is never uploaded',
      run: (ctx) => withCredentials(async () => {
        const invalid = fakeTools({ 'notarytool submit': '  status: Invalid\n  message: Package Invalid' });
        await ctx.expect(() => notarizeArtifacts({ file: '/tmp/App.dmg' }, { run: invalid.run }))
          .toThrow(/notarization of \/tmp\/App\.dmg was not accepted/);
        // Nothing was stapled onto an artifact Apple refused
        ctx.expect(invalid.commands.length).toBe(1);

        const refused = fakeTools({ 'spctl --assess': new Error('/tmp/App.dmg: rejected') });
        await ctx.expect(() => notarizeArtifacts({ file: '/tmp/App.dmg' }, { run: refused.run }))
          .toThrow(/Gatekeeper refused/);
      }),
    },
    {
      name: 'a DMG with no APPLE_* credentials throws instead of shipping unnotarized',
      run: async (ctx) => {
        const prior = { key: process.env.APPLE_API_KEY, id: process.env.APPLE_API_KEY_ID, issuer: process.env.APPLE_API_ISSUER };
        delete process.env.APPLE_API_KEY;
        delete process.env.APPLE_API_KEY_ID;
        delete process.env.APPLE_API_ISSUER;

        try {
          const { run } = fakeTools();
          await ctx.expect(() => notarizeArtifacts({ file: '/tmp/App.dmg' }, { run })).toThrow(/APPLE_API_KEY/);
        } finally {
          if (prior.key) process.env.APPLE_API_KEY = prior.key;
          if (prior.id) process.env.APPLE_API_KEY_ID = prior.id;
          if (prior.issuer) process.env.APPLE_API_ISSUER = prior.issuer;
        }
      },
    },
  ],
});
