/**
 * The quality hook (PostToolUse Write|Edit + Stop): an edited web surface
 * names the quality skills that own it, and Stop asks for the review.
 * Run: node --test scripts/agent-plugins-quality.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { ROOT, readJson, project } = require('./agent-plugins-fixtures');

const QUALITY_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'quality', 'run.sh');

// One script serves both events, so every call names the event it is playing.
const quality = (payload) => spawnSync(QUALITY_HOOK, {
  input: JSON.stringify(payload),
  encoding: 'utf8',
});

const edited = (dir, relative, session) => quality({
  hook_event_name: 'PostToolUse',
  session_id: session,
  tool_input: { file_path: path.join(dir, relative) },
});

const stopped = (session, stopHookActive) => quality({
  hook_event_name: 'Stop',
  session_id: session,
  stop_hook_active: Boolean(stopHookActive),
});

// `expect` is the calling case's.
const context = (expect, result) => {
  expect(result.status, `hook exited ${result.status}: ${result.stderr}`).toBe(0);
  if (!result.stdout) return '';
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};

let qualitySessions = 0;
const qualitySession = () => `quality-${process.pid}-${Date.now()}-${++qualitySessions}`;

module.exports = defineCases({
  type: 'group',
  description: 'agent-plugins-quality',
  tests: [
    {
      name: 'quality: each web surface asks for the skills that own it',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
        const table = [
          ['src/pages/index.html', ['omega:seo', 'omega:accessibility']],
          ['src/pages/blog/post.md', ['omega:seo', 'omega:accessibility']],
          ['core/_layouts/blueprint/index.html', ['omega:seo', 'omega:accessibility']],
          ['core/_includes/core/head.html', ['omega:seo', 'omega:accessibility']],
          ['themes/classy/_includes/frontend/sections/nav.html', ['omega:accessibility']],
          ['src/assets/css/main.scss', ['omega:accessibility', 'omega:brandcheck']],
          ['config/omega.json5', ['omega:brandcheck']],
        ];

        for (const [file, skills] of table) {
          const context2 = context(ctx.expect, edited(dir, file, qualitySession()));
          for (const skill of skills) {
            ctx.expect(context2, `${file} did not ask for ${skill}`).toMatch(new RegExp(skill));
          }
          ctx.expect(context2, `${file} is not named in the reminder`).toMatch(new RegExp(file.replace(/[/.]/g, '\\$&')));
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'quality: a non-web file is silent',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
        for (const quiet of ['src/lib/helper.js', 'README.md', 'test/build/x.test.js']) {
          ctx.expect(edited(dir, quiet, qualitySession()).stdout, `${quiet} was not silent`).toBe('');
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'quality: projects without @omega.js deps are never policed',
      run: (ctx) => {
        const dir = project({ name: 'somebody-else', dependencies: { react: '^19.0.0' } });
        ctx.expect(edited(dir, 'src/pages/index.html', qualitySession()).stdout).toBe('');
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'quality: a skill is named once per session, and the Stop pass still counts every file',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
        const session = qualitySession();
        ctx.expect(context(ctx.expect, edited(dir, 'src/pages/index.html', session))).toMatch(/omega:seo/);
        ctx.expect(edited(dir, 'src/pages/about.html', session).stdout, 'the second page re-asked').toBe('');

        const context2 = context(ctx.expect, stopped(session));
        ctx.expect(context2).toMatch(/2 web surface\(s\)/);
        ctx.expect(context2).toMatch(/index\.html/);
        ctx.expect(context2).toMatch(/about\.html/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'quality: Stop blocks once on edited surfaces, then lets the sign-off through',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
        const session = qualitySession();
        edited(dir, 'src/assets/css/main.scss', session);

        const blocked = JSON.parse(stopped(session).stdout);
        ctx.expect(blocked.decision).toBe('block');
        ctx.expect(blocked.reason).toMatch(/omega:quality/);
        ctx.expect(blocked.hookSpecificOutput.additionalContext).toMatch(/omega:accessibility, omega:brandcheck/);

        ctx.expect(stopped(session).stdout, 'the block repeated with nothing new edited').toBe('');
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'quality: a path with a space survives the Stop pass whole',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
        const session = qualitySession();
        const file = 'src/pages/case studies.html';
        ctx.expect(context(ctx.expect, edited(dir, file, session))).toMatch(/omega:seo/);

        const context2 = context(ctx.expect, stopped(session));
        ctx.expect(context2, 'the path was truncated at the space').toMatch(/case studies\.html/);
        // The skills line is parsed off the same record — a split path would land a
        // path fragment where a skill name belongs.
        const line = context2.split('\n').find((l) => l.startsWith('Before signing off'));
        const listed = line.match(/checklists in: (.*?)\./)[1].split(', ');
        ctx.expect(listed).toEqual(['omega:accessibility', 'omega:seo']);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'quality: Stop is silent with no web edit, and while a block is already active',
      run: (ctx) => {
        const clean = qualitySession();
        ctx.expect(stopped(clean).stdout).toBe('');

        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
        const session = qualitySession();
        edited(dir, 'src/pages/index.html', session);
        ctx.expect(stopped(session, true).stdout, 'blocked again inside its own block').toBe('');
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'quality: hooks.json wires the same script on PostToolUse Write|Edit and Stop',
      run: (ctx) => {
        const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
        const post = hooks.PostToolUse.find((h) => h.matcher === 'Write|Edit');
        ctx.expect(post, 'no PostToolUse Write|Edit entry').toBeTruthy();
        ctx.expect(post.hooks[0].command).toMatch(/hooks\/quality\/run\.sh/);
        ctx.expect(hooks.Stop[0].hooks[0].command).toMatch(/hooks\/quality\/run\.sh/);
      },
    },
  ],
});
