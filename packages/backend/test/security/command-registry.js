/**
 * Test: Command API name confinement (wave-2 B1)
 *
 * The legacy command API resolves `command` to a module path and require()s
 * it. Names are strictly colon-joined [a-z0-9_-] segments — anything that
 * could traverse (dots, slashes) must be rejected with a 400, never resolved.
 *
 * Every payload here carries a colon on purpose: the router only dispatches to
 * the legacy command API when the command contains one (colon-free values are
 * treated as a RESTful route and die earlier at schema resolution), so a
 * colon-free payload would never exercise the resolver under test.
 */
module.exports = {
  description: 'Command API rejects traversal and malformed command names',
  type: 'group',
  timeout: 30000,

  tests: [
    // The previous sanitizer stripped `../` in a single pass, which does not
    // handle overlapping sequences. This name is deliberately aimed at a module
    // that EXISTS (actions/api.js, two levels up from the command dir) — a name
    // pointing at a nonexistent path resolves to null either way and would pass
    // even against the old code, proving nothing. Do not retarget it.
    {
      name: 'traversal-strip-bypass-rejected',
      auth: 'none',

      async run({ http, assert }) {
        const response = await http.command('general:....//....//api', {});

        assert.isError(response, 400, `Strip-bypass traversal should be rejected with 400 (got success=${response.success} status=${response.status} error=${response.error})`);
      },
    },

    // Plain traversal segments
    {
      name: 'traversal-command-rejected',
      auth: 'none',

      async run({ http, assert }) {
        const response = await http.command('general:../../../../package', {});

        assert.isError(response, 400, `Traversal command should be rejected with 400 (got success=${response.success} status=${response.status} error=${response.error})`);
      },
    },

    // Slashes are not part of the command syntax — colon is the separator
    {
      name: 'slash-segment-command-rejected',
      auth: 'none',

      async run({ http, assert }) {
        const response = await http.command('general:sub/generate-uuid', {});

        assert.isError(response, 400, `Slash-bearing command should be rejected with 400 (got success=${response.success} status=${response.status} error=${response.error})`);
      },
    },

    // A dot can address a sibling file — not a valid command name either
    {
      name: 'dotted-command-rejected',
      auth: 'none',

      async run({ http, assert }) {
        const response = await http.command('general:generate-uuid.js', {});

        assert.isError(response, 400, `Dotted command should be rejected with 400 (got success=${response.success} status=${response.status} error=${response.error})`);
      },
    },

    // The legit colon form still resolves (the pattern must not over-block)
    {
      name: 'colon-command-still-works',
      auth: 'none',

      async run({ http, assert }) {
        const response = await http.command('general:generate-uuid', { version: '4' });

        assert.isSuccess(response, 'Valid colon-form command should still work');
        assert.hasProperty(response, 'data.uuid', 'Response should contain uuid');
      },
    },
  ],
};
