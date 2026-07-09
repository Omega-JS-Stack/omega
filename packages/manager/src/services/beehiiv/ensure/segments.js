/**
 * Verify BEM's segments exist on the Beehiiv publication.
 *
 * Beehiiv has NO segment-create API — this operation can only read. All
 * present = converged success; missing segments warn with human-readable
 * conditions to build in the dashboard (the browser automation
 * omega-manager drove through the Chrome extension rides the
 * extension port). Never mutates, so dry-run is the normal run.
 */
const chalk = require('chalk').default;
const { segmentsFor, BEM_FIELDS_MAP } = require('../../../lib/bem-marketing.js');

const BEEHIIV_SEGMENTS = segmentsFor('beehiiv');

// Operator → human-readable phrasing for the dashboard instructions
const OP_DISPLAY = {
  '==': 'is',
  '!=': 'is not',
  'within': 'within last',
  'not_within': 'NOT within last',
  'email_is': 'email is',
  'email_like': 'email matches',
  'opened_or_clicked': 'opened or clicked within last',
  'not_opened': 'not opened in last',
  'not_opened_or_clicked': 'not opened or clicked in last',
  'received_gte': 'received at least',
};

function formatCondition(condition) {
  if (condition.type === 'engagement' || condition.type === 'contact') {
    return `${OP_DISPLAY[condition.op] || condition.op} ${condition.value}`;
  }

  const fieldDef = BEM_FIELDS_MAP[condition.field];
  const fieldName = fieldDef?.display || condition.field;
  return `${fieldName} ${OP_DISPLAY[condition.op] || condition.op} "${condition.value}"`;
}

module.exports = async function ensureSegments(context) {
  const { beehiivApi: api, serviceData } = context;

  const publicationId = serviceData.publicationId;
  if (!publicationId) {
    console.log(chalk.dim('      ⊘ No publication yet — nothing to verify segments on'));
    return {};
  }

  const existing = await api.getSegments(publicationId);
  const existingByName = new Set(existing.map((s) => s.name));

  const missing = BEEHIIV_SEGMENTS.filter((s) => !existingByName.has(s.name));

  if (missing.length === 0) {
    console.log(`      ${chalk.green('✓')} All ${BEEHIIV_SEGMENTS.length} segments exist`);
    return { output: { segments: { total: BEEHIIV_SEGMENTS.length, missing: [] } } };
  }

  console.log(`      ${chalk.yellow('⚠')} ${missing.length} segment(s) missing — build them at ${chalk.cyan('https://app.beehiiv.com/segments')} (Beehiiv has no segment-create API):`);
  for (const segment of missing) {
    const joiner = segment.logic === 'or' ? ' OR ' : ' AND ';
    const criteria = segment.conditions.map((c) => formatCondition(c)).join(joiner);
    console.log(`        ${chalk.dim('•')} ${chalk.cyan(segment.display)} ${chalk.dim(`(${segment.name})`)}`);
    console.log(`          ${chalk.dim('→')} ${criteria}`);
  }

  return { status: 'warned', output: { segments: { total: BEEHIIV_SEGMENTS.length, missing: missing.map((s) => s.name) } } };
};
