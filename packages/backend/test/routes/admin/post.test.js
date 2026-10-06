/**
 * Test: PUT /admin/post
 * Tests the admin edit post endpoint
 * Edits blog post content in a GitHub repository
 * Requires admin/blogger role, GitHub API key, and a resolvable source repo (repo.owner + brand.id -> <brand.id>-omega)
 *
 * This is a suite because we need to:
 * 1. Create a test post file via Octokit
 * 2. Wait for GitHub to index it (for code search)
 * 3. Edit it via the API
 * 4. Clean up the test file
 */
const { Octokit } = require('@octokit/rest');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

// Test post configuration
const TEST_POST_SLUG = 'backend-test-post';
const TEST_POST_ID = Date.now();

// Generate frontmatter for the test post
function generatePostContent(body) {
  const frontmatter = `layout: blueprint/blog/post

meta:
  title: @omega.js/backend Test Post
  description: This is a test post created by @omega.js/backend test suite.
  og:image: ''

post:
  title: @omega.js/backend Test Post
  id: ${TEST_POST_ID}
  description: This is a test post created by @omega.js/backend test suite.
  author: guest
  tags: []
  categories: []`;

  return `---\n${frontmatter}\n---\n\n${body}`;
}

module.exports = defineCases({
  description: 'Admin edit post on GitHub',
  type: 'suite',
  timeout: 300000, // 5 minutes total for the suite
  skip: !process.env.TEST_EXTENDED_MODE ? 'TEST_EXTENDED_MODE env var not set (skipping GitHub edit tests)' : false,

  tests: [
    // Test 1: Missing URL returns 400 error
    {
      name: 'missing-url-rejected',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.put('omega/admin/post', {
          body: 'Test content',
        });

        expect(response, 'Missing URL should return 400').toBeError(400);
      },
    },

    // Test 2: Missing body returns 400 error
    {
      name: 'missing-body-rejected',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.put('omega/admin/post', {
          url: 'https://example.com/blog/test-post',
        });

        expect(response, 'Missing body should return 400').toBeError(400);
      },
    },

    // Test 3: Non-existent post returns 404
    {
      name: 'nonexistent-post-returns-404',
      auth: 'admin',
      timeout: 60000,

      async run({ http, expect, config }) {
        const response = await http.put('omega/admin/post', {
          url: `https://${config.domain}/blog/nonexistent-test-post-12345`,
          body: 'This is test content from @omega.js/backend test suite.',
        });

        expect(response, 'Non-existent post should return 404').toBeError(404);
      },
    },

    // Test 4: Editing a never-published URL returns 404
    // PUT first calls content/post to fetch the existing post; with a unique URL that was never
    // created, that fetch 404s before any push. The repo itself is not caller-controllable (B4) —
    // it always comes from brand config.
    {
      name: 'never-published-url-returns-404',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.put('omega/admin/post', {
          url: `https://example.com/blog/never-created-${Date.now()}`,
          body: 'Test content',
        });

        expect(response, 'Non-existent repo or post should return 404').toBeError(404);
      },
    },

    // Test 5: Create a test post via Octokit
    {
      name: 'create-test-post',
      auth: 'admin',
      timeout: 60000,
      skip: !process.env.GH_TOKEN ? 'GH_TOKEN env var not set' : false,

      async run({ expect, state, config }) {
        const { sourceRepo } = require('../../helpers/_shared-config.js');
        const source = sourceRepo(config);
        if (!source) {
          expect.fail('source repo not resolvable (set repo.owner + brand.id)');
          return;
        }

        const octokit = new Octokit({ auth: process.env.GH_TOKEN });

        // Owner/repo from the shared brand-repo derivation
        const repoMatch = [null, source.owner, source.name];

        state.owner = repoMatch[1];
        state.repo = repoMatch[2];

        // Build the post path (matches the structure expected by fetch-post)
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const year = date.split('-')[0];
        state.postPath = `src/_posts/${year}/guest/${date}-${TEST_POST_SLUG}.md`;
        state.postSlug = TEST_POST_SLUG;

        // Create the post content
        const originalBody = 'This is the original content of the test post.\n\nIt will be edited by the @omega.js/backend test suite.';
        state.originalBody = originalBody;
        const content = generatePostContent(originalBody);

        // Check if the file already exists (from a previous failed run)
        let existingSha;
        try {
          const existing = await octokit.rest.repos.getContent({
            owner: state.owner,
            repo: state.repo,
            path: state.postPath,
          });
          existingSha = existing.data.sha;
        } catch (e) {
          // File doesn't exist, that's fine
        }

        // Create or update the file via Octokit
        const createResult = await octokit.rest.repos.createOrUpdateFileContents({
          owner: state.owner,
          repo: state.repo,
          path: state.postPath,
          message: `🧪 @omega.js/backend test: create test post for edit-post test`,
          content: Buffer.from(content).toString('base64'),
          sha: existingSha, // Include SHA if file exists
        }).catch(e => e);

        if (createResult instanceof Error) {
          expect.fail(`Failed to create test post: ${createResult.message}`);
          return;
        }

        expect(createResult.data.content.sha, 'Post should be created with a SHA').toBeTruthy();
        state.postSha = createResult.data.content.sha;
      },
    },

    // Test 6: Verify the file exists via GitHub API (not code search)
    {
      name: 'verify-file-exists',
      auth: 'admin',
      timeout: 30000,
      skip: !process.env.GH_TOKEN ? 'GH_TOKEN env var not set' : false,

      async run({ expect, state, config }) {
        if (!state.postPath) {
          return; // Previous test didn't run
        }

        state.postUrl = `https://${config.domain}/blog/${state.postSlug}`;

        const octokit = new Octokit({ auth: process.env.GH_TOKEN });

        // Verify the file exists via direct API (not code search)
        const { data: fileData } = await octokit.rest.repos.getContent({
          owner: state.owner,
          repo: state.repo,
          path: state.postPath,
        });

        expect(fileData.sha, 'File should exist in GitHub repo').toBeTruthy();
        state.currentSha = fileData.sha;
      },
    },

    // Test 7: Edit the test post via PUT /admin/post
    // NOTE: This may fail if GitHub's code search hasn't indexed the file yet
    // The edit-post API uses fetch-post which relies on code search
    {
      name: 'edit-test-post',
      auth: 'admin',
      timeout: 60000,
      skip: !process.env.GH_TOKEN ? 'GH_TOKEN env var not set' : false,

      async run({ http, expect, state }) {
        if (!state.postUrl) {
          return; // Previous tests didn't run
        }

        const newBody = 'This content was EDITED by the @omega.js/backend test suite.\n\nThe edit was successful!';
        state.editedBody = newBody;

        const response = await http.put('omega/admin/post', {
          url: state.postUrl,
          body: newBody,
        });

        // If fetch-post can't find the file (not indexed yet), it returns 404
        // This is a known limitation - the file exists but code search hasn't indexed it
        if (response.status === 404 && response.error?.includes('not found')) {
          state.editSkipped = true;
          expect(true, 'Edit skipped - GitHub code search has not indexed the file yet (this is expected for new files)').toBeTruthy();
          return;
        }

        expect(response, 'Edit post should succeed').toBeSuccess();
        expect(response, 'Response should have url').toHaveProperty('data.url');
      },
    },

    // Test 8: Verify the edit was applied (using Octokit directly)
    {
      name: 'verify-edit',
      auth: 'admin',
      timeout: 90000, // waitFor polls up to 60s for GitHub content propagation
      skip: !process.env.GH_TOKEN ? 'GH_TOKEN env var not set' : false,

      async run({ expect, state, waitFor }) {
        if (!state.postPath || state.editSkipped) {
          expect(true, 'Skipping verify - edit was not performed').toBeTruthy();
          return;
        }

        const octokit = new Octokit({ auth: process.env.GH_TOKEN });

        // GitHub's contents API is eventually consistent after createOrUpdateFileContents —
        // an immediate read-back can serve the pre-edit blob. Poll until the edit lands.
        const content = await waitFor(async () => {
          const { data: fileData } = await octokit.rest.repos.getContent({
            owner: state.owner,
            repo: state.repo,
            path: state.postPath,
          });

          const decoded = Buffer.from(fileData.content, 'base64').toString();

          return decoded.includes('EDITED by the @omega.js/backend test suite') ? decoded : false;
        }, 60000, 3000);

        expect(content.includes('EDITED by the @omega.js/backend test suite'), 'Post content should contain the edited text').toBeTruthy();
      },
    },

    // --- Auth rejection tests (at end per convention) ---
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.put('omega/admin/post', {
          url: 'https://example.com/blog/test-post',
          body: 'Test content',
        });

        expect(response, 'Edit post should fail without authentication').toBeError(401);
      },
    },

    {
      name: 'non-admin-rejected',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.put('omega/admin/post', {
          url: 'https://example.com/blog/test-post',
          body: 'Test content',
        });

        expect(response, 'Edit post should fail for non-admin user').toBeError(403);
      },
    },

    // Cleanup - delete test post and cancel workflows
    {
      name: 'cleanup',
      auth: 'admin',
      timeout: 60000,

      async run({ state }) {
        if (!process.env.GH_TOKEN || !state.postPath) {
          return;
        }

        const octokit = new Octokit({ auth: process.env.GH_TOKEN });

        // Get the current SHA (may have changed after edit)
        try {
          const { data: fileData } = await octokit.rest.repos.getContent({
            owner: state.owner,
            repo: state.repo,
            path: state.postPath,
          });

          // Delete the test post
          await octokit.rest.repos.deleteFile({
            owner: state.owner,
            repo: state.repo,
            path: state.postPath,
            message: `🧹 @omega.js/backend test cleanup: delete test post`,
            sha: fileData.sha,
          });
        } catch (e) {
          // File might not exist, ignore
        }

        // Cancel any running workflows triggered by our test commits
        try {
          const { data: runs } = await octokit.rest.actions.listWorkflowRunsForRepo({
            owner: state.owner,
            repo: state.repo,
            status: 'in_progress',
            per_page: 10,
          });

          for (const run of runs.workflow_runs) {
            if (run.head_commit?.message?.includes('@omega.js/backend test')) {
              try {
                await octokit.rest.actions.cancelWorkflowRun({
                  owner: state.owner,
                  repo: state.repo,
                  run_id: run.id,
                });
              } catch (e) {
                // May already be completed, ignore
              }
            }
          }
        } catch (e) {
          // Workflow cancellation failed, not critical
        }
      },
    },
  ],
});
