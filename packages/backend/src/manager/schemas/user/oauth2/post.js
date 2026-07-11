const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = ({ user }) => f.object({
  uid: f.string({ default: user?.auth?.uid, required: false }),
  provider: f.string({ required: false }),  // Not required for tokenize (provider comes from encrypted state)
  action: f.string({ default: 'tokenize', enum: ['tokenize', 'refresh'], required: false }),
  code: f.string({ required: false }),  // Required for tokenize
  encryptedState: f.string({ required: false }),  // Required for tokenize
});
