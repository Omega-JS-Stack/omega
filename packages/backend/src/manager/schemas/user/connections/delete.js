const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  // An admin may pass `uid` to revoke on a user's behalf; no default, so
  // `settings.uid` set means the caller passed one ([#782](https://github.com/Omega-JS-Stack/omega/issues/782))
  uid: f.string({ required: false }),
  provider: f.string({ required: true }),
});
