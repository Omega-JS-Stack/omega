module.exports = ({ user }) => ({
  uid: { type: 'string', default: user.uid },
  keys: { type: ['array', 'string'], default: ['clientId', 'privateKey'] },
});
