/**
 * Parser for the brand's config/replyify.md — an optional custom Gmail
 * filter section plus brand-specific knowledge appended to the baseline
 * (omega-manager read `.brands/{id}/replyify.md`).
 *
 * Supported formats:
 *   1. Both delimiters:        ---filter---\n(query)\n---knowledge---\n(text)
 *   2. Filter only:            ---filter---\n(query)
 *   3. Knowledge delimiter:    ---knowledge---\n(text)
 *   4. No delimiters:          the whole file is knowledge
 */
const FILTER_DELIMITER = '---filter---';
const KNOWLEDGE_DELIMITER = '---knowledge---';

/**
 * @param {string} content - Raw file content
 * @returns {{ filterQuery: string|null, knowledge: string }}
 */
function parseKnowledgeFile(content) {
  const hasFilter = content.includes(FILTER_DELIMITER);
  const hasKnowledge = content.includes(KNOWLEDGE_DELIMITER);

  if (hasFilter && hasKnowledge) {
    const afterFilter = content.split(FILTER_DELIMITER)[1];
    const [filterPart, ...knowledgeParts] = afterFilter.split(KNOWLEDGE_DELIMITER);

    return {
      filterQuery: filterPart.trim(),
      knowledge: knowledgeParts.join(KNOWLEDGE_DELIMITER).trim(),
    };
  }

  if (hasFilter) {
    return {
      filterQuery: content.split(FILTER_DELIMITER)[1].trim(),
      knowledge: '',
    };
  }

  if (hasKnowledge) {
    return {
      filterQuery: null,
      knowledge: content.split(KNOWLEDGE_DELIMITER)[1].trim(),
    };
  }

  return {
    filterQuery: null,
    knowledge: content.trim(),
  };
}

module.exports = { parseKnowledgeFile };
