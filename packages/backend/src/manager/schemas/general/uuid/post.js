module.exports = () => ({
  name: {
    types: ['string'],
    default: undefined,
    required: false,
  },
  input: {
    types: ['string'],
    default: undefined,
    required: false,
  },
  version: {
    types: ['string', 'number'],
    default: '5',
    required: false,
  },
  namespace: {
    types: ['string'],
    default: process.env.OMEGA_NAMESPACE,
    required: false,
  },
});
