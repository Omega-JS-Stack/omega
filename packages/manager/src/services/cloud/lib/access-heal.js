/**
 * Cloud access self-heal — the identity seam, absorbed into `npm start`
 * (Ian 2026-07-19: "I refuse to run a single command … write it so these
 * fixes are wrapped in that. self healing idempotent"). The manage identity
 * (the brand's Google OAuth token store) can lack a role on the brand's
 * project — e.g. a project minted outside the framework by a different
 * account. The heal lane is the local gcloud install of whoever ran
 * `npm start`: each of its OTHER authenticated accounts is asked, in turn,
 * to grant the manage identity owner on the project
 * (`add-iam-policy-binding` is idempotent — IAM members dedupe), then the
 * probe re-runs through a short IAM-propagation window and the manage run
 * proceeds normally. No local gcloud, no able account, or an unknowable
 * identity → the original diagnostic error stands (it names the acting
 * account and both manual remedies — google-auth.js decorates it).
 */
const { execFileSync } = require('node:child_process');
const chalk = require('chalk').default;

// A fresh IAM grant can take a few seconds to propagate to API authz.
const PROPAGATION_PROBES = 8;
const PROPAGATION_DELAY_MS = 4000;

// roles/owner is the ideal grant, but projects OUTSIDE an organization only
// accept new owners via a console INVITATION — the API rejects the binding
// (found live 2026-07-19 on omegajs). The fallback pair covers every
// cloud-service op: editor for the platform surface, firebase.admin for the
// Firebase products (billing LINK needs more, but a linked project only
// needs the billing READ, which editor has).
const ROLE_SETS = [
  ['roles/owner'],
  ['roles/editor', 'roles/firebase.admin'],
];

/** The most useful single line of a failed gcloud invocation. */
function gcloudReason(error) {
  const text = (error.stderr ? error.stderr.toString() : '') || error.message || '';
  return text.trim().split('\n').filter(Boolean).pop() || 'unknown gcloud failure';
}

/** Run gcloud with args, returning stdout — throws on any failure. */
function defaultExec(args) {
  return execFileSync('gcloud', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

/**
 * Ensure the manage identity can access the project, healing the grant if a
 * local gcloud account is able to. Fakes without the probe surface skip the
 * heal entirely (this module carries its own unit suite; the real
 * FirebaseAPI always exposes probeProjectAccess).
 *
 * @param {Object} options
 * @param {Object} options.firebaseApi - FirebaseAPI (or test fake)
 * @param {string} options.projectId
 * @param {Function} [options.exec] - gcloud runner, injectable for tests
 * @param {Function} [options.log] - line logger (default console.log)
 * @param {number} [options.delayMs] - propagation retry delay override
 * @returns {Promise<{healed: boolean, probed?: boolean, grantor?: string, manageEmail?: string}>}
 */
async function ensureProjectAccess({ firebaseApi, projectId, exec = defaultExec, log = console.log, delayMs = PROPAGATION_DELAY_MS }) {
  if (typeof firebaseApi.probeProjectAccess !== 'function') {
    return { healed: false, probed: false };
  }

  // null = accessible; a PERMISSION_DENIED error object = the seam;
  // anything else (network, 404, …) is a genuine fault and rethrows.
  const probe = async () => {
    try {
      await firebaseApi.probeProjectAccess(projectId);
      return null;
    } catch (error) {
      if (error.status === 'PERMISSION_DENIED' || error.status === 403) {
        return error;
      }
      throw error;
    }
  };

  let denied = await probe();
  if (!denied) {
    return { healed: false, probed: true };
  }

  const manageEmail = await firebaseApi.auth?.getAccountEmail?.();
  if (!manageEmail) {
    throw denied;
  }

  let accounts;
  try {
    accounts = JSON.parse(exec(['auth', 'list', '--format=json'])).map((entry) => entry.account).filter(Boolean);
  } catch {
    throw denied; // no local gcloud (or not authed) — the heal lane is absent
  }

  const candidates = accounts.filter((account) => account.toLowerCase() !== manageEmail.toLowerCase());
  for (const account of candidates) {
    let granted = null;
    for (const roles of ROLE_SETS) {
      try {
        log(`      ${chalk.dim('→')} Access heal: granting ${chalk.cyan(manageEmail)} ${chalk.cyan(roles.join(' + '))} on ${chalk.cyan(projectId)} via local gcloud (${chalk.cyan(account)})`);
        for (const role of roles) {
          exec([
            'projects', 'add-iam-policy-binding', projectId,
            `--member=user:${manageEmail}`, `--role=${role}`,
            `--account=${account}`, '--quiet', '--format=none',
          ]);
        }
        granted = roles;
        break;
      } catch (error) {
        log(`      ${chalk.dim(`⊘ ${roles.join(' + ')} via ${account}: ${gcloudReason(error)}`)}`);
      }
    }
    if (!granted) {
      continue; // this account can't grant anything — try the next
    }

    for (let attempt = 0; attempt < PROPAGATION_PROBES; attempt++) {
      denied = await probe();
      if (!denied) {
        return { healed: true, probed: true, grantor: account, manageEmail, roles: granted };
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw denied;
}

module.exports = { ensureProjectAccess, PROPAGATION_PROBES };
