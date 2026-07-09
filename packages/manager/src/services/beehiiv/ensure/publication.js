/**
 * Ensure the brand's Beehiiv publication is configured and accessible.
 *
 * Resolution: marketing.newsletter.publicationId from config → publicationId
 * from state → auto-match by brand name/id across the account's
 * publications. Publications can't be created via API — when nothing
 * matches, the exact values to copy into the dashboard are printed and the
 * operation warns (the select/create browser flow rides the onboarding-flows
 * port). The resolved id is written back into omega.json5
 * (marketing.newsletter.publicationId — comment-preserving) and mirrored in
 * state.
 */
const chalk = require('chalk').default;
const { writeBrandConfig } = require('../../../lib/config-write.js');

module.exports = async function ensurePublication(context) {
  const { beehiivApi: api, brandConfig, serviceData } = context;

  const brandName = brandConfig.brand?.name || '';
  const brandId = brandConfig.brand?.id || '';
  const configuredId = brandConfig.marketing?.newsletter?.publicationId;
  const knownId = configuredId || serviceData.publicationId;

  // 1. Known id (config or state) — verify access
  if (knownId) {
    const publication = await api.getPublication(knownId);

    if (!publication) {
      console.log(`      ${chalk.yellow('⚠')} Publication ${chalk.cyan(knownId)} is not accessible with this API key — fix the id or the key, then rerun`);
      return { status: 'warned', output: { publication: { publicationId: knownId, accessible: false } } };
    }

    console.log(`      ${chalk.green('✓')} ${chalk.cyan(publication.name)} ${chalk.dim(`(${publication.id})`)}`);
    if (publication.id !== configuredId) {
      writeBrandConfig(context, { 'marketing.newsletter.publicationId': publication.id });
    }
    return { state: { publicationId: publication.id, publicationName: publication.name } };
  }

  // 2. Auto-match by brand name/id
  const publications = await api.listPublications();
  const nameLower = brandName.toLowerCase();
  const idLower = brandId.toLowerCase();

  const match = publications.find((pub) => {
    const pubName = (pub.name || '').toLowerCase();
    return pubName.includes(nameLower)
      || pubName.includes(idLower)
      || nameLower.includes(pubName)
      || idLower.includes(pubName.replace(/\s+/g, '-'));
  });

  if (match) {
    console.log(`      ${chalk.green('✓')} Auto-matched ${chalk.cyan(match.name)} ${chalk.dim(`(${match.id})`)}`);
    writeBrandConfig(context, { 'marketing.newsletter.publicationId': match.id });
    return { state: { publicationId: match.id, publicationName: match.name } };
  }

  // 3. Nothing matches — publications are dashboard-only, print the values to copy
  console.log(`      ${chalk.yellow('⚠')} No publication matches ${chalk.cyan(brandName)} — create one at ${chalk.cyan('https://app.beehiiv.com/settings/workspace/overview?create_publication=true')}, then rerun:`);
  console.log(`        ${chalk.dim('Publication name:')}       ${chalk.cyan(brandName)}`);
  console.log(`        ${chalk.dim('This publication is...:')} ${chalk.cyan(brandConfig.brand?.description || `News and updates from ${brandName}`)}`);
  console.log(`        ${chalk.dim('Subdomain:')}              ${chalk.cyan(brandId)}`);

  return { status: 'warned', output: { publication: { missing: true, suggestedName: brandName } } };
};
