const { fields: f } = require('../../../../helpers/schema-zod.js');

module.exports = ({ user }) => f.object({
  uid: f.string({ default: user?.auth?.uid, required: false }),
  defaultsPath: f.string({ default: '', required: false }),
  existingSettings: f.passthrough({ default: {}, required: false }),
  newSettings: f.passthrough({ default: {}, required: false }),
});
