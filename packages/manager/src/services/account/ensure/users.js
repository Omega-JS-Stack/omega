/**
 * Ensure the configured admin accounts exist in Firebase Auth with the
 * resolved passwords (env var → owner hook → seed derivation, see
 * lib/resolve-password.js), carry roles.admin + the highest plan on their
 * Firestore user doc, and — the audit — that NO other user holds
 * roles.admin. Unauthorized admins fail the service.
 *
 * Per entry:
 *   account: true  → create if missing (then POST /user/signup to complete
 *                    the flow), else converge the password; admin role +
 *                    plan on the user doc; marketing sync when flagged
 *   marketing: true (only) → push the contact to marketing providers when
 *                    the auth user exists, skip quietly when not
 */
const chalk = require('chalk').default;

module.exports = async function ensureUsers(context) {
  const { authAdmin, firestore, accountBackend, admins, domain, apiKey, resolvePassword, brandConfig, options } = context;
  const dryRun = options?.dryRun || false;

  const counts = { ok: 0, created: 0, updated: 0, adminUpdated: 0, planned: 0, marketingSynced: 0 };
  let warnings = 0;

  for (const [index, entry] of admins.entries()) {
    const { email } = entry;
    const label = `[${index + 1}/${admins.length}]`;

    if (!entry.account) {
      if (!entry.marketing) {
        console.log(`    ${label} ${chalk.dim(`⊘ ${email} — nothing to manage (account: false, marketing: false)`)}`);
        continue;
      }

      // Marketing-only — sync if the auth user exists, skip if not
      const user = await authAdmin.getUserByEmail(email);
      if (!user) {
        console.log(`    ${label} ${chalk.dim(`⊘ ${email} — no account (marketing-only, skipped)`)}`);
        continue;
      }

      console.log(`    ${label} ${chalk.cyan(email)} ${chalk.dim(user.uid)} — marketing-only`);
      warnings += await syncMarketing(accountBackend, apiKey, user.uid, dryRun, counts);
      continue;
    }

    // password null only in a dry run whose seed doesn't exist yet; the
    // via-marker calls out the non-default channels (env pin, owner hook)
    const { password, source } = await resolvePassword(email);
    const via = source && source !== 'seed' ? ` ${chalk.dim(`· via ${source}`)}` : '';
    const user = await authAdmin.getUserByEmail(email);

    if (!user) {
      if (dryRun) {
        console.log(`    ${label} ${chalk.cyan('[DRY RUN]')} Would create ${chalk.cyan(email)} + admin role + signup call${via}`);
        counts.planned++;
        continue;
      }

      const created = await authAdmin.createUser({ email, password });
      console.log(`    ${label} ${chalk.green('✓')} ${chalk.cyan(email)} ${chalk.dim(created.uid)} — account created${via}`);
      console.log(`      ${chalk.red('✗')} Google provider not linked`);
      counts.created++;

      const adminResult = await ensureAdmin(firestore, created.uid, brandConfig, dryRun);
      if (adminResult === 'updated') counts.adminUpdated++;

      // Complete the signup flow (welcome email, marketing lists, contact inference)
      if (!apiKey) {
        console.log(`      ${chalk.yellow('⚠')} Skipping signup call — no Firebase API key in firebase state`);
        warnings++;
      } else {
        try {
          await accountBackend.signup(created.uid);
          console.log(`      ${chalk.green('✓')} Signup completed`);
        } catch (error) {
          console.log(`      ${chalk.yellow('⚠')} Signup call failed: ${chalk.dim(error.message)}`);
          warnings++;
        }
      }
      continue;
    }

    // Existing account — converge the password
    if (!password) {
      // Dry run before the seed exists: it will be generated on the first real run
      console.log(`    ${label} ${chalk.cyan('[DRY RUN]')} ${chalk.cyan(email)} ${chalk.dim(user.uid)} — would set password (seed pending)`);
      counts.planned++;
    } else if (await accountBackend.verifyPassword(email, password)) {
      console.log(`    ${label} ${chalk.green('✓')} ${chalk.cyan(email)} ${chalk.dim(user.uid)} — password OK${via}`);
      counts.ok++;
    } else if (dryRun) {
      console.log(`    ${label} ${chalk.cyan('[DRY RUN]')} ${chalk.cyan(email)} ${chalk.dim(user.uid)} — would update password${via}`);
      counts.planned++;
    } else {
      await authAdmin.updateUser(user.uid, { password });
      console.log(`    ${label} ${chalk.green('✓')} ${chalk.cyan(email)} ${chalk.dim(user.uid)} — password updated${via}`);
      counts.updated++;
    }

    logGoogleProvider(user);

    const adminResult = await ensureAdmin(firestore, user.uid, brandConfig, dryRun);
    if (adminResult === 'planned') counts.planned++;
    if (adminResult === 'updated') counts.adminUpdated++;

    if (entry.marketing) {
      warnings += await syncMarketing(accountBackend, apiKey, user.uid, dryRun, counts);
    }
  }

  // Audit: only account entries may hold roles.admin
  const allowedEmails = new Set(admins.filter((e) => e.account).map((e) => e.email));
  const unauthorized = await auditAdmins(firestore, authAdmin, allowedEmails);

  const output = { users: counts };

  if (unauthorized.length > 0) {
    return { output, status: 'error', error: `Unauthorized admin accounts found: ${unauthorized.join(', ')}` };
  }
  if (warnings > 0) {
    return { output, status: 'warned', reason: `${warnings} account(s) had a signup or marketing warning` };
  }
  return { output };
};

/**
 * roles.admin + the highest-tier plan (last entry in payment.products) on
 * the Firestore user doc. Leaf-path merge write, so sibling fields survive.
 * Brands with no products manage only the role (omega-manager issued an
 * empty merge write every run in that case).
 *
 * @returns {'ok'|'planned'|'updated'}
 */
async function ensureAdmin(firestore, uid, brandConfig, dryRun) {
  const doc = await firestore.getDoc(`users/${uid}`) || {};

  const products = brandConfig.payment?.products || [];
  const maxProduct = products[products.length - 1];

  const hasAdmin = doc.roles?.admin === true;
  const hasPlan = !maxProduct || doc.subscription?.product?.id === maxProduct.id;

  if (hasAdmin && hasPlan) {
    console.log(`      ${chalk.green('✓')} Admin role set${maxProduct ? `, plan: ${chalk.cyan(maxProduct.id)}` : ''}`);
    return 'ok';
  }

  if (dryRun) {
    const changes = [
      ...(!hasAdmin ? ['admin role'] : []),
      ...(!hasPlan ? [`plan ${maxProduct.id}`] : []),
    ];
    console.log(`      ${chalk.cyan('[DRY RUN]')} Would set ${changes.join(' + ')}`);
    return 'planned';
  }

  const data = {};
  const fieldPaths = [];

  if (!hasAdmin) {
    data.roles = { admin: true };
    fieldPaths.push('roles.admin');
  }
  if (!hasPlan) {
    data.subscription = {
      product: { id: maxProduct.id, name: maxProduct.name },
      status: 'active',
    };
    fieldPaths.push('subscription.product.id', 'subscription.product.name', 'subscription.status');
  }

  await firestore.patchDoc(`users/${uid}`, data, fieldPaths);

  if (!hasAdmin) {
    console.log(`      ${chalk.green('✓')} Admin role set`);
  }
  if (!hasPlan) {
    console.log(`      ${chalk.green('✓')} Plan set to ${chalk.cyan(maxProduct.id)}`);
  }
  return 'updated';
}

/**
 * All users with roles.admin == true, checked against the allowed emails.
 *
 * @returns {Promise<string[]>} Unauthorized admin descriptions (empty = clean)
 */
async function auditAdmins(firestore, authAdmin, allowedEmails) {
  const docs = await firestore.runQuery({
    from: [{ collectionId: 'users' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'roles.admin' },
        op: 'EQUAL',
        value: { booleanValue: true },
      },
    },
  });

  const unauthorized = [];

  for (const doc of docs) {
    const user = await authAdmin.getUser(doc.id);

    if (user && allowedEmails.has(user.email)) {
      console.log(`    ${chalk.green('✓')} Admin: ${chalk.cyan(user.email)} ${chalk.dim(doc.id)}`);
    } else if (user) {
      unauthorized.push(`${user.email || '?'} (${doc.id})`);
      console.log(`    ${chalk.red('✗')} Unauthorized admin: ${chalk.red(user.email || '?')} ${chalk.dim(doc.id)}`);
    } else {
      unauthorized.push(doc.id);
      console.log(`    ${chalk.red('✗')} Unauthorized admin (no auth record): ${chalk.red(doc.id)}`);
    }
  }

  return unauthorized;
}

/**
 * Whether the user has Google sign-in linked (informational — linking is a
 * manual browser step).
 */
function logGoogleProvider(user) {
  const hasGoogle = user.providerData.some((p) => p.providerId === 'google.com');

  if (hasGoogle) {
    console.log(`      ${chalk.green('✓')} Google provider linked`);
  } else {
    console.log(`      ${chalk.red('✗')} Google provider not linked`);
  }
}

/**
 * Push the user's contact to the marketing providers via the backend.
 *
 * @returns {Promise<number>} Warning count contribution (0 or 1)
 */
async function syncMarketing(accountBackend, apiKey, uid, dryRun, counts) {
  if (!apiKey) {
    console.log(`      ${chalk.dim('⊘ Marketing sync skipped (no Firebase API key in firebase state)')}`);
    return 0;
  }

  if (dryRun) {
    console.log(`      ${chalk.cyan('[DRY RUN]')} Would sync marketing contact`);
    counts.planned++;
    return 0;
  }

  try {
    await accountBackend.syncMarketingContact(uid);
    console.log(`      ${chalk.green('✓')} Marketing contact synced`);
    counts.marketingSynced++;
    return 0;
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Marketing sync failed: ${chalk.dim(error.message)}`);
    return 1;
  }
}
