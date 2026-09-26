/**
 * Prompt-segment resolution for the unified AI library.
 *
 * Every provider takes the same two `options.prompt` forms — the legacy object
 * ({ path|content, settings }) and the multi-role array ([{ role, path|content,
 * settings }, ...]) — so normalizing them into canonical segments and loading
 * their content (prompt files included) lives here once, not per provider.
 *
 * Both functions are pure apart from the prompt-file reads `loadContent` makes.
 */
const jetpack = require('fs-jetpack');
const powertools = require('node-powertools');

// Roles permitted in the `options.prompt` array. Order is canonical per the
// OpenAI Model Spec authority hierarchy (system > developer > user > ctx).
const VALID_PROMPT_ROLES = new Set(['system', 'developer', 'user', 'assistant']);

// Normalize the `options.prompt` input into a canonical array of segments:
//   [{ role, path, content, settings }, ...]
//
// Accepts:
//   - undefined/null/empty → []
//   - object: { path|content, settings } → wrapped as a single 'system' segment
//   - array: [{ role, path|content, settings }, ...] → role defaults to 'system'
//     if omitted; invalid roles throw.
function normalizePrompt(input) {
  const segments = Array.isArray(input)
    ? input
    : (input && (input.path || input.content || input.settings)) ? [input] : [];

  return segments.map((segment) => {
    const role = segment.role || 'system';

    if (!VALID_PROMPT_ROLES.has(role)) {
      throw new Error(`Invalid prompt role: ${role}. Valid roles: ${[...VALID_PROMPT_ROLES].join(', ')}`);
    }

    return {
      role: role,
      path: segment.path || '',
      content: segment.content || '',
      settings: segment.settings || {},
    };
  });
}

function loadContent(input, _log) {
  let content = '';

  // Load content
  if (input.path) {
    // Convert to array if not already
    const pathArray = Array.isArray(input.path) ? input.path : [input.path];

    // Load and concatenate all files
    for (const path of pathArray) {
      const exists = jetpack.exists(path);

      _log('Reading prompt from path:', path);

      if (!exists) {
        return new Error(`Path ${path} not found`);
      } else if (exists === 'dir') {
        return new Error(`Path ${path} is a directory`);
      }

      try {
        const fileContent = jetpack.read(path);
        content += (content ? '\n' : '') + fileContent;
      } catch (e) {
        return new Error(`Error reading file ${path}: ${e}`);
      }
    }
  } else {
    content = input.content;
  }

  return powertools.template(content, input.settings).trim();
}

module.exports = {
  VALID_PROMPT_ROLES,
  normalizePrompt,
  loadContent,
};
