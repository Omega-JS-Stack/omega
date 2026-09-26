/**
 * Shared pure formatting helpers for the two Claude providers (anthropic,
 * claude-code). Both hit the same Claude Messages API — only auth differs — so
 * the option-shape → request-body mapping lives here once.
 *
 * Handles the unified cross-provider message conventions:
 *   - { role: 'system'|'developer'|'user'|'assistant', content: string }
 *   - { role: 'assistant', content?, toolCalls: [{ id, name, arguments }] }
 *     → ctx turn with tool_use blocks
 *   - { role: 'tool', toolCallId, content } → tool_result block; consecutive
 *     tool turns merge into ONE user turn (the Messages API requires all
 *     results for an ctx turn in a single following user message)
 *   - raw Anthropic block arrays (content: [{ type, ... }]) pass through untouched
 *
 * All functions are pure — no network, no SDK — so they're unit-testable
 * without an ctx.
 */
const { normalizePrompt, loadContent } = require('../prompt.js');

// loadContent logs each prompt-file read through the caller's logger; the
// formatters are pure and carry none
function noopLog() {}

/**
 * Map normalized function-tool definitions to Anthropic tool definitions.
 *
 * Accepts entries shaped { name, description, parameters } (optionally with
 * type: 'function'). Provider-specific hosted tools (any other `type`, e.g.
 * OpenAI's { type: 'web_search' }) have no Anthropic equivalent — throw with a
 * clear message instead of silently dropping them.
 *
 * @param {Array} list - options.tools.list
 * @returns {Array<{name, description, input_schema}>}
 */
function buildToolDefs(list) {
  if (!Array.isArray(list) || !list.length) {
    return [];
  }

  return list.map((tool) => {
    if (!tool || !tool.name || (tool.type && tool.type !== 'function')) {
      throw new Error(`Anthropic tools must be function tools ({ name, description, parameters }) — got ${JSON.stringify(tool && (tool.type || tool.name) || tool)}`);
    }

    return {
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.parameters || { type: 'object', properties: {} },
    };
  });
}

/**
 * Map the unified tools.choice value to Anthropic's tool_choice.
 *
 * 'auto' → { type: 'auto' }, 'required' → { type: 'any' },
 * 'none' → { type: 'none' }, { name } → { type: 'tool', name }
 */
function buildToolChoice(choice) {
  if (!choice) {
    return undefined;
  }

  if (choice === 'auto') {
    return { type: 'auto' };
  }

  if (choice === 'required') {
    return { type: 'any' };
  }

  if (choice === 'none') {
    return { type: 'none' };
  }

  if (typeof choice === 'object' && choice.name) {
    return { type: 'tool', name: choice.name };
  }

  return undefined;
}

/**
 * Build Anthropic { system, messages } from the unified option shape.
 *
 * Accepts either:
 *   - options.messages: unified turns (see module header)
 *   - options.prompt (object OR multi-role array form) + options.message.content
 */
function buildMessages(options) {
  if (!Array.isArray(options.messages) || !options.messages.length) {
    return buildFromPrompt(options);
  }

  // System: collect system + developer turns (Anthropic has no developer role —
  // fold it into the system prompt, preserving order)
  const system = options.messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => stringifyContent(m.content))
    .filter(Boolean)
    .join('\n\n');

  const messages = [];

  for (const m of options.messages) {
    if (m.role === 'system' || m.role === 'developer') {
      continue;
    }

    // Tool result turn → tool_result block; merge into the previous user turn
    // if that turn is already a tool-result carrier (consecutive results)
    if (m.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
      };

      const last = messages[messages.length - 1];

      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((c) => c.type === 'tool_result')) {
        last.content.push(block);
      } else {
        messages.push({ role: 'user', content: [block] });
      }

      continue;
    }

    // Raw Anthropic block arrays pass through untouched (callers may replay
    // raw.content from a prior response verbatim)
    if (Array.isArray(m.content) && m.content.some((c) => c && typeof c === 'object' && c.type)) {
      messages.push({ role: m.role, content: m.content });
      continue;
    }

    // Assistant turn with tool calls → text block (if any) + tool_use blocks
    if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length) {
      const content = [];
      const text = stringifyContent(m.content || '');

      if (text) {
        content.push({ type: 'text', text });
      }

      for (const call of m.toolCalls) {
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: parseArguments(call.arguments),
        });
      }

      messages.push({ role: 'assistant', content });
      continue;
    }

    // Plain text turn
    messages.push({ role: m.role, content: stringifyContent(m.content) });
  }

  return { system, messages };
}

/**
 * Build { system, messages } from the prompt/message form.
 *
 * The prompt resolves through the SAME segment loader the OpenAI provider uses,
 * so both forms behave identically here: a prompt-file `path` is read and
 * templated, the array form keeps every segment, and the object form is the
 * single implicit 'system' segment. system + developer segments become the
 * system prompt (Anthropic has no developer role); user + assistant segments
 * become turns ahead of the user message.
 */
function buildFromPrompt(options) {
  const segments = normalizePrompt(options.prompt).map((segment) => {
    // Content blocks flatten before loading — loadContent templates strings
    const input = segment.path ? segment : { ...segment, content: stringifyContent(segment.content) };
    const content = loadContent(input, noopLog);

    if (content instanceof Error) {
      throw new Error(`Error loading prompt[${segment.role}]: ${content.message}`);
    }

    return { role: segment.role, content: content };
  });

  const system = segments
    .filter((s) => s.role === 'system' || s.role === 'developer')
    .map((s) => s.content)
    .filter(Boolean)
    .join('\n\n');

  const messages = [];

  for (const segment of segments) {
    if (segment.role === 'user' || segment.role === 'assistant') {
      pushTextTurn(messages, segment.role, segment.content);
    }
  }

  const message = stringifyContent(options.message?.content || '');

  // An empty message still gets its turn when nothing else carries the
  // conversation — the Messages API requires at least one
  if (message || !messages.length) {
    pushTextTurn(messages, 'user', message);
  }

  return { system, messages };
}

// The Messages API rejects consecutive same-role turns, so text destined for
// one that is already open joins it instead of opening a second
function pushTextTurn(messages, role, content) {
  const last = messages[messages.length - 1];

  if (last && last.role === role && typeof last.content === 'string') {
    last.content = [last.content, content].filter(Boolean).join('\n\n');
    return;
  }

  messages.push({ role: role, content: content });
}

/**
 * Extract normalized tool calls from a response's content blocks.
 *
 * @param {Array} content - raw.content from the Messages API
 * @returns {Array<{id, name, arguments}>} arguments is the parsed input object
 */
function extractToolCalls(content) {
  return (content || [])
    .filter((c) => c.type === 'tool_use')
    .map((c) => ({ id: c.id, name: c.name, arguments: c.input || {} }));
}

/**
 * Map Anthropic stop_reason to the normalized stopReason.
 */
function mapStopReason(stopReason) {
  if (stopReason === 'tool_use') {
    return 'tool_use';
  }

  if (stopReason === 'max_tokens') {
    return 'max_tokens';
  }

  return 'end';
}

function parseArguments(args) {
  if (args && typeof args === 'object') {
    return args;
  }

  if (typeof args === 'string' && args.trim()) {
    try {
      return JSON.parse(args);
    } catch (e) {
      return {};
    }
  }

  return {};
}

function stringifyContent(content) {
  if (!content) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  // OpenAI sometimes uses [{ type: 'input_text', text: '...' }] — flatten to string
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === 'input_text' || c.type === 'text')
      .map((c) => c.text || '')
      .join('\n');
  }

  return String(content);
}

module.exports = {
  buildToolDefs,
  buildToolChoice,
  buildMessages,
  extractToolCalls,
  mapStopReason,
  stringifyContent,
};
