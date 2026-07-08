/**
 * BEM segment conditions → SendGrid query_dsl (the SQL-like segment query
 * language). Pure functions, ported behavior-for-behavior from omega-manager
 * — the generated SQL is compared against live segments for staleness, so
 * any change here re-syncs every segment on the next run.
 */
const { BEM_FIELDS_MAP } = require('../../../lib/bem-marketing.js');

/**
 * Convert a BEM field condition to a WHERE clause fragment. Custom fields
 * are referenced by name (double-quoted) in query_dsl, not by internal ID.
 */
function fieldConditionToWhere(condition) {
  const fieldDef = BEM_FIELDS_MAP[condition.field];
  if (!fieldDef) {
    throw new Error(`Unknown field "${condition.field}" in segment condition`);
  }

  const col = `"${condition.field}"`;

  switch (condition.op) {
    case '==':
      return `${col} = '${condition.value}'`;
    case '!=':
      return `${col} != '${condition.value}'`;
    case 'within': {
      const days = parseInt(condition.value, 10);
      return `${col} > timestampadd(day, -${days}, CURRENT_TIMESTAMP)`;
    }
    case 'not_within': {
      const days = parseInt(condition.value, 10);
      return `${col} <= timestampadd(day, -${days}, CURRENT_TIMESTAMP)`;
    }
    default:
      throw new Error(`Unsupported field condition op "${condition.op}"`);
  }
}

/** Contact conditions use built-in contact_data columns (email, first_name, …). */
function contactConditionToWhere(condition) {
  switch (condition.op) {
    case 'email_is':
      return `email = '${condition.value}'`;
    case 'email_like':
      return `email LIKE '${condition.value}'`;
    default:
      throw new Error(`Unsupported contact condition op "${condition.op}"`);
  }
}

function conditionToWhere(condition) {
  if (condition.type === 'engagement') {
    return null; // Handled separately in buildQueryDsl
  }
  if (condition.type === 'contact') {
    return contactConditionToWhere(condition);
  }
  return fieldConditionToWhere(condition);
}

/**
 * Build a complete query_dsl from BEM segment conditions. Engagement
 * conditions need event_data (JOIN or subqueries); field/contact conditions
 * query contact_data directly.
 */
function buildQueryDsl(conditions, logic) {
  const engagementConditions = conditions.filter((c) => c.type === 'engagement');
  const nonEngagementConditions = conditions.filter((c) => c.type !== 'engagement');
  const joiner = logic === 'or' ? ' OR ' : ' AND ';

  const fieldWhereParts = nonEngagementConditions.map((c) => conditionToWhere(c)).filter(Boolean);

  // No engagement — simple contact_data query
  if (engagementConditions.length === 0) {
    const whereClause = fieldWhereParts.length > 0
      ? ` WHERE ${fieldWhereParts.join(joiner)}`
      : '';
    return `SELECT contact_id, updated_at FROM contact_data${whereClause}`;
  }

  // Positive engagement (opened_or_clicked) uses a JOIN
  const positiveEngagement = engagementConditions.find((c) => c.op === 'opened_or_clicked');
  if (positiveEngagement) {
    const days = parseInt(positiveEngagement.value, 10);
    const threshold = `timestampadd(day, -${days}, CURRENT_TIMESTAMP)`;
    const engWhere = `(e.event_type = 'open' OR e.event_type = 'click') AND e.timestamp > ${threshold}`;
    const allWhere = [...fieldWhereParts, engWhere];
    return `SELECT c.contact_id, c.updated_at FROM contact_data c`
      + ` JOIN event_data e ON c.contact_id = e.contact_id`
      + ` WHERE ${allWhere.join(joiner)}`;
  }

  // Negative/count engagement conditions use subqueries (combinable)
  const engagementWhereParts = engagementConditions.map((engagement) => {
    switch (engagement.op) {
      case 'not_opened': {
        const days = parseInt(engagement.value, 10);
        const threshold = `timestampadd(day, -${days}, CURRENT_TIMESTAMP)`;
        return `contact_id NOT IN (`
          + `SELECT contact_id FROM event_data WHERE event_type = 'open' AND timestamp > ${threshold}`
          + `)`;
      }
      case 'not_opened_or_clicked': {
        const days = parseInt(engagement.value, 10);
        const threshold = `timestampadd(day, -${days}, CURRENT_TIMESTAMP)`;
        return `contact_id NOT IN (`
          + `SELECT contact_id FROM event_data WHERE (event_type = 'open' OR event_type = 'click') AND timestamp > ${threshold}`
          + `)`;
      }
      case 'received_gte': {
        // SendGrid has no GROUP BY / HAVING — approximate >=N delivered events
        // by requiring one in each of N distinct time windows. The window size
        // comes from the sibling time-based engagement condition's period.
        const minCount = parseInt(engagement.value, 10);
        const timeEng = engagementConditions.find((c) => c.op !== 'received_gte');
        const totalDays = timeEng ? parseInt(timeEng.value, 10) : 180;
        const windowSize = Math.floor(totalDays / minCount);

        return '(' + Array.from({ length: minCount }, (_, i) => {
          const start = i * windowSize;
          const end = (i + 1) * windowSize;
          return `contact_id IN (`
            + `SELECT contact_id FROM event_data WHERE event_type = 'delivered'`
            + ` AND timestamp > timestampadd(day, -${end}, CURRENT_TIMESTAMP)`
            + ` AND timestamp <= timestampadd(day, -${start}, CURRENT_TIMESTAMP)`
            + `)`;
        }).join(' AND ') + ')';
      }
      default:
        throw new Error(`Unsupported engagement op "${engagement.op}"`);
    }
  });

  const allWhere = [...fieldWhereParts, ...engagementWhereParts];
  return `SELECT contact_id, updated_at FROM contact_data WHERE ${allWhere.join(joiner)}`;
}

module.exports = { buildQueryDsl };
