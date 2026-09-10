const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  // `refresh` honors `uid` (an admin refreshing at the provider on a user's
  // behalf); `tokenize` refuses it by name ([#782](https://github.com/Omega-JS-Stack/omega/issues/782)).
  // No default either way: `settings.uid` set means the caller passed one.
  uid: f.string({ required: false }),
  provider: f.string({ required: false }),  // Not required for tokenize (provider comes from encrypted state)
  action: f.string({ default: 'tokenize', enum: ['tokenize', 'refresh'], required: false }),
  code: f.string({ required: false }),  // Required for tokenize
  encryptedState: f.string({ required: false }),  // Required for tokenize
});
