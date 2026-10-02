/**
 * The ONE setup contract every service asks its inputs through, the
 * env-side twin of config-flow's resolveConfigValue. A missing input is asked
 * for RIGHT THEN with three outcomes: Provide (Enter opens the page that mints
 * it, a masked paste lands in the brand .env and this run), Skip for now, or
 * Disable permanently (the tri-state `false` lands in omega.json5). A run that
 * cannot prompt prints a loud skip and returns the `missingEnv` list the 🔑
 * summary aggregates. A key OMEGA mints is minted, never asked, and only past
 * the gate. WHICH inputs this brand owes is @omega.js/config's missingEnvKeys
 * for `manage`, the answer preflight checks too; `serviceInputSpec(name)`
 * supplies the manager's half. Values are never printed, names only.
 */
const chalk = require('chalk').default;

const { generatedEnvKeys, serviceAskedKeys } = require('@omega.js/config');
const { REQUIRES, serviceInputs } = require('../config.js');
const { canPrompt, dryRunPlan } = require('./run-gates.js');
const { writeEnvValue, mintGeneratedKey } = require('./env-secret.js');
const { confirmSetup, readTriState } = require('./config-flow.js');

/**
 * Ask for a service's missing inputs, with the three-outcome gate.
 * @param {object} context - Service context ({ brandRoot, brandConfig, brandId, options }).
 * @param {object} spec - serviceInputSpec(name)'s spec: `service`, `label`,
 *   `disablePath`, `instructions?`, `gate?` (false = the caller ran it),
 *   `narrowed?` (the caller named its inputs, each a key it is about to use,
 *   so one this brand does not owe skips the service) and `inputs`
 *   ([{ name, label?, url?, hint?, gates? }]).
 * @param {object} [deps] - Test seam: { prompt } overrides devkit/prompt members.
 * @returns {Promise<object|null>} null to proceed, or the setup skip shape
 *   ({ skip, reason, missingEnv, disabled? }).
 */
async function requestServiceInput(context, spec, deps = {}) {
  const { brandConfig = {}, options = {} } = context;

  const absent = spec.inputs.filter((input) => !process.env[input.name]);
  if (absent.length === 0) {
    return null;
  }

  // Already opted out (#33): the value — or any ancestor section — is `false`.
  // Every service gates on its own key too; this is the backstop that keeps a
  // disabled service from ever reaching a prompt.
  if (readTriState(brandConfig, spec.disablePath).optedOut) {
    return {
      skip: true,
      reason: `${spec.disablePath} is disabled — delete the line in omega.json5 to be asked again`,
      missingEnv: absent.map((input) => input.name),
      disabled: true,
    };
  }

  // Which of its inputs this brand owes is the one answer's, for the keys the
  // schema governs for this service. Any other input, and a key OMEGA mints
  // (minting asks nobody), is wanted whenever it is absent.
  const generated = generatedEnvKeys();
  const governed = new Set(REQUIRES[spec.service] ? serviceInputs(spec.service).map((input) => input.name) : []);
  const owed = serviceAskedKeys(brandConfig, spec.service);
  const missing = absent.filter((input) => !governed.has(input.name) || owed.has(input.name) || generated[input.name]);

  // A named key this brand does not owe, or a service none of whose gating
  // keys it owes (no target reads them, or the feature is off): nothing to
  // ask and nothing to run with. An unnamed optional input simply drops.
  const unowed = spec.narrowed
    ? absent.filter((input) => !missing.includes(input))
    : spec.inputs.filter((input) => governed.has(input.name) && input.gates !== false);
  if (unowed.length > 0 && unowed.every((input) => !owed.has(input.name))) {
    return {
      skip: true,
      reason: `${spec.label}: this brand's config needs no ${unowed.map((input) => input.name).join(', ')}`,
      missingEnv: [],
    };
  }

  if (missing.length === 0) {
    return null;
  }

  // A key OMEGA mints is MINTED, not pasted: there is nobody to ask for it, so
  // it never joins the 🔑 "add these to your .env" list.
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
