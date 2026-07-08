/**
 * Ensure the brand's Beehiiv publication is configured and accessible.
 *
 * Resolution: marketing.newsletter.publicationId from config → publicationId
 * from state → auto-match by brand name/id across the account's
 * publications. Publications can't be created via API — when nothing
 * matches, the exact values to copy into the dashboard are printed and the
 * operation warns (the select/create browser flow rides the prompting
 * port). The resolved id lands in state; the config writeback rides the
 * config-serializer port.
 */
const chalk = require('chalk').default;

module.exports = async function ensurePublication(context) {
  const { beehiivApi: api, brandConfig, serviceData } = context;

  const brandName = brandConfig.brand?.name || '';
  const brandId = brandConfig.brand?.id || '';
  const knownId = brandConfig.marketing?.newsletter?.publicationId || serviceData.publicationId;

  // 1. Known id (config or state) — verify access
  if (knownId) {
    const publication = await api.getPublication(knownId);

    if (!publication) {
      console.log(`      ${chalk.yellow('⚠')} Publication ${chalk.cyan(knownId)} is not accessible with this API key — fix the id or the key, then rerun`);
      return { status: 'warned', output: { publication: { publicationId: knownId, accessible: false } } };
    }

    console.log(`      ${chalk.green('✓')} ${chalk.cyan(publication.name)} ${chalk.dim(`(${publication.id})`)}`);
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
    console.log(`      ${chalk.dim('→')} publicationId lives in state until the config-serializer port writes it into omega.json5`);
    return { state: { publicationId: match.id, publicationName: match.name } };
  }

  // 3. Nothing matches — publications are dashboard-only, print the values to copy
  console.log(`      ${chalk.yellow('⚠')} No publication matches ${chalk.cyan(brandName)} — create one at ${chalk.cyan('https://app.beehiiv.com/settings/workspace/overview?create_publication=true')}, then rerun:`);
  console.log(`        ${chalk.dim('Publication name:')}       ${chalk.cyan(brandName)}`);
  console.log(`        ${chalk.dim('This publication is...:')} ${chalk.cyan(brandConfig.brand?.description || `News and updates from ${brandName}`)}`);
  console.log(`        ${chalk.dim('Subdomain:')}              ${chalk.cyan(brandId)}`);

  return { status: 'warned', output: { publication: { missing: true, suggestedName: brandName } } };
};
