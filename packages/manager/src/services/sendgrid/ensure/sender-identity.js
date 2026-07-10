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
 * every brand; the port warns until a real one is configured.
 */
const chalk = require('chalk').default;

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

  if (match && match.verified !== false) {
    console.log(`      ${chalk.green('✓')} Verified sender ${chalk.cyan(fromEmail)} ${chalk.dim(`(id: ${match.id})`)}`);
    return { output: { senderIdentity: { id: match.id, fromEmail, verified: true } } };
  }

  // The physical address is required for creation — and it must be the
  // brand's own (no company default to fall back on)
  const address = brandConfig.brand?.address;
  if (!address?.line1 || !address?.city || !address?.country) {
    console.log(`      ${chalk.yellow('⚠')} No sender ${chalk.cyan(fromEmail)} yet, and CAN-SPAM requires a physical mailing address`);
    console.log(`      ${chalk.dim('→')} Set brand.address (line1, city, region, postalCode, country) in omega.json5, then rerun`);
    return { status: 'warned', output: { senderIdentity: { fromEmail, missingAddress: true } } };
  }

  if (options.dryRun) {
    const planned = match ? 'recreate-unverified-sender' : 'create-sender';
    console.log(`      ${chalk.dim(`⊘ Dry run — would ${planned} (${fromEmail})`)}`);
    return { output: { senderIdentity: { planned, fromEmail } } };
  }

  // An unverified leftover can't be verified retroactively — recreate it
  // cleanly now that domain authentication is in place
  if (match) {
    await api.deleteVerifiedSender(match.id);
    console.log(`      ${chalk.yellow('↻')} Deleted unverified sender ${chalk.cyan(fromEmail)} for recreation`);
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
