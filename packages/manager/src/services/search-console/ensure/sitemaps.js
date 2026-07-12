/**
 * Ensure the configured sitemaps are submitted for the domain property.
 *
 * Submits only what's MISSING — omega-manager resubmitted existing sitemaps
 * on every run ("refresh"), which made a converged brand mutate forever;
 * Google re-crawls submitted sitemaps on its own. Paths come from
 * `searchConsole.sitemapPaths` (default `/sitemap.xml`); brands without a
 * web target have no sitemap to serve and are skipped.
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensureSitemaps(context) {
  const { searchConsoleApi: api, brandConfig, brand, domain, serviceData, options = {} } = context;

  if (brandConfig.searchConsole?.submitSitemap === false) {
    console.log(chalk.dim('      ⊘ Sitemap submission disabled (searchConsole.submitSitemap = false)'));
    return {};
  }

  if (!brand.targets.includes('web')) {
    console.log(chalk.dim('      ⊘ No web target — no sitemap to submit'));
    return {};
  }

  if (!serviceData.propertyUrl) {
    console.log(chalk.dim('      ⊘ No Search Console property yet — rerun once the property is verified'));
    return {};
  }

  const siteUrl = serviceData.propertyUrl;
  const paths = brandConfig.searchConsole?.sitemapPaths || ['/sitemap.xml'];
  const wanted = paths.map((path) => `https://${domain}${path}`);

  // === READ ===
  const existing = await api.listSitemaps(siteUrl);
  const existingPaths = new Set(existing.map((s) => s.path));

  const missing = wanted.filter((url) => !existingPaths.has(url));

  if (missing.length === 0) {
    console.log(`      ${chalk.green('✓')} All ${wanted.length} sitemap(s) submitted`);
    return { output: { sitemaps: { submitted: 0, existing: wanted.length } } };
  }

  if (options.dryRun) {
    return dryRunPlan(`submit ${missing.length} sitemap(s): ${missing.join(', ')}`, { output: { sitemaps: { planned: missing } } });
  }

  // === WRITE: submit only the missing ones ===
  const submitted = [];
  const errors = [];
  for (const url of missing) {
    try {
      await api.submitSitemap(siteUrl, url);
      submitted.push(url);
      console.log(`      ${chalk.green('✓')} Submitted: ${chalk.cyan(url)}`);
    } catch (error) {
      errors.push({ url, error: error.message });
      console.log(`      ${chalk.yellow('⚠')} Failed: ${chalk.cyan(url)}${chalk.dim(` — ${error.message}`)}`);
    }
  }

  const result = { output: { sitemaps: { submitted: submitted.length, existing: wanted.length - missing.length, errors } } };
  if (errors.length > 0) {
    result.status = 'warned';
  }
  return result;
};
