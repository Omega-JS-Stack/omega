/**
 * Test: POST /test/schema
 * Comprehensive schema validation tests
 * Tests all field types, options, and plan-based variations
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Schema validation',
  type: 'group',
  timeout: 30000,

  tests: [
    // ===================
    // BASIC TYPES
    // ===================
    {
      name: 'default-values-applied',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided', // Must provide required field
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        // Check all defaults are applied
        expect(settings.stringField, 'String default').toBe('default-string');
        expect(settings.numberField, 'Number default').toBe(42);
        expect(settings.booleanField, 'Boolean default').toBe(false);
        expect(settings.arrayField, 'Array default').toEqual(['a', 'b', 'c']);
        // Note: Object defaults may include schema metadata due to powertools.defaults() behavior
        expect(settings.objectField.key, 'Object default key').toBe('value');
      },
    },

    {
      name: 'user-values-override-defaults',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          stringField: 'custom-string',
          numberField: 100,
          booleanField: true,
          arrayField: ['x', 'y'],
          objectField: { custom: 'data' },
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.stringField, 'String overridden').toBe('custom-string');
        expect(settings.numberField, 'Number overridden').toBe(100);
        expect(settings.booleanField, 'Boolean overridden').toBe(true);
        expect(settings.arrayField, 'Array overridden').toEqual(['x', 'y']);
        expect(settings.objectField.custom, 'Object overridden').toBe('data');
      },
    },

    // ===================
    // REQUIRED FIELDS
    // ===================
    {
      name: 'required-field-missing-fails',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          // NOT providing requiredField
        });

        expect(response, 'Should fail with 400 for missing required field').toBeError(400);
      },
    },

    {
      name: 'required-field-provided-succeeds',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'i-am-required',
        });

        expect(response, 'Should succeed when required field provided').toBeSuccess();
        expect(response.data.settings.requiredField, 'Required field value').toBe('i-am-required');
      },
    },

    {
      name: 'conditional-required-basic-user',
      auth: 'basic',
      async run({ http, expect }) {
        // Basic user - conditionalRequired should NOT be required
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          // NOT providing conditionalRequired
        });

        expect(response, 'Basic user should succeed without conditionalRequired').toBeSuccess();
      },
    },

    {
      name: 'conditional-required-premium-user',
      auth: 'premium-active',
      async run({ http, expect }) {
        // Premium user - conditionalRequired SHOULD be required
        const response = await http.as('premium-active').post('omega/test/schema', {
          requiredField: 'provided',
          // NOT providing conditionalRequired
        });

        expect(response, 'Premium user should fail without conditionalRequired').toBeError(400);
      },
    },

    {
      name: 'conditional-required-premium-provided',
      auth: 'premium-active',
      async run({ http, expect }) {
        const response = await http.as('premium-active').post('omega/test/schema', {
          requiredField: 'provided',
          conditionalRequired: 'also-provided',
        });

        expect(response, 'Premium user should succeed with conditionalRequired').toBeSuccess();
      },
    },

    // ===================
    // FUNCTION DEFAULTS
    // ===================
    {
      name: 'function-default-executed',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        // functionDefault should be a generated string
        expect(settings.functionDefault, 'Function default should be generated').toMatch(/^generated-\d+$/);
      },
    },

    {
      name: 'user-based-default-authenticated',
      async run({ http, expect, accounts }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        // userBasedDefault should be the user's UID
        expect(settings.userBasedDefault, 'User-based default should be UID').toBe(accounts.basic.uid);
      },
    },

    {
      name: 'user-based-default-unauthenticated',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/test/schema', {
          requiredField: 'provided',
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        // userBasedDefault should be 'anonymous' for unauthenticated users
        expect(settings.userBasedDefault, 'User-based default should be anonymous').toBe('anonymous');
      },
    },

    // ===================
    // FORCED VALUE
    // ===================
    {
      name: 'forced-value-overrides-user-input',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          forcedValue: 'user-tried-to-set-this',
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        // forcedValue should always be the schema's value, not user input
        expect(settings.forcedValue, 'Forced value should override user input').toBe('always-this-value');
      },
    },

    // ===================
    // MIN/MAX FOR NUMBERS
    // ===================
    {
      name: 'min-number-enforced',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          minNumber: -5, // Below min of 1
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        // Should be clamped to min
        expect(settings.minNumber, 'Number should be clamped to min').toBe(1);
      },
    },

    {
      name: 'max-number-enforced',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          maxNumber: 500, // Above max of 100
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        // Should be clamped to max
        expect(settings.maxNumber, 'Number should be clamped to max').toBe(100);
      },
    },

    {
      name: 'clamped-number-within-range',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          clampedNumber: 75, // Within range 10-100
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.clampedNumber, 'Number within range should be unchanged').toBe(75);
      },
    },

    {
      name: 'clamped-number-below-range',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          clampedNumber: 5, // Below min of 10
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.clampedNumber, 'Number should be clamped to min').toBe(10);
      },
    },

    {
      name: 'clamped-number-above-range',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          clampedNumber: 200, // Above max of 100
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.clampedNumber, 'Number should be clamped to max').toBe(100);
      },
    },

    // ===================
    // MIN/MAX FOR STRINGS
    // ===================
    {
      name: 'max-length-string-truncated',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          maxLengthString: 'this-is-way-too-long-for-the-limit', // max is 10
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.maxLengthString.length, 'String should be truncated to max length').toBe(10);
        expect(settings.maxLengthString, 'String should be truncated correctly').toBe('this-is-wa');
      },
    },

    // ===================
    // MIN/MAX FOR ARRAYS
    // ===================
    {
      name: 'max-length-array-truncated',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          maxLengthArray: ['a', 'b', 'c', 'd', 'e'], // max is 3
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.maxLengthArray.length, 'Array should be truncated to max length').toBe(3);
        expect(settings.maxLengthArray, 'Array should be truncated correctly').toEqual(['a', 'b', 'c']);
      },
    },

    // ===================
    // PLAN-BASED LIMITS
    // ===================
    {
      name: 'plan-based-limit-basic-user',
      auth: 'basic',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          planBasedLimit: 500, // Basic max is 100
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.planBasedLimit, 'Basic user should be clamped to 100').toBe(100);
      },
    },

    {
      name: 'plan-based-limit-premium-user',
      auth: 'premium-active',
      async run({ http, expect }) {
        const response = await http.as('premium-active').post('omega/test/schema', {
          requiredField: 'provided',
          conditionalRequired: 'provided', // Required for premium
          planBasedLimit: 500, // Premium max is 1000
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.planBasedLimit, 'Premium user should allow 500').toBe(500);
      },
    },

    // ===================
    // MULTIPLE TYPES
    // ===================
    {
      name: 'multi-type-accepts-string',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          multiType: 'hello',
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.multiType, 'Should accept string').toBe('hello');
        expect(settings.multiType, 'Should be string type').toBeTypeOf('string');
      },
    },

    {
      name: 'multi-type-accepts-number',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          multiType: 123,
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.multiType, 'Should accept number').toBe(123);
        expect(settings.multiType, 'Should be number type').toBeTypeOf('number');
      },
    },

    // ===================
    // ANY TYPE
    // ===================
    {
      name: 'any-type-accepts-anything',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          anyType: { complex: { nested: ['data', 123, true] } },
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.anyType, 'Should accept any type').toEqual({ complex: { nested: ['data', 123, true] } });
      },
    },

    // ===================
    // CLEAN (REGEX)
    // ===================
    {
      name: 'clean-regex-removes-characters',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          cleanedString: 'hello@world!123#test',
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.cleanedString, 'Non-alphanumeric should be removed').toBe('helloworld123test');
      },
    },

    // ===================
    // CLEAN (FUNCTION)
    // ===================
    {
      name: 'clean-function-transforms-value',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          cleanedFunction: '  HELLO WORLD  ',
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.cleanedFunction, 'Should be lowercased and trimmed').toBe('hello world');
      },
    },

    // ===================
    // NESTED OBJECTS
    // ===================
    {
      name: 'nested-defaults-applied',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings, 'Nested property should exist').toHaveProperty('nested.level1');
        expect(settings.nested.level1, 'Nested default should be applied').toBe('nested-default');
      },
    },

    {
      name: 'nested-values-overridden',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          nested: {
            level1: 'custom-nested',
          },
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        expect(settings.nested.level1, 'Nested value should be overridden').toBe('custom-nested');
      },
    },

    // ===================
    // UNAUTHENTICATED
    // ===================
    {
      name: 'unauthenticated-request',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/test/schema', {
          requiredField: 'provided',
        });

        expect(response, 'Unauthenticated request should succeed').toBeSuccess();

        const { user } = response.data;

        expect(user.authenticated, 'Should be unauthenticated').toBe(false);
        expect(user.subscription, 'Should default to basic subscription').toBe('basic');
      },
    },

    // ===================
    // AVAILABILITY
    // ===================
    {
      name: 'premium-only-field-basic-user',
      auth: 'basic',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/test/schema', {
          requiredField: 'provided',
          premiumOnlyField: 'trying-to-use-premium-feature',
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        // Basic user should NOT have access to premiumOnlyField
        expect(!('premiumOnlyField' in settings), 'Basic user should not have premiumOnlyField').toBeTruthy();
      },
    },

    {
      name: 'premium-only-field-premium-user',
      auth: 'premium-active',
      async run({ http, expect }) {
        const response = await http.as('premium-active').post('omega/test/schema', {
          requiredField: 'provided',
          conditionalRequired: 'provided',
          premiumOnlyField: 'using-premium-feature',
        });

        expect(response, 'Request should succeed').toBeSuccess();

        const { settings } = response.data;

        // Premium user SHOULD have access to premiumOnlyField
        expect('premiumOnlyField' in settings, 'Premium user should have premiumOnlyField').toBeTruthy();
        expect(settings.premiumOnlyField, 'Premium user can set value').toBe('using-premium-feature');
      },
    },
  ],
});
