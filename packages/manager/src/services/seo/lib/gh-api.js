/**
 * GitHub operations for the seo service, over the `gh` CLI. Kept separate
 * from the github service's GitHubAPI class because parasite repos need a
 * per-item auth model: every method takes an optional token (the content
 * item's author identity — a GH_TOKEN env override for that one call),
 * falling back to the default `gh` auth. Tests fake this surface
 * method-for-method via context.seoApi.
 */
const { execSync } = require('node:child_process');

/**
 * Build execSync options with an optional GH_TOKEN override.
 */
function ghOptions(token) {
  const opts = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

  if (token) {
    opts.env = { ...process.env, GH_TOKEN: token };
  }

  return opts;
}

function gh(args, token, input) {
  const opts = ghOptions(token);
  if (input !== undefined) {
    opts.input = input;
  }
  try {
    return execSync(`gh ${args}`, opts).trim();
  } catch (error) {
    const stderr = error.stderr?.toString() || error.message;
    throw new Error(`gh command failed: ${stderr.trim()}`);
  }
}

function ghJson(args, token, input) {
  const result = gh(args, token, input);
  return result ? JSON.parse(result) : null;
}

/**
 * Escape a string for use inside double quotes in a shell command.
 */
function shellEscape(str) {
  return str.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

/**
 * Verify gh CLI is installed and authenticated (default auth — per-item
 * tokens are validated by their own API calls).
 */
function verifyGhCli() {
  try {
    execSync('gh --version', { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    throw new Error('GitHub CLI (gh) is not installed. Install from: https://cli.github.com/');
  }

  try {
    execSync('gh auth status', { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    throw new Error('GitHub CLI is not authenticated. Run: gh auth login (or set GH_TOKEN in the brand .env)');
  }
}

/** Repo details, or null when it doesn't exist. */
function getRepo(slug, token) {
  try {
    return ghJson(`api repos/${slug}`, token);
  } catch (error) {
    if (error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

/** Create a public repo with an auto-init README. */
function createRepo(slug, description, token) {
  const desc = description ? ` --description "${shellEscape(description)}"` : '';
  gh(`repo create ${slug} --public --add-readme${desc}`, token);
}

/** Flat file tree of the main branch ([{ path, type }]); [] when unreadable (e.g. empty repo). */
function getTree(slug, token) {
  try {
    const tree = ghJson(`api repos/${slug}/git/trees/main?recursive=1`, token);
    return tree?.tree || [];
  } catch {
    return [];
  }
}

/** Contents-API file record ({ content: base64, sha }), or null when absent. */
function getContents(slug, path, token) {
  try {
    return ghJson(`api repos/${slug}/contents/${path}`, token);
  } catch (error) {
    if (error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

/** Create/update a file via the Contents API (body: message, content, sha?, author?, committer?). */
function putContents(slug, path, body, token) {
  return ghJson(`api repos/${slug}/contents/${path} -X PUT --input -`, token, JSON.stringify(body));
}

/** Delete a file via the Contents API (body: message, sha, author?, committer?). */
function deleteContents(slug, path, body, token) {
  return ghJson(`api repos/${slug}/contents/${path} -X DELETE --input -`, token, JSON.stringify(body));
}

/** PATCH repo settings from a JSON body (description, homepage, ...). */
function patchRepo(slug, fields, token) {
  return ghJson(`api repos/${slug} -X PATCH --input -`, token, JSON.stringify(fields));
}

/** Current topic names. */
function getTopics(slug, token) {
  const result = ghJson(`api repos/${slug}/topics`, token);
  return result?.names || [];
}

/** Replace the topic set. */
function putTopics(slug, names, token) {
  return ghJson(`api repos/${slug}/topics -X PUT --input -`, token, JSON.stringify({ names }));
}

/** Whether the authenticated (token) user has starred the repo. */
function isStarred(slug, token) {
  try {
    gh(`api user/starred/${slug} -X GET`, token);
    return true;
  } catch {
    return false;
  }
}

/** Star the repo as the authenticated (token) user. */
function starRepo(slug, token) {
  gh(`api user/starred/${slug} -X PUT`, token);
}

module.exports = {
  verifyGhCli,
  getRepo,
  createRepo,
  getTree,
  getContents,
  putContents,
  deleteContents,
  patchRepo,
  getTopics,
  putTopics,
  isStarred,
  starRepo,
};
