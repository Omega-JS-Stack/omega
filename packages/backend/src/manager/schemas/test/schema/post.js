/**
 * Comprehensive schema for testing all field types and options
 * Tests: types, default (static + function), value, min, max, required, clean
 * (zod form — the frozen declarative twin lives in test/helpers/schema-zod.js
 * and pins powertools parity)
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = ({ user }) => {
  const planId = user?.subscription?.product?.id || 'basic';
  const isPremium = planId !== 'basic';

  const shape = {
    // Basic types
    stringField: f.string({ default: 'default-string' }),
    numberField: f.number({ default: 42 }),
    booleanField: f.boolean({ default: false }),
    arrayField: f.array({ default: ['a', 'b', 'c'] }),
    objectField: f.passthrough({ default: { key: 'value' } }),

    // Required fields
    requiredField: f.string({ default: undefined, required: true }),
    conditionalRequired: f.string({ default: undefined, required: () => isPremium }), // Only required for premium users

    // Function defaults
    functionDefault: f.string({ default: () => `generated-${Date.now()}` }),
    userBasedDefault: f.string({ default: user?.auth?.uid || 'anonymous' }),

    // Forced value (overrides user input)
    forcedValue: f.string({ default: 'ignored', value: 'always-this-value' }),

    // Min/max for numbers
    minNumber: f.number({ default: 5, min: 1 }),
    maxNumber: f.number({ default: 50, max: 100 }),
    clampedNumber: f.number({ default: 50, min: 10, max: 100 }),

    // Min/max for strings (length)
    maxLengthString: f.string({ default: '', max: 10 }),

    // Min/max for arrays (length)
    maxLengthArray: f.array({ default: [], max: 3 }),

    // Plan-based limits
    planBasedLimit: f.number({ default: 10, min: 1, max: isPremium ? 1000 : 100 }),

    // Multiple allowed types
    multiType: f.multi(['string', 'number'], { default: 'default' }),

    // Any type
    anyType: f.any({ default: null }),

    // Clean with regex
    cleanedString: f.string({ default: '', clean: /[^a-zA-Z0-9]/g }), // Remove non-alphanumeric

    // Clean with function
    cleanedFunction: f.string({ default: '', clean: (value) => value.toLowerCase().trim() }),

    // Nested object (for completeness)
    nested: f.object({
      level1: f.string({ default: 'nested-default' }),
    }),
  };

  // Premium-only field (not available to basic users)
  if (isPremium) {
    shape.premiumOnlyField = f.string({ default: 'premium-feature' });
  }

  return f.object(shape);
};
