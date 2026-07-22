/**
 * GitHub API client — omega-manager's gh-CLI wrapper, trimmed to the
 * brand-monorepo surface (one repo per brand: org profile, repo settings,
 * Pages). Old-world methods (template creation, cloning, GitHub Desktop)
 * ride the onboarding/company-mode ports.
 *
 * Uses the `gh` CLI for all operations. Requires `gh` installed and
 * authenticated — `gh auth login`, or a GH_TOKEN/GITHUB_TOKEN in the brand
 * .env (loaded before services run; gh honors both env vars).
 *
 * Every invocation is execFileSync with an argv array — no shell, so
 * brand-config values (descriptions, homepages) can never inject commands.
 */

const { execFileSync } = require('node:child_process');

class GitHubAPI {
  constructor() {
    this.verifyGhCli();
  }

  /**
   * Verify gh CLI is installed and authenticated
   */
  verifyGhCli() {
    try {
      execFileSync('gh', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
    } catch {
      throw new Error('GitHub CLI (gh) is not installed. Install from: https://cli.github.com/');
    }

    try {
      execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: 'pipe' });
    } catch {
      throw new Error('GitHub CLI is not authenticated. Run: gh auth login (or set GH_TOKEN in the brand .env)');
    }
  }

  /**
   * Run a gh CLI command (argv array, no shell) and return trimmed stdout
   */
  runCommand(args, options = {}) {
    try {
      const result = execFileSync('gh', args, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        ...options,
      });
      return result.trim();
    } catch (error) {
      const stderr = error.stderr?.toString() || error.message;
      throw new Error(`gh command failed: ${stderr}`);
    }
  }

  /**
   * Run a gh CLI command and return parsed JSON
   */
  runJsonCommand(args, options = {}) {
    const result = this.runCommand(args, options);
    if (!result) {
      return null;
    }
    return JSON.parse(result);
  }

  /**
   * Get authenticated user info
   */
  getAuthenticatedUser() {
    return this.runJsonCommand(['api', 'user']);
  }

  /**
   * Get organization details (null if the owner is not an org / not found)
   */
  getOrg(orgName) {
    try {
      return this.runJsonCommand(['api', `orgs/${orgName}`]);
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update organization settings
   */
  updateOrg(orgName, settings) {
    const fields = Object.entries(settings)
      .flatMap(([key, value]) => ['-f', `${key}=${String(value)}`]);
    return this.runJsonCommand(['api', `orgs/${orgName}`, '-X', 'PATCH', ...fields]);
  }

  /**
   * Get repository details (null if not found)
   */
  getRepo(owner, repoName) {
    try {
      return this.runJsonCommand(['api', `repos/${owner}/${repoName}`]);
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create an empty repository (the brand monorepo already exists locally —
   * the user pushes to it; no template, no clone)
   */
  createRepo(owner, name, { isPrivate = true, description = '', homepage = '' } = {}) {
    const args = ['repo', 'create', `${owner}/${name}`, isPrivate ? '--private' : '--public'];

    if (description) {
      args.push('--description', description);
    }
    if (homepage) {
      args.push('--homepage', homepage);
    }

    this.runCommand(args);

    return {
      full_name: `${owner}/${name}`,
      html_url: `https://github.com/${owner}/${name}`,
    };
  }

  /**
   * Update repository settings (-F for typed values so booleans arrive as
   * real JSON booleans, not the string "true")
   */
  updateRepo(owner, repoName, settings) {
    const fields = Object.entries(settings)
      .flatMap(([key, value]) => {
        if (typeof value === 'boolean') {
          return ['-F', `${key}=${value}`];
        }
        return ['-f', `${key}=${String(value)}`];
      });
    return this.runJsonCommand(['api', `repos/${owner}/${repoName}`, '-X', 'PATCH', ...fields]);
  }

  /**
   * Check if a branch exists in the repository
   */
  branchExists(owner, repo, branch) {
    try {
      this.runJsonCommand(['api', `repos/${owner}/${repo}/branches/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get GitHub Pages configuration (null if Pages is not enabled)
   */
  getPages(owner, repo) {
    try {
      return this.runJsonCommand(['api', `repos/${owner}/${repo}/pages`]);
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Enable GitHub Pages on a repository
   */
  enablePages(owner, repo, { branch = 'gh-pages', path = '/' } = {}) {
    return this.runJsonCommand(['api', `repos/${owner}/${repo}/pages`, '-X', 'POST', '-f', `source[branch]=${branch}`, '-f', `source[path]=${path}`]);
  }

  /**
   * Update GitHub Pages source configuration
   */
  updatePages(owner, repo, { branch = 'gh-pages', path = '/' } = {}) {
    return this.runJsonCommand(['api', `repos/${owner}/${repo}/pages`, '-X', 'PUT', '-f', `source[branch]=${branch}`, '-f', `source[path]=${path}`]);
  }

  /**
   * Set the custom domain for GitHub Pages
   */
  setPagesDomain(owner, repo, domain) {
    return this.runJsonCommand(['api', `repos/${owner}/${repo}/pages`, '-X', 'PUT', '-f', `cname=${domain}`]);
  }
}

module.exports = { GitHubAPI };
