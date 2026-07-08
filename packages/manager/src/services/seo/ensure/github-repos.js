/**
 * Ensure the brand's parasite SEO repos exist and match their template:
 * create the repo if missing (public, auto-init README), push generated +
 * static template files (content-compared — unchanged files are never
 * rewritten), delete stale non-template files, reconcile description/
 * homepage/topics, and star the repo as the author.
 *
 * Collision guardrail (critical safety, ported verbatim): a parasite repo
 * this handler created only ever contains the template's files, so before
 * ANY write the existing tree is inspected — more than MAX_STALE_FILES
 * non-template files means the configured name collides with a REAL repo,
 * and the item errors without touching anything. Never reuse a real
 * repo's name for a parasite entry.
 *
 * Per-item author identity: author.token (`env:VAR` or literal) overrides
 * the gh auth for that item's API calls; author.git rides the Contents
 * API commits as author/committer.
 */
const chalk = require('chalk').default;

const { loadTemplate } = require('../templates/index.js');

/**
 * Maximum non-template ("stale") files tolerated before the handler
 * refuses to manage the repo — the cap that stops a name collision from
 * overwriting or wiping a real project. Legit parasite repos sit at 0–2
 * stale files after a template change.
 */
const MAX_STALE_FILES = 10;

/**
 * Resolve an author token config value (`env:VAR_NAME` reads process.env).
 */
function resolveToken(tokenConfig) {
  if (!tokenConfig) {
    return null;
  }

  if (tokenConfig.startsWith('env:')) {
    const envVar = tokenConfig.slice(4);
    const value = process.env[envVar];

    if (!value) {
      console.log(`        ${chalk.yellow('⚠')} Token env var ${envVar} is not set — using default gh auth`);
      return null;
    }

    return value;
  }

  return tokenConfig;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Poll for the repo after creation — `gh repo create` can silently create
 * under the authenticated user when the owner is a user account the token
 * doesn't control, so the caller fails loudly when this returns null.
 */
async function waitForRepo(api, slug, token, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const repo = await api.getRepo(slug, token);
    if (repo) {
      return repo;
    }
    if (i < attempts - 1) {
      await sleep(1500);
    }
  }
  return null;
}

/**
 * Reconcile one content item to its repo. Returns the item status:
 * 'created' | 'updated' | 'synced' | 'planned'.
 */
async function reconcileItem(api, slug, org, item, brandConfig, token, dryRun) {
  let repo = await api.getRepo(slug, token);
  let created = false;

  if (!repo) {
    const template = loadTemplate(item.template || 'developer-tool');
    if (dryRun) {
      console.log(`        ${chalk.cyan('[DRY RUN]')} Would create repo + push ${template.files.length} files`);
      return 'planned';
    }
    await api.createRepo(slug, item.description || '', token);
    repo = await waitForRepo(api, slug, token);
    if (!repo) {
      throw new Error(
        `repo not created at ${slug} — is "${org}" an org (or user) this token can create repos in? `
        + `it may have been created under the authenticated account instead`,
      );
    }
    created = true;
  }

  const template = loadTemplate(item.template || 'developer-tool');
  const data = { ...item, org, brand: brandConfig.brand };
  const templatePaths = new Set(template.files.map((f) => f.path));

  // Collision guard: inspect the tree BEFORE modifying anything
  const tree = await api.getTree(slug, token);
  const staleFiles = tree.filter((t) => t.type === 'blob' && !templatePaths.has(t.path));

  if (staleFiles.length > MAX_STALE_FILES) {
    throw new Error(
      `refusing to manage: ${staleFiles.length} non-template files exceed cap of ${MAX_STALE_FILES} `
      + `— this looks like a real repo with a name collision, not a parasite repo we created`,
    );
  }

  let pushed = 0;
  let unchanged = 0;
  let deleted = 0;
  let planned = 0;

  // Push template files (content-compared; unchanged files skipped)
  for (const file of template.files) {
    const content = file.generate ? file.generate(data) : file.content;

    const current = await api.getContents(slug, file.path, token);
    if (current) {
      const existing = Buffer.from(current.content, 'base64').toString();
      if (existing === content) {
        unchanged++;
        continue;
      }
    }

    if (dryRun) {
      planned++;
      continue;
    }

    const body = {
      message: current ? `Update ${file.path}` : `Add ${file.path}`,
      content: Buffer.from(content).toString('base64'),
    };
    if (current) {
      body.sha = current.sha;
    }
    if (item.author?.git) {
      body.author = item.author.git;
      body.committer = item.author.git;
    }

    await api.putContents(slug, file.path, body, token);
    pushed++;
  }

  // Delete the (few, guardrail-capped) stale files
  for (const stale of staleFiles) {
    if (dryRun) {
      planned++;
      continue;
    }

    const meta = await api.getContents(slug, stale.path, token);
    const body = { message: `Remove ${stale.path}`, sha: meta.sha };
    if (item.author?.git) {
      body.author = item.author.git;
      body.committer = item.author.git;
    }

    await api.deleteContents(slug, stale.path, body, token);
    deleted++;
  }

  if (dryRun && planned > 0) {
    console.log(`        ${chalk.cyan('[DRY RUN]')} Files: ${planned} would change, ${unchanged} unchanged`);
  } else if (pushed + deleted > 0) {
    console.log(`        Files: ${pushed} pushed, ${unchanged} unchanged, ${deleted} deleted`);
  }

  // Repo settings — normalized compare (the API returns null for empty
  // fields; omega-manager compared null !== '' and re-PATCHed every run)
  const description = item.description || '';
  const homepage = item.cta?.platform || item.cta?.url || brandConfig.brand?.url || '';
  if ((repo.description || '') !== description || (repo.homepage || '') !== homepage) {
    if (dryRun) {
      console.log(`        ${chalk.cyan('[DRY RUN]')} Would update description/homepage`);
      planned++;
    } else {
      await api.patchRepo(slug, { description, homepage }, token);
      pushed++;
    }
  }

  // Topics — order-insensitive compare
  if (item.topics?.length) {
    const current = await api.getTopics(slug, token);
    if ([...current].sort().join(',') !== [...item.topics].sort().join(',')) {
      if (dryRun) {
        console.log(`        ${chalk.cyan('[DRY RUN]')} Would set topics: ${item.topics.join(', ')}`);
        planned++;
      } else {
        await api.putTopics(slug, item.topics, token);
        console.log(`        Topics: ${item.topics.join(', ')}`);
        pushed++;
      }
    }
  }

  // Star as the author (token) user
  if (!(await api.isStarred(slug, token))) {
    if (dryRun) {
      planned++;
    } else {
      await api.starRepo(slug, token);
      pushed++;
    }
  }

  if (created) return 'created';
  if (dryRun) return planned > 0 ? 'planned' : 'synced';
  return pushed + deleted > 0 ? 'updated' : 'synced';
}

module.exports = async (context) => {
  const { seoApi: api, seoContent: content, brandConfig } = context;
  const dryRun = context.options?.dryRun || false;

  const defaultOrg = brandConfig.github?.org;
  const results = [];

  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    const org = item.org || defaultOrg;
    const name = item.name;

    if (!org || !name) {
      console.log(`      ${chalk.red('✗')} [${i + 1}/${content.length}] Missing org or name — skipping`);
      results.push({ repo: `${org || '?'}/${name || '?'}`, status: 'error', error: 'missing org or name (set item.org or github.org)' });
      continue;
    }

    const slug = `${org}/${name}`;
    console.log(`      [${i + 1}/${content.length}] ${chalk.cyan(slug)}`);

    try {
      const token = resolveToken(item.author?.token);
      const status = await reconcileItem(api, slug, org, item, brandConfig, token, dryRun);
      console.log(`        ${chalk.green('✓')} ${status}`);
      results.push({ repo: slug, status });
    } catch (error) {
      console.log(`        ${chalk.red('✗')} ${error.message}`);
      results.push({ repo: slug, status: 'error', error: error.message });
    }
  }

  const counts = {};
  for (const result of results) {
    counts[result.status] = (counts[result.status] || 0) + 1;
  }
  console.log(`      Summary: ${results.length} repos — ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);

  const failed = results.filter((r) => r.status === 'error');
  const output = { githubRepos: { repos: results, ...counts } };

  // Item failures surface as a service error (omega-manager swallowed them
  // into a success) — items are independent, so the loop still ran them all
  if (failed.length > 0) {
    return { output, status: 'error', error: `${failed.length} repo(s) failed: ${failed.map((r) => r.repo).join(', ')}` };
  }

  return { output };
};
