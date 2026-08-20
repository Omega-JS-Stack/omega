const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = ({ user }) => f.object({
  uid: f.string({ default: user?.auth?.uid, required: false }),
  attribution: f.passthrough({ default: {}, required: false }),
  // The client's tracking-consent snapshot, stored verbatim on the user record beside
  // attribution — never interpreted here, and distinct from the legal/marketing
  // `consent` below, which the route translates into the canonical user-doc shape.
  trackingConsent: f.passthrough({ default: null, required: false }),
  context: f.passthrough({ default: {}, required: false }),
  // Consent decision captured at signup. Each sub-object is OPTIONAL — if the client omits
  // `legal`/`marketing` (e.g. a legacy account re-firing /user/signup on page load with no
  // fresh consent), the route leaves that consent untouched rather than downgrading it.
  // When present, `granted` is the decision and `text` is the exact copy shown to the user.
  // (Omitted sub-fields resolve to granted: false / text: '' — buildConsentRecord in the
  // route treats those as "not explicitly re-granted" and preserves existing consent.)
  consent: f.object({
    legal: f.object({
      granted: f.boolean({ required: false }),
      text: f.string({ required: false }),
    }),
    marketing: f.object({
      granted: f.boolean({ required: false }),
      text: f.string({ required: false }),
    }),
  }),
});
