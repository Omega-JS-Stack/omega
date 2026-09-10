/**
 * Transactional email library — build and send individual emails via SendGrid
 *
 * Pipeline: prepare (shared) → recipients (transactional-only) → render → deliver
 *
 * Usage:
 *   const email = Manager.Email(ctx);
 *   const result = await email.send(settings);
 *
 * Used by:
 * - POST /admin/email route
 * - POST /general/email route
 * - Payment transition handlers (send-email.js)
 * - Auth on-create handler (welcome/checkup/feedback emails)
 */
const _ = require('lodash');
const moment = require('moment');
const powertools = require('node-powertools');
const pushid = require('pushid');

const { SEND_AT_LIMIT, errorWithCode } = require('../constants.js');
const prepare = require('../prepare.js');
const env = require('../../env.js');

function Transactional(ctx) {
  const self = this;

  self.ctx = ctx;
  self.Manager = ctx.Manager;
  self.admin = self.Manager.libraries.admin;

  return self;
}

/**
 * Build a complete SendGrid email object from settings.
 *
 * Steps:
 *   1. Resolve brand + sender (shared)
 *   2. Resolve recipients (transactional-only: normalize, UID lookup, CC, dedup)
 *   3. Build template data tree (shared) + render content through MJML
 *   4. Assemble SendGrid Mail Send object
 *
 * @param {object} settings - Email settings (to, cc, bcc, subject, template, etc.)
 * @returns {object} SendGrid-ready email object
 * @throws {Error} On validation failure
 */
Transactional.prototype.build = async function (settings) {
  const self = this;
  const Manager = self.Manager;
  const admin = self.admin;
  const ctx = self.ctx;

  // --- 1. Brand + sender ---
  const { brand, brandDomain } = prepare.resolveBrand(Manager);
  const { from, groupId } = prepare.resolveSender(settings, brand, brandDomain, Manager);
  const categories = prepare.buildCategories('transactional', brand.id, settings.categories);
  const signoff = prepare.resolveSignoff(settings?.data?.signoff, brand);

  const templateName = resolveTemplateName(settings);

  // --- 2. Recipients ---
  let to = normalizeRecipients(settings.to);
  let cc = normalizeRecipients(settings.cc);
  let bcc = normalizeRecipients(settings.bcc);

  [to, cc, bcc] = await Promise.all([
    resolveRecipients(to, admin, ctx),
    resolveRecipients(cc, admin, ctx),
    resolveRecipients(bcc, admin, ctx),
  ]);

  // Extract user properties from primary recipient for template data
  const rawUserDoc = to[0]?._userDoc || {};
  const userProperties = Manager.User(rawUserDoc).properties;
  delete userProperties.api;
  delete userProperties.connections;
  delete userProperties.activity;
  delete userProperties.affiliate;
  delete userProperties.attribution;
  delete userProperties.flags;

  // Clean internal markers
  for (const list of [to, cc, bcc]) {
    for (const entry of list) {
      delete entry._userDoc;
    }
  }

  const copy = settings.copy ?? true;

  if (copy) {
    cc.push({ email: brand.contact.email, name: brand.name });

    // Audit BCCs are per-brand config (brand.contact.carbonCopy). Unset = no audit
    // copies; the framework never inserts its own addresses into a brand's mail.
    for (const entry of powertools.arrayify(brand.contact.carbonCopy || [])) {
      if (!entry?.email) {
        throw errorWithCode('Each brand.contact.carbonCopy entry needs an email in config/omega.json5', 400);
      }

      bcc.push({ email: entry.email, name: entry.name || brand.company || brand.name });
    }
  }

  ({ to, cc, bcc } = deduplicateRecipients(to, cc, bcc));

  for (const list of [to, cc, bcc]) {
    for (const entry of list) {
      if (!entry.name) {
        delete entry.name;
      }
    }
  }

  // Validate
  if (!to.length || !to[0].email) {
    throw errorWithCode('Parameter to is required with at least one email', 400);
  }

  const subject = settings.subject || settings?.data?.email?.subject || null;

  if (!subject) {
    throw errorWithCode('Parameter subject is required', 400);
  }

  const preview = settings.preview || settings?.data?.email?.preview || null;

  // --- 3. Template data + render ---
  const unsubscribeUrl = prepare.buildUnsubscribeUrl({
    email: to[0].email,
    groupId,
    template: templateName,
    websiteUrl: Manager.project.websiteUrl,
  });

  // TEMPORARY: shim for emails queued before the MJML migration (data.body → data.content)
  if (settings?.data?.body && !settings?.data?.content) {
    settings.data.content = settings.data.body;
  }

  // Render markdown content to HTML (if provided)
  const utmCampaign = (settings.categories && settings.categories[0]) || settings.sender || templateName;
  const utmOptions = {
    brandUrl: brand.url,
    brandId: brand.id,
    campaign: utmCampaign,
    type: 'transactional',
    utm: settings.utm,
  };
  const contentHtml = prepare.renderContent(
    {
      content: settings?.data?.content?.message,
      html: settings?.data?.content?.html,
      trusted: settings.trustedContent,
    },
    utmOptions,
  );

  const templateData = prepare.buildTemplateData({
    brand,
    subject,
    preview,
    contentHtml,
    signoff,
    unsubscribeUrl,
    categories,
    copy,
    callerData: {
      personalization: { email: to[0].email, name: to[0].name },
      user: userProperties,
      ...settings.data,
    },
  });

  // Process markdown in any remaining body fields that the caller set directly.
  // Goes through renderContent so this render honors the same trust decision as the
  // one above — a second html:true renderer here would reopen the escaped lane.
  if (templateData.content?.message && typeof templateData.content.message === 'string' && !templateData.content.message.startsWith('<')) {
    templateData.content.message = prepare.renderContent(
      { content: templateData.content.message, trusted: settings.trustedContent },
      utmOptions,
    );
  }

  // Render through MJML template
  const rendered = await prepare.render({ brand, template: templateName, data: templateData });

  // --- 4. Assemble SendGrid object ---
  const sendAt = normalizeSendAt(settings.sendAt);

  const email = {
    to,
    cc,
    bcc,
    from,
    replyTo: settings.replyTo || from.email,
    subject,
    content: [{ type: 'text/html', value: rendered.html }],
    categories,
    asm: { groupId },
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
  };

  if (sendAt) {
    email.sendAt = sendAt;
  }

  // Raw HTML override — caller provides complete HTML, skip MJML. INTERNAL callers
  // only: the external lanes reject `html` through prepare.internalOnlyFieldFault()
  // before they ever reach here ([#125](https://github.com/Omega-JS-Stack/omega/issues/125)).
  if (settings.html) {
    email.content = [{ type: 'text/html', value: settings.html }];
  }

  return email;
};

/**
 * Build and send an email via SendGrid, or queue it if scheduled beyond the limit,
 * or record it in testing mode instead of delivering it.
 * Calls .build() internally — callers only need to pass raw settings.
 *
 * @param {object} settings - Email settings (to, cc, bcc, subject, template, etc.)
 * @returns {{ status: 'sent'|'queued'|'captured', options?: object, response?: object }}
 * @throws {Error} With code 400 for validation errors, code 500 for send failures
 */
Transactional.prototype.send = async function (settings) {
  const self = this;
  const Manager = self.Manager;
  const admin = self.admin;
  const ctx = self.ctx;

  ctx.log(`Email.send(): to=${describeRecipients(settings.to)}, subject=${settings.subject}, template=${settings.template}`);

  const email = await self.build(settings);

  // If scheduled beyond the limit, queue for later
  if (email.sendAt && email.sendAt >= moment().add(SEND_AT_LIMIT, 'hours').unix()) {
    await saveToEmailQueue(settings, email.sendAt, admin, ctx);

    return { status: 'queued', options: email, response: null };
  }

  // Testing-mode capture — the ONE seam that stands in for SendGrid, so no caller
  // has to gate itself and every sender behaves alike
  // ([#774](https://github.com/Omega-JS-Stack/omega/issues/774)). It sits PAST
  // build(), so the brand, the recipients, the template data and the MJML render
  // are the real ones and a broken email fails a test. Extended mode is untouched:
  // it still delivers. The audit trail and the analytics event belong to a delivery
  // and are not written for a capture.
  const capture = require('../../../../test/utils/email-capture.js');

  if (capture.isCapturing(ctx)) {
    const record = capture.recordCaptured(Manager, {
      to: email.to,
      template: resolveTemplateName(settings),
      subject: email.subject,
      html: email.content[0]?.value,
      sendAt: email.sendAt || null,
    });

    ctx.log(`Email.send(): captured (testing mode): to=${record.to.join(', ')}, template=${record.template}`);

    return { status: 'captured', options: email, response: null };
  }

  // Initialize SendGrid
  const sendgrid = Manager.require('@sendgrid/mail');
  sendgrid.setApiKey(env.get('SENDGRID_API_KEY'));

  // Send via SendGrid
  const send = await sendgrid.send(email).catch(e => e);

  if (send instanceof Error) {
    // SendGrid's own `errors` array is the diagnostic. A network-level failure rejects
    // with the raw axios error instead, whose `config` echoes the request — headers and
    // all, the API key included — so the fallback is the message, never the error whole
    // ([#632](https://github.com/Omega-JS-Stack/omega/issues/632)).
    const details = send?.response?.body?.errors || send?.response?.body || send.message;
    ctx.error('Email send failed:', details);
    throw errorWithCode(`Failed to send email: ${JSON.stringify(details)}`, 500);
  }

  const messageId = send[0].headers['x-message-id'];
  ctx.log('Email send succeeded:', messageId, send);

  saveAuditTrail(email, messageId, admin, ctx);

  if (ctx.analytics) {
    ctx.analytics.event('admin/email', { status: 'sent' });
  }

  return { status: 'sent', options: email, response: send };
};

// --- Templates ---

// TEMPORARY: shim for emails queued before the MJML migration (old template names)
const LEGACY_TEMPLATE_MAP = { 'default': 'card', 'core/engagement/feedback': 'feedback' };

/**
 * The template that actually renders these settings.
 *
 * Its own function because build() renders through it and the testing-mode capture
 * records it — a second copy of the legacy map would drift from the render.
 *
 * @param {object} settings - Email settings
 * @returns {string} The resolved template name
 */
function resolveTemplateName(settings) {
  return LEGACY_TEMPLATE_MAP[settings.template] || settings.template || 'card';
}

// --- Recipients (transactional-only) ---

function normalizeRecipients(input) {
  if (!input) {
    return [];
  }

  const items = Array.isArray(input) ? input : [input];
  const result = [];

  for (const item of items) {
    if (!item) {
      continue;
    }

    if (typeof item === 'string') {
      if (item.includes('@')) {
        result.push({ email: item });
      } else {
        result.push({ _uid: item });
      }
    } else if (typeof item === 'object' && item.auth?.email) {
      result.push({
        email: item.auth.email,
        ...(item.personal?.name?.first && { name: item.personal.name.first }),
        _userDoc: item,
      });
    } else if (typeof item === 'object' && item.email) {
      result.push({ email: item.email, ...(item.name && { name: item.name }) });
    }
  }

  return result;
}

/**
 * Render recipients for a LOG line — addresses only, never the object itself.
 *
 * Callers may hand `to` a whole user document (the order and welcome senders do),
 * and that document carries api.privateKey, consent, IP and attribution. A backend
 * log line lands in Cloud Logging and stays for the retention window, so the line
 * names its recipient the way the rest of the framework does: by address, or by uid
 * when that is all the caller knew
 * ([#632](https://github.com/Omega-JS-Stack/omega/issues/632)).
 *
 * Goes through normalizeRecipients() so the log agrees with what actually gets sent.
 *
 * @param {*} input - Whatever the caller passed as to/cc/bcc
 * @returns {string} Comma-joined addresses/uids, or '(none)'
 */
function describeRecipients(input) {
  const described = normalizeRecipients(input)
    .map(entry => entry.email || (entry._uid ? `uid:${entry._uid}` : null))
    .filter(Boolean);

  return described.length ? described.join(', ') : '(none)';
}

async function resolveRecipients(recipients, admin, ctx) {
  const uidEntries = recipients.filter(r => r._uid);
  const nonUidEntries = recipients.filter(r => !r._uid);

  if (uidEntries.length === 0) {
    return nonUidEntries;
  }

  const snapshots = await Promise.all(
    uidEntries.map(entry =>
      admin.firestore().doc(`users/${entry._uid}`).get()
        .catch(e => {
          ctx.error(`resolveRecipients(): Failed to fetch user ${entry._uid}`, e);
          return null;
        })
    )
  );

  const resolved = [];

  for (let i = 0; i < uidEntries.length; i++) {
    const snap = snapshots[i];

    if (!snap || !snap.exists) {
      ctx.warn(`resolveRecipients(): User ${uidEntries[i]._uid} not found, skipping`);
      continue;
    }

    const data = snap.data();
    const email = data?.auth?.email;

    if (!email) {
      ctx.warn(`resolveRecipients(): User ${uidEntries[i]._uid} has no email, skipping`);
      continue;
    }

    resolved.push({
      email,
      ...(data?.personal?.name?.first && { name: data.personal.name.first }),
      _userDoc: data,
    });
  }

  return [...nonUidEntries, ...resolved];
}

function deduplicateRecipients(to, cc, bcc) {
  const dedup = (arr) => {
    const seen = new Set();

    return arr.filter(r => {
      if (!r.email || typeof r.email !== 'string') {
        return false;
      }

      const key = r.email.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  };

  to = dedup(to);

  const toEmails = new Set(to.map(r => r.email.toLowerCase()));
  cc = dedup(cc).filter(r => !toEmails.has(r.email.toLowerCase()));

  const toCcEmails = new Set([...toEmails, ...cc.map(r => r.email.toLowerCase())]);
  bcc = dedup(bcc).filter(r => !toCcEmails.has(r.email.toLowerCase()));

  return { to, cc, bcc };
}

// --- Scheduling + persistence ---

function normalizeSendAt(sendAt) {
  if (!sendAt && sendAt !== 0) {
    return null;
  }

  if (typeof sendAt === 'number') {
    if (sendAt > 4102444800) {
      return Math.floor(sendAt / 1000);
    }
    return sendAt;
  }

  if (typeof sendAt === 'string') {
    const parsed = moment(sendAt);

    if (parsed.isValid()) {
      return parsed.unix();
    }
  }

  return null;
}

async function saveToEmailQueue(settings, sendAt, admin, ctx) {
  const emailId = pushid();

  const settingsCloned = _.cloneDeepWith(settings, (value) => {
    if (typeof value === 'undefined') {
      return null;
    }
  });

  ctx.log(`saveToEmailQueue(): Saving ${emailId}, sendAt=${sendAt}`);

  await admin.firestore().doc(`emails-queue/${emailId}`)
    .set({ settings: settingsCloned, sendAt })
    .then(() => ctx.log(`saveToEmailQueue(): Success ${emailId}`))
    .catch(e => ctx.error(`saveToEmailQueue(): Failed ${emailId}`, e));
}

function saveAuditTrail(email, messageId, admin, ctx) {
  const emailCloned = _.cloneDeepWith(email, (value) => {
    if (typeof value === 'undefined') {
      return null;
    }
  });

  admin.firestore().doc(`emails/${messageId}`)
    .set({
      id: messageId,
      request: emailCloned,
      body: { html: '', text: '' },
      created: ctx.meta.startTime,
    })
    .then(() => ctx.log(`Audit trail saved: ${messageId}`))
    .catch(e => ctx.error(`Audit trail failed: ${messageId}`, e));
}

module.exports = Transactional;
