/**
 * Ensure the GA4 property is linked to the brand's Firebase project.
 *
 * Runs after the firebase service so the project exists. A property holds at
 * most one FirebaseLink, and a Firebase project links to at most one
 * property — so when our project is linked to the WRONG property, it's
 * unlinked there and linked here (config is the source of truth). Links may
 * store the project NUMBER rather than the ID; the number comes from config
 * (cloud.config.messagingSenderId IS the project number) — no second API
 * client needed.
 *
 * omega-manager retried "link still propagating" failures with sleeps and a
 * Firebase-API fallback; the port reports warned and lets the rerun converge
 * (consistent with every other service).
 *
 * Also normalizes the stream Firebase auto-creates when linking ("Web App",
 * often with no URI) to the naming convention — diff-gated.
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensureGoogleFirebaseLink(context) {
  const { analyticsApi: api, propertyId, brandConfig, options = {} } = context;

  // Same derivation as the cloud service: ONE home (#23) — the client web
  // config names the project (cp100)
  const projectId = brandConfig.cloud?.config?.projectId;

  if (brandConfig.cloud?.shared === true) {
    console.log(chalk.dim('      ⊘ Shared Firebase project — the link belongs to its owning brand'));
    return {};
  }

  if (!projectId) {
    console.log(chalk.dim('      ⊘ No cloud.config.projectId configured — nothing to link'));
    return {};
  }

  // Links can reference the project by ID or number
  const projectNumber = brandConfig.cloud?.config?.messagingSenderId || null;
  const isOurProject = (linkedProject) => linkedProject === projectId
    || (projectNumber && linkedProject === projectNumber);

  // === READ: the configured property's link ===
  const links = await api.listFirebaseLinks(propertyId);

  if (links.length > 0) {
    const linkedProject = (links[0].project || '').replace('projects/', '');

    if (isOurProject(linkedProject)) {
      console.log(`      ${chalk.green('✓')} GA property linked to this Firebase project`);
      const streamResult = await normalizeFirebaseStream(api, propertyId, brandConfig.brand.name, projectId, options);
      return { output: { firebaseLink: { propertyId, linked: true, streamUpdated: streamResult } } };
    }

    // The property belongs to another project — that's not ours to break
    console.log(`      ${chalk.yellow('⚠')} GA property ${chalk.cyan(propertyId)} is linked to a DIFFERENT Firebase project: ${chalk.cyan(linkedProject)}`);
    console.log(`      ${chalk.dim('→')} Unlink it in GA Admin (or fix analytics.providers.google.propertyId), then rerun`);
    return { status: 'warned', output: { firebaseLink: { error: `property linked to different project: ${linkedProject}` } } };
  }

  // === No link on our property — find where (if anywhere) our project is linked ===
  console.log(`      ${chalk.dim('→')} No link on property ${chalk.cyan(propertyId)} — searching all GA properties...`);
  const elsewhere = await findExistingLink(api, isOurProject, propertyId);

  if (options.dryRun) {
    const plannedActions = elsewhere
      ? [`unlink from property ${elsewhere.propertyId}`, `link to property ${propertyId}`]
      : [`link to property ${propertyId}`];
    return dryRunPlan(`${plannedActions.join(', then ')}`, { output: { firebaseLink: { planned: plannedActions } } });
  }

  if (elsewhere) {
    console.log(`      ${chalk.yellow('⚠')} Firebase project is linked to the wrong GA property ${chalk.cyan(elsewhere.propertyId)} — unlinking...`);
    await api.deleteFirebaseLink(elsewhere.propertyId, elsewhere.linkId);
    console.log(`      ${chalk.green('✓')} Unlinked from property ${chalk.cyan(elsewhere.propertyId)}`);
  }

  // === WRITE: create the link (a just-deleted link can take a moment to
  // release — GA answers with a precondition failure; the rerun converges) ===
  console.log(`      ${chalk.dim('→')} Linking GA property ${chalk.cyan(propertyId)} to Firebase project ${chalk.cyan(projectId)}...`);
  let link;
  try {
    link = await api.createFirebaseLink(propertyId, projectId);
  } catch (error) {
    if (error.message.includes('Precondition') || error.message.includes('already linked')) {
      console.log(`      ${chalk.yellow('⚠')} Link not ready yet${chalk.dim(`: ${error.message}`)} — rerun in a minute`);
      return { status: 'warned', output: { firebaseLink: { error: error.message } } };
    }
    throw error;
  }

  console.log(`      ${chalk.green('✓')} Created Firebase link`);

  const streamResult = await normalizeFirebaseStream(api, propertyId, brandConfig.brand.name, projectId, options);

  return { output: { firebaseLink: { propertyId, linked: true, linkName: link.name || null, streamUpdated: streamResult } } };
};

/**
 * Search every accessible account/property for a FirebaseLink pointing at
 * our project (skipping the target property, already known to be linkless).
 *
 * @returns {Object|null} - { propertyId, linkId } or null
 */
async function findExistingLink(api, isOurProject, targetPropertyId) {
  const accounts = await api.listAccounts();

  for (const account of accounts) {
    const properties = await api.listProperties(account.name.replace('accounts/', ''));

    for (const property of properties) {
      const propId = property.name.replace('properties/', '');
      if (propId === targetPropertyId) {
        continue;
      }

      const links = await api.listFirebaseLinks(propId);
      const ours = links.find((link) => isOurProject((link.project || '').replace('projects/', '')));
      if (ours) {
        console.log(`      ${chalk.dim('→')} Found: linked to property ${chalk.cyan(propId)} (${property.displayName})`);
        return { propertyId: propId, linkId: ours.name.split('/').pop() };
      }
    }
  }

  return null;
}

/**
 * Normalize the stream Firebase auto-creates when linking: rename "Web App"
 * to "{Brand} - Firebase" and set the URI when missing. Diff-gated; a
 * correct stream is untouched.
 */
async function normalizeFirebaseStream(api, propertyId, brandName, projectId, options) {
  const streams = await api.listDataStreams(propertyId);
  const expectedName = `${brandName} - Firebase`;

  const stream = streams.find((s) => {
    const uri = s.webStreamData?.defaultUri || '';
    return s.displayName === 'Web App'
      || s.displayName === expectedName
      || uri.includes('.firebaseapp.com')
      || uri.includes('.web.app');
  });

  if (!stream) {
    return null;
  }

  const streamId = stream.name.split('/').pop();
  const needsRename = stream.displayName !== expectedName;
  const needsUri = !stream.webStreamData?.defaultUri;

  if (!needsRename && !needsUri) {
    return { alreadyCorrect: true, streamId };
  }

  if (options.dryRun) {
    return { planned: { renamed: needsRename, uriSet: needsUri }, streamId };
  }

  const updates = {};
  const updateMaskFields = [];
  if (needsRename) {
    updates.displayName = expectedName;
    updateMaskFields.push('displayName');
  }
  if (needsUri) {
    updates.webStreamData = { defaultUri: `https://${projectId}.firebaseapp.com` };
    updateMaskFields.push('webStreamData.defaultUri');
  }

  await api.updateDataStream(propertyId, streamId, updates, updateMaskFields);
  console.log(`      ${chalk.green('✓')} Normalized the Firebase stream${needsRename ? ` ("${stream.displayName}" → "${expectedName}")` : ''}`);

  return { updated: true, streamId, renamed: needsRename, uriSet: needsUri };
}
