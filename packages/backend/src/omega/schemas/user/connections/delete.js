module.exports = () => ({
  // An admin may pass `uid` to revoke on a user's behalf; no default, so
  // `settings.uid` set means the caller passed one ([#782](https://github.com/Omega-JS-Stack/omega/issues/782))
  uid: { type: 'string' },
  provider: { type: 'string', required: true },
});
