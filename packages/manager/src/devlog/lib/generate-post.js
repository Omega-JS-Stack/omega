/**
 * Devlog generate stage — group the collected commits into a per-repo digest
 * (Ghostii's sourceContent), assemble the brief (description), and have the
 * platform write the article. Project URLs go through Ghostii's `links`
 * param — its allocator assigns them to sections natively.
 */

const chalk = require('chalk').default;

const { writeArticle, blocksToPost, MAX_DESCRIPTION_LENGTH, MAX_SOURCE_CONTENT_LENGTH } = require('./ghostii.js');

/**
 * Group commits by repo and render the digest Ghostii works from (sourceContent).
 * Each repo header carries its project mapping so the writer knows which
 * product the work belongs to.
 *
 * @param {Array} commits - Collected commits
 * @param {object} projectMap - repoName → { project, url }
 * @returns {string} Digest text
 */
function buildDigest(commits, projectMap) {
  const byRepo = new Map();

  for (const commit of commits) {
    const key = `${commit.owner}/${commit.repo}`;

    if (!byRepo.has(key)) {
      byRepo.set(key, []);
    }

    byRepo.get(key).push(commit);
  }

  const sections = [];

  for (const [fullName, repoCommits] of byRepo) {
    const [, repo] = fullName.split('/');
    const mapped = projectMap[repo];
    const { name, url } = resolveProject(repoCommits[0], projectMap);
    const label = mapped
      ? `${repo} — part of "${name}" (${url})`
      : `${repo} — project: ${name} (${url})`;

    sections.push(`## ${label}\n${repoCommits.map((c) => `- ${c.message}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Resolve a commit's repo to the best public link, in priority order:
 * brand-config product URL > GitHub repo homepage field > GitHub repo URL.
 *
 * @param {object} commit - A collected commit (carries owner/repo/homepage)
 * @param {object} projectMap - repoName → { project, url }
 * @returns {{ name: string, url: string }} Display name + link
 */
function resolveProject(commit, projectMap) {
  const mapped = projectMap[commit.repo];

  return {
    name: mapped ? mapped.project : commit.repo,
    url: mapped?.url
      || commit.homepage
      || `https://github.com/${commit.owner}/${commit.repo}`,
  };
}

/**
 * Collect the unique project links actually touched by the commits, so the
 * brief and Ghostii's `links` param only carry URLs grounded in real work.
 *
 * @param {Array} commits - Collected commits
 * @param {object} projectMap - repoName → { project, url }
 * @returns {Array<{ name: string, url: string }>} Unique projects
 */
function collectProjectLinks(commits, projectMap) {
  const seen = new Map();

  for (const commit of commits) {
    const { name, url } = resolveProject(commit, projectMap);

    if (!seen.has(url)) {
      seen.set(url, { name, url });
    }
  }

  return [...seen.values()];
}

/**
 * Build the Ghostii brief (description). Hard 2KB cap — assembled in priority
 * order (task > blocklist > voice) so only the voice section ever gets truncated.
 *
 * @param {object} params - { brandConfig, days }
 * @returns {string} Brief within Ghostii's description cap
 */
function buildBrief({ brandConfig, days }) {
  const { brand, devlog } = brandConfig;
  // Voice: the newsletter generator's instructions blob when the brand's
  // omega.json5 carries one (it's @omega.js/backend data, not manager config — presence is
  // genuinely uncertain), else the brand description.
  const voice = brandConfig.marketing?.newsletter?.content?.[0]?.instructions
    || brand.description
    || '';

  const task = `First-person devlog post for ${brand.name} (${brand.url}): the founder's honest recap of the last ${days} days of real development work across his product portfolio. Base the article ONLY on the commit digest provided as source content — never invent work that isn't there. Weave a narrative (what shipped, why it matters, lessons learned); skip trivial chores like version bumps and dependency updates.

Title style: short, punchy, and specific — like a git commit summary of the period's most interesting work (e.g. "Auth Round Trips and Quieter Cron Jobs"). Max ~8 words. NEVER use time-window phrasing ("Five Days of...", "A Week of...") — the post is dated already.`;

  const blocklist = devlog.excludeTopics.length
    ? `NEVER discuss, mention, or allude to: ${devlog.excludeTopics.join('; ')}.`
    : '';

  // Project URLs go through Ghostii's `links` param (its allocator assigns them
  // to sections natively) — keeping them out of the brief keeps it light enough
  // for the outline step's reasoning budget.
  const fixed = [task, blocklist].filter(Boolean).join('\n\n');
  // Cap the voice excerpt well below the 2KB description limit — a lean brief
  // keeps the outline step's reasoning budget in check.
  const remaining = Math.min(MAX_DESCRIPTION_LENGTH - fixed.length - '\n\nVoice: '.length, 600);

  if (remaining < 50) {
    console.log(`${chalk.yellow('⚠')} Brief is at Ghostii's 2KB cap — voice instructions dropped`);
    return fixed.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  return voice
    ? `${fixed}\n\nVoice: ${voice.slice(0, remaining)}`
    : fixed;
}

/**
 * Generate a devlog post via the configured platform (Ghostii).
 *
 * @param {object} params - { brandConfig, commits, projectMap, days, write? }
 *   (`write` is the article writer — tests inject a fake; prod uses Ghostii)
 * @returns {Promise<{title, slug, description, tags, categories, body, headerImageUrl}>}
 */
async function generatePost({ brandConfig, commits, projectMap, days, write = writeArticle }) {
  const { devlog } = brandConfig;

  if (devlog.platform !== 'ghostii') {
    throw new Error(`Unknown devlog.platform: ${devlog.platform} (only 'ghostii' is supported)`);
  }

  const digest = buildDigest(commits, projectMap);
  const projectLinks = collectProjectLinks(commits, projectMap);
  const brief = buildBrief({ brandConfig, days });

  if (digest.length > MAX_SOURCE_CONTENT_LENGTH) {
    console.log(`${chalk.yellow('⚠')} Digest is ${digest.length} chars — Ghostii only reads the first ${MAX_SOURCE_CONTENT_LENGTH} (later repos get cut)`);
  }

  const article = await write({
    brandConfig,
    description: brief,
    links: projectLinks.map((p) => p.url),
    sourceContent: digest,
    overrides: devlog.overrides,
  });

  // Prefer the structured blocks (clean title/body separation); fall back to
  // Ghostii's flat fields when blocks are absent.
  const post = blocksToPost(article.json);
  const title = post.title || article.title || '';
  const body = post.body || article.body || '';

  if (!title.trim() || !body.trim()) {
    throw new Error('Ghostii response missing title or body');
  }

  return {
    title: title.trim(),
    slug: slugify(title),
    description: (article.description || '').trim(),
    tags: Array.isArray(article.keywords) ? article.keywords : [],
    categories: Array.isArray(article.categories) ? article.categories : [],
    body: body.trim(),
    headerImageUrl: post.headerImageUrl || article.headerImageUrl || '',
  };
}

/**
 * Slugify a title: lowercase, alphanumerics + hyphens only.
 *
 * @param {string} input - Title text
 * @returns {string} URL slug
 */
function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { generatePost };
