/**
 * The ONE setup contract every service asks its inputs through (#608, Ian
 * 2026-08-25) — the env-side twin of config-flow's resolveConfigValue, and the
 * successor to cp114's two-outcome ensureEnvSecrets.
 *
 * When a service runs and an input it needs is missing, it asks RIGHT THEN,
 * with the same three outcomes everywhere:
 *
 *   Provide             — the Enter-gated open of the exact page that mints
 *                         the value, a masked paste, persisted to the brand
 *                         .env (lib/env-secret.js) and exported for THIS run,
 *                         so a fresh brand configures itself mid-walk.
 *   Skip for now        — this run steps aside; the next one asks again.
 *   Disable permanently — `<service>.enabled: false` lands in omega.json5
 *                         (the tri-state opt-out, #33) and nothing ever asks
 *                         again until the line is deleted.
 *
 * Non-interactive runs (CI, a piped `omega dev` boot, `--dry-run`) NEVER
 * prompt: the missing keys print as a loud skip line and ride back as the
 * machine-readable `missingEnv` list the run summary's 🔑 section aggregates.
 *
 * One class of input is never PASTED: a key OMEGA mints for ITSELF (the env
 * schema's `generated:` set) has nobody to ask, so it is minted in place and
 * never appears in `missingEnv` (#635). When it is the only thing missing no
 * gate opens at all, headless runs included; when a pasted key is missing
 * beside it the gate runs FIRST and the mint happens only past it, so
 * "Disable permanently" never leaves a minted secret behind.
 *
 * WHAT each service needs is the REQUIRES registry's to say (src/config.js —
 * one home, checked up front by lib/preflight.js and asked for here through
 * `serviceInputSpec(name)`); the env schema (@omega.js/config, #581) is what
 * says which of those keys OMEGA mints for itself and which a human acquires,
 * and the sweep test holds the registry to it.
 *
 * Values are never printed — names, labels and mint URLs only.
 */
const chalk = require('chalk').default;

const { generatedEnvKeys } = require('@omega.js/config');
const { canPrompt, dryRunPlan } = require('./run-gates.js');
const { writeEnvValue, mintGeneratedKey } = require('./env-secret.js');
const { confirmSetup, readTriState } = require('./config-flow.js');

/**
 * Ask for a service's missing inputs, with the three-outcome gate.
 *
 * @param {object} context - Service context ({ brandRoot, brandConfig, brandId, options }).
 * @param {object} spec - The input spec (serviceInputSpec(name) builds one from
 *   the REQUIRES registry):
 *   @param {string} spec.service - Service name (names the rerun hint).
 *   @param {string} spec.label - Human name the gate opens with ("Cloudflare").
 *   @param {string} spec.disablePath - Where "Disable permanently" writes `false`.
 *   @param {string[]} [spec.instructions] - Guidance lines shown before the gate.
 *   @param {boolean} [spec.gate] - false = the caller already ran the gate.
 *   @param {Array<{ name, label?, url?, hint?, when? }>} spec.inputs - The env
 *     vars the service needs; `when(brandConfig)` drops the ones this brand
 *     doesn't, `url` is the page that mints one, `hint` says what to make there.
 * @param {object} [deps] - Test seam: { prompt } overrides devkit/prompt members.
 * @returns {Promise<object|null>} null to proceed, or the setup skip shape
 *   ({ skip, reason, missingEnv, disabled? }).
 */
async function requestServiceInput(context, spec, deps = {}) {
  const { brandConfig = {}, options = {} } = context;

  const wanted = spec.inputs.filter((input) => !input.when || input.when(brandConfig));
  const missing = wanted.filter((input) => !process.env[input.name]);
  if (missing.length === 0) {
    return null;
  }

  // Already opted out (#33): the value — or any ancestor section — is `false`.
  // Every service gates on its own key too; this is the backstop that keeps a
  // disabled service from ever reaching a prompt.
  if (readTriState(brandConfig, spec.disablePath).optedOut) {
    return {
      skip: true,
      reason: `${spec.disablePath} is disabled — delete the line in omega.json5 to be asked again`,
      missingEnv: missing.map((input) => input.name),
      disabled: true,
    };
  }

  // A key OMEGA mints for itself (the env schema's `generated:` set, #581) is
  // MINTED, not pasted: there is nobody to ask for it, so it never joins the
  // 🔑 "add these to your .env" list — the two kinds of missing input split
  // here and are handled apart (#635).
  const generated = generatedEnvKeys();
  const mintable = missing.filter((input) => generated[input.name]);
  const pending = missing.filter((input) => !generated[input.name]);

  const mintAll = () => {
    for (const input of mintable) {
      mintGeneratedKey(context.brandRoot, input.name, { indent: '    ' });
    }
  };

  // A dry run says what a real run would mint and writes nothing, exactly as
  // the workspace env-keys op does.
  if (options.dryRun) {
    for (const input of mintable) {
      dryRunPlan(`mint ${input.name} into the brand .env`);
    }
  }

  // Nothing a human could supply is missing: mint and proceed, no gate, on a
  // headless run too.
  if (pending.length === 0) {
    if (options.dryRun) {
      // Named, but NOT as missingEnv — telling someone to paste a key only
      // OMEGA can produce would be a lie the 🔑 section then repeats.
      return {
        skip: true,
        reason: `${mintable.map((input) => input.name).join(', ')} will be minted on a real run`,
        missingEnv: [],
      };
    }

    mintAll();
    return null;
  }

  const names = pending.map((input) => input.name);

  if (!canPrompt(options)) {
    // Loud: a run that cannot ask still says exactly which keys it wants and
    // where they go, instead of a bare "skipped".
    console.log(`    ${chalk.yellow('🔑')} ${spec.label} needs ${chalk.bold(names.join(', '))} ${chalk.dim('— not in the brand .env')}`);
    for (const input of pending) {
      if (input.url) {
        console.log(`      ${chalk.dim(`→ ${input.name}: mint it at ${input.url}`)}`);
      }
    }

    return {
      skip: true,
      reason: `missing ${names.join(', ')} — add to the brand .env, or rerun interactively to paste`,
      missingEnv: names,
    };
  }

  // The uniform gate — its wording lives once, in config-flow's confirmSetup,
  // and its Disable lands the tri-state `false` for us. `gate: false` is the
  // chained ask (resolveConfigValue's convention): the caller already opened
  // this flow's gate, so asking twice would be the same question.
  const action = spec.gate === false
    ? 'yes'
    : await confirmSetup(context, {
      label: spec.label,
      instructions: spec.instructions,
      disablePath: spec.disablePath,
    });

  if (action === 'disable') {
    return {
      skip: true,
      reason: `${spec.disablePath} disabled in omega.json5 — delete the line to be asked again`,
      missingEnv: names,
      disabled: true,
    };
  }

  if (action !== 'yes') {
    return {
      skip: true,
      reason: `skipped this run — ${spec.service} still needs ${names.join(', ')}`,
      missingEnv: names,
    };
  }

  // Past the gate: only NOW are OMEGA's own keys minted, so a "Disable
  // permanently" never leaves a freshly minted secret in a brand that just
  // said it wants none of this.
  mintAll();

  const prompt = { ...require('@omega.js/devkit/prompt'), ...deps.prompt };

  for (const input of pending) {
    const label = input.label || input.name;
    if (input.hint) {
      console.log(`      ${chalk.dim(input.hint)}`);
    }

    // The exact-page guide: Enter opens the page that mints the value
    // (pressEnterToOpen always prints the URL, so it stays clickable when the
    // user would rather not open a browser).
    if (input.url) {
      await prompt.pressEnterToOpen(input.url, `the ${label} page`);
    }

    const value = (await prompt.password({ message: `Paste ${input.name}:` }) || '').trim();
    if (!value) {
      return {
        skip: true,
        reason: `nothing entered for ${input.name} — ${spec.service} still needs ${names.join(', ')}`,
        missingEnv: names,
      };
    }

    writeEnvValue(context.brandRoot, input.name, value);
    process.env[input.name] = value;
    console.log(`    ${chalk.green('✓')} ${input.name} saved to the brand .env`);
  }

  return null;
}

module.exports = { requestServiceInput };
