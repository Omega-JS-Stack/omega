// The release task's verdict on a build that uploaded NOTHING
// ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
//
// electron-builder's `build()` promise resolves with the LOCAL artifact paths
// whether or not a byte reached the publish provider, so every leg of run
// 34729947722 printed `Released 4 artifact(s)` while electron-publish had
// logged `skipped publishing` for each of them
// (`reason=existing release published more than 2 hours ago tag=v0.0.1`). A
// release that uploaded nothing is a failed release, and the only report of the
// skip is electron-builder's own logger, so the task reads it there.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const RELEASE_TASK = path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'release.js');

// The fields electron-publish's gitHubPublisher carries on both warnings.
const PUBLISH_FIELDS = { tag: 'v0.0.1', reason: 'existing release published more than 2 hours ago' };

// A stand-in for builder-util's `log`: a Logger whose `warn(fields, message)`
// takes the two shapes the real one does, recording what it was handed.
function fakeBuilderLog() {
  const seen = [];
  return {
    seen,
    warn(messageOrFields, message) {
      seen.push(message === undefined ? messageOrFields : message);
    },
  };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'release task (#891): a skipped upload is a failed release, never a "Released N artifact(s)" line',
  tests: [
    {
      name: 'every skipped publish is recorded off the build logger, with its reason and tag',
      run: async (ctx) => {
        const { recordSkippedPublishes } = require(RELEASE_TASK);
        const log = fakeBuilderLog();
        const original = log.warn;

        const { result, skips } = await recordSkippedPublishes(log, async () => {
          log.warn(PUBLISH_FIELDS, 'GitHub release not created');
          log.warn({ file: 'App-0.0.1.dmg', ...PUBLISH_FIELDS }, 'skipped publishing');
          log.warn({ file: 'App-0.0.1-mac.zip', ...PUBLISH_FIELDS }, 'skipped publishing');
          log.warn('cannot compute hash of the pending file');
          return ['/tmp/release/App-0.0.1.dmg', '/tmp/release/App-0.0.1-mac.zip'];
        });

        ctx.expect(result.length).toBe(2);
        ctx.expect(skips.length).toBe(3);
        ctx.expect(skips.map((skip) => skip.file).filter(Boolean)).toEqual(['App-0.0.1.dmg', 'App-0.0.1-mac.zip']);
        ctx.expect(skips[0].reason).toBe(PUBLISH_FIELDS.reason);
        ctx.expect(skips[0].tag).toBe('v0.0.1');

        // The build's own logging still reaches the logger, and the wrapper is
        // gone the moment the build settles.
        ctx.expect(log.seen.length).toBe(4);
        ctx.expect(log.warn).toBe(original);
      },
    },
    {
      name: 'the wrapper restores the logger even when the build throws',
      run: async (ctx) => {
        const { recordSkippedPublishes } = require(RELEASE_TASK);
        const log = fakeBuilderLog();
        const original = log.warn;

        let thrown = null;
        try {
          await recordSkippedPublishes(log, async () => { throw new Error('electron-builder exploded'); });
        } catch (error) {
          thrown = error;
        }

        ctx.expect(thrown.message).toBe('electron-builder exploded');
        ctx.expect(log.warn).toBe(original);
      },
    },
    {
      name: 'a recorded skip fails the release naming the reason, the tag and the fix',
      run: (ctx) => {
        const { skippedUploadError } = require(RELEASE_TASK);
        const skips = [
          { message: 'GitHub release not created', ...PUBLISH_FIELDS },
          { message: 'skipped publishing', file: 'App-0.0.1.dmg', ...PUBLISH_FIELDS },
        ];

        const error = skippedUploadError(skips);
        ctx.expect(error instanceof Error).toBe(true);
        ctx.expect(error.message).toContain('existing release published more than 2 hours ago');
        ctx.expect(error.message).toContain('v0.0.1');
        ctx.expect(error.message).toContain('App-0.0.1.dmg');
        ctx.expect(error.message).toContain('Bump the version in package.json');
      },
    },
    {
      name: 'a build that skipped nothing is the release it always was',
      run: (ctx) => {
        const { skippedUploadError } = require(RELEASE_TASK);
        ctx.expect(skippedUploadError([])).toBeNull();
      },
    },
  ],
});
