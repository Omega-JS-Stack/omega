/**
 * AI providers for the translation engine — `claude` (default; rides the
 * locally-installed Claude Code via @anthropic-ai/claude-agent-sdk, so no API
 * key is needed) and `chatgpt` (OpenAI Responses API via native fetch;
 * requires OPENAI_API_KEY). Both expose the same contract:
 *   provider.send({ system, user }) → Promise<{ text, usage }>
 * where usage is { input, output } token counts (zeros when unreported).
 *
 * The Agent SDK is lazy-required so it resolves from the CONSUMING framework
 * package (@omega.js/web, @omega.js/extension declare the dependency) — devkit
 * itself stays dependency-free here.
 */

const PROVIDERS = ['claude', 'chatgpt'];

// Default model per provider. 'sonnet' is the Claude Code alias that tracks
// the current Sonnet — no stale date pins in framework code.
const DEFAULT_MODELS = {
  claude: 'sonnet',
  chatgpt: 'gpt-5.4-nano',
};

/**
 * Build a provider handle from config values.
 * @param {object} options
 * @param {string} [options.provider] - 'claude' (default) or 'chatgpt'
 * @param {string} [options.model] - model override (default per provider)
 * @param {Function} [options.fetchFn] - fetch override (tests)
 * @returns {{ name: string, model: string, send: Function }}
 */
function resolveProvider(options) {
  options = options || {};
  const name = options.provider || 'claude';

  if (!PROVIDERS.includes(name)) {
    throw new Error(`Unknown translation provider "${name}" — use ${PROVIDERS.map((p) => `'${p}'`).join(' or ')}`);
  }

  const model = options.model || DEFAULT_MODELS[name];
  const send = name === 'claude'
    ? (message) => sendClaude(model, message)
    : (message) => sendChatgpt(model, message, options.fetchFn);

  return { name, model, send };
}

/**
 * Send one prompt through the local Claude Code install (Agent SDK).
 * @param {string} model - model name/alias
 * @param {{ system: string, user: string }} message
 * @returns {Promise<{ text: string, usage: { input: number, output: number } }>}
 */
async function sendClaude(model, message) {
  let query;
  try {
    ({ query } = require('@anthropic-ai/claude-agent-sdk'));
  } catch (e) {
    throw new Error('The claude translation provider needs @anthropic-ai/claude-agent-sdk (ships with the framework package) and a local Claude Code install/auth — or set translation.provider to "chatgpt".');
  }

  let text = '';
  const usage = { input: 0, output: 0 };

  // Hermetic single-shot: settingSources [] keeps the user's CLAUDE.md/hooks
  // out of the session (they pollute mechanical output), the system prompt
  // replaces the CLI persona, and no maxTurns cap — a plain reply already
  // counts as the final turn and a cap of 1 reports error_max_turns.
  //
  // Subscription-only by contract: this provider rides the local Claude
  // Code install's own login. A stray ANTHROPIC_API_KEY anywhere in the
  // env cascade would silently flip the SDK to API-credit billing — the
  // child env hides it so the subscription is the ONLY auth path.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  for await (const event of query({
    prompt: message.user,
    options: {
      model,
      allowedTools: [],
      settingSources: [],
      systemPrompt: message.system,
      env,
    },
  })) {
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text') {
          text += block.text;
        }
      }
    }

    if (event.type === 'result' && event.usage) {
      usage.input += event.usage.input_tokens || 0;
      usage.output += event.usage.output_tokens || 0;
    }
  }

  return { text, usage };
}

/**
 * Send one prompt through the OpenAI Responses API.
 * @param {string} model - model name
 * @param {{ system: string, user: string }} message
 * @param {Function} [fetchFn] - fetch override (tests)
 * @returns {Promise<{ text: string, usage: { input: number, output: number } }>}
 */
async function sendChatgpt(model, message, fetchFn) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('The chatgpt translation provider requires OPENAI_API_KEY in the environment (.env cascade) — or use the default "claude" provider (local Claude Code, no key).');
  }

  const doFetch = fetchFn || fetch;
  const response = await doFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(240000),
    body: JSON.stringify({
      model,
      input: [
        { role: 'developer', content: message.system },
        { role: 'user', content: message.user },
      ],
      reasoning: { effort: 'low' },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();

  // Reasoning models emit a reasoning item first — find the message item
  const item = (data.output || []).find((o) => o.type === 'message');
  const text = item?.content?.[0]?.text || '';

  return {
    text,
    usage: {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
    },
  };
}

module.exports = { PROVIDERS, DEFAULT_MODELS, resolveProvider };
