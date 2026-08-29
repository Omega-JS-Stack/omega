/**
 * Ensure a verified SendGrid sender identity for the brand.
 *
 * Single Sends require a registered sender (not an inline from address);
 * each brand gets one: offers@{contact-email domain} with the brand's name.
 * It auto-verifies because domain-auth runs first. @omega.js/backend resolves the sender
 * id at runtime by from_email, so nothing lands in state.
 *
 * CAN-SPAM requires a physical mailing address — brand.address in
 * omega.json5. omega-manager silently stamped the company's address on
 * every brand; the port ASKS for the brand's own (#635) and warns only when
 * nobody can be asked.
 */
const chalk = require('chalk').default;
const { input } = require('@omega.js/devkit/prompt');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');
const { confirmSetup, landValue } = require('../../../lib/config-flow.js');

// The five fields brand.address carries. Only the three SendGrid cannot
// create a sender without are required — an address with no region or postal
// code is a real address in plenty of countries.
const ADDRESS_FIELDS = [
  { key: 'line1', message: 'Street address:', required: true },
  { key: 'city', message: 'City:', required: true },
  { key: 'region', message: 'State / region:' },
  { key: 'postalCode', message: 'Postal code:' },
  { key: 'country', message: 'Country:', required: true },
];

/**
 * Ask for the brand's mailing address and land it as ONE brand.address object
 * (#635). Five fields behind ONE gate — asking the Provide / Skip / Disable
 * question per field would be the same question five times. The campaigns
 * service already gated on its API key, so this gate is about the address.
 *
 * @param {Object} context - Handler context.
 * @returns {Promise<Object|null>} The landed address, or null when the user
 *   stepped aside or left a required field empty.
 */
async function askBrandAddress(context) {
  const action = await confirmSetup(context, {
    label: 'Mailing address (CAN-SPAM)',
    instructions: ['Every marketing email must carry a physical mailing address — it lands in brand.address'],
    disablePath: 'marketing.campaigns.enabled',
  });
  if (action !== 'yes') {
    return null;
  }

  const address = {};
  for (const field of ADDRESS_FIELDS) {
    const value = (await input({ message: field.message }) || '').trim();
    if (!value) {
      if (field.required) {
        return null;
      }
      continue;
    }
    address[field.key] = value;
  }

  landValue(context, 'brand.address', address);
  return address;
}

module.exports = async function ensureSenderIdentity(context) {
  const { sendgridApi: api, brandConfig, options = {} } = context;

  const brandName = brandConfig.brand.name;
  const contactEmail = brandConfig.brand?.contact?.email;
  const contactDomain = contactEmail?.split('@')[1];

  if (!contactDomain) {
    console.log(chalk.dim('      ⊘ No brand.contact.email configured — nothing to register'));
    return {};
  }

  const fromEmail = `offers@${contactDomain}`;

  const senders = await api.getVerifiedSenders();
  const match = senders.find((s) => s.from_email === fromEmail);
  // The nickname is the managed handle (unique per SendGrid account) — a
  // sender with this brand's nickname but another address is a stale
  // derivation (contact.email changed) and would 400 the create below
  const stale = senders.find((s) => s.nickname === brandName && s.from_email !== fromEmail);

  if (match && match.verified !== false) {
    console.log(`      ${chalk.green('✓')} Verified sender ${chalk.cyan(fromEmail)} ${chalk.dim(`(id: ${match.id})`)}`);
    return { output: { senderIdentity: { id: match.id, fromEmail, verified: true } } };
  }

  // The physical address is required for creation — and it must be the
  // brand's own (no company default to fall back on), so a run that can ask
  // ASKS for it here rather than warning and stepping aside (#635).
  const complete = (candidate) => Boolean(candidate?.line1 && candidate?.city && candidate?.country);

  let address = brandConfig.brand?.address;
  if (!complete(address) && canPrompt(options)) {
    address = await askBrandAddress(context);
  }

  if (!complete(address)) {
    console.log(`      ${chalk.yellow('⚠')} No sender ${chalk.cyan(fromEmail)} yet, and CAN-SPAM requires a physical mailing address`);
    console.log(`      ${chalk.dim('→')} Set brand.address (line1, city, region, postalCode, country) in omega.json5, then rerun`);
    return { status: 'warned', output: { senderIdentity: { fromEmail, missingAddress: true } } };
  }

  if (options.dryRun) {
    const planned = match ? 'recreate-unverified-sender' : stale ? 'replace-stale-nickname-sender' : 'create-sender';
    return dryRunPlan(`${planned} (${fromEmail})`, { output: { senderIdentity: { planned, fromEmail } } });
  }

  // An unverified leftover can't be verified retroactively — recreate it
  // cleanly now that domain authentication is in place
  if (match) {
    await api.deleteVerifiedSender(match.id);
    console.log(`      ${chalk.yellow('↻')} Deleted unverified sender ${chalk.cyan(fromEmail)} for recreation`);
  }

  if (stale) {
    if (stale.verified === false) {
      await api.deleteVerifiedSender(stale.id);
      console.log(`      ${chalk.yellow('↻')} Deleted stale unverified sender ${chalk.cyan(stale.from_email)} — the contact domain changed`);
    } else {
      console.log(`      ${chalk.yellow('⚠')} Verified sender ${chalk.cyan(stale.from_email)} already uses the nickname ${chalk.cyan(brandName)} — delete it in SendGrid or align brand.contact.email, then rerun`);
      return { status: 'warned', output: { senderIdentity: { fromEmail, staleNickname: stale.from_email } } };
    }
  }

  const sender = await api.createVerifiedSender({
    nickname: brandName,
    fromEmail,
    fromName: brandName,
    replyToEmail: contactEmail,
    replyToName: brandName,
    address: {
      street: address.line1,
      street2: address.line2 || '',
      city: address.city,
      state: address.region,
      zip: address.postalCode,
      country: address.country,
    },
  });

  if (sender.verified === false) {
    console.log(`      ${chalk.yellow('⚠')} Created sender ${chalk.cyan(fromEmail)} but it did not auto-verify — ensure domain authentication is valid, then rerun`);
    return { status: 'warned', output: { senderIdentity: { id: sender.id, fromEmail, verified: false } } };
  }

  console.log(`      ${chalk.green('✓')} Created verified sender ${chalk.cyan(fromEmail)} ${chalk.dim(`(id: ${sender.id})`)}`);
  return { output: { senderIdentity: { id: sender.id, fromEmail, verified: true } } };
};
