/**
 * Schema Validator for Firestore Documents
 *
 * Validates documents against a schema definition.
 * Used by migration handlers to check data integrity.
 *
 * Schema format:
 * {
 *   fieldName: {
 *     type: 'string' | 'number' | 'boolean' | 'object' | 'array',
 *     required: true | false,
 *     nullable: true | false,  // if true, null is valid even if type doesn't match
 *     itemType: 'string',      // for arrays, the expected type of items
 *     properties: { ... },     // for objects, nested schema
 *   }
 * }
 */

/**
 * Get the type of a value (more specific than typeof)
 *
 * @param {*} value - Value to check
 * @returns {string} Type string: 'null', 'array', 'object', 'string', 'number', 'boolean', 'undefined'
 */
function getType(value) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

/**
 * Format expected type string for error messages
 *
 * @param {Object} fieldSchema - Schema for the field
 * @returns {string} Human-readable type string
 */
function formatExpectedType(fieldSchema) {
  let expected = fieldSchema.type;

  if (fieldSchema.nullable) {
    expected += '|null';
  }

  if (fieldSchema.type === 'array' && fieldSchema.itemType) {
    expected = `array<${fieldSchema.itemType}>`;
    if (fieldSchema.nullable) {
      expected += '|null';
    }
  }

  return expected;
}

/**
 * Validate a single field against its schema
 *
 * @param {*} value - The value to validate
 * @param {Object} fieldSchema - Schema for this field
 * @param {string} fieldPath - Dot-notation path for error messages
 * @returns {Array} Array of error objects
 */
function validateField(value, fieldSchema, fieldPath) {
  const errors = [];
  const actualType = getType(value);

  // Check if field is missing
  if (actualType === 'undefined') {
    if (fieldSchema.required) {
      errors.push({
        field: fieldPath,
        expected: formatExpectedType(fieldSchema),
        actual: 'undefined',
        message: 'Missing required field',
      });
    }
    return errors;
  }

  // Check nullable
  if (actualType === 'null') {
    if (!fieldSchema.nullable) {
      errors.push({
        field: fieldPath,
        expected: formatExpectedType(fieldSchema),
        actual: 'null',
        message: `Expected ${fieldSchema.type}, got null (field is not nullable)`,
      });
    }
    return errors;
  }

  // Check type match
  if (actualType !== fieldSchema.type) {
    errors.push({
      field: fieldPath,
      expected: formatExpectedType(fieldSchema),
      actual: actualType,
      message: `Expected ${fieldSchema.type}, got ${actualType}`,
    });
    return errors; // Don't check nested if type doesn't match
  }

  // For arrays, check item types
  if (fieldSchema.type === 'array' && fieldSchema.itemType) {
    for (let i = 0; i < value.length; i++) {
      const itemType = getType(value[i]);
      if (itemType !== fieldSchema.itemType) {
        errors.push({
          field: `${fieldPath}[${i}]`,
          expected: fieldSchema.itemType,
          actual: itemType,
          message: `Array item expected ${fieldSchema.itemType}, got ${itemType}`,
        });
      }
    }
  }

  // For objects with properties schema, validate nested fields
  if (fieldSchema.type === 'object' && fieldSchema.properties) {
    for (const [propName, propSchema] of Object.entries(fieldSchema.properties)) {
      const propErrors = validateField(value[propName], propSchema, `${fieldPath}.${propName}`);
      errors.push(...propErrors);
    }
  }

  return errors;
}

/**
 * Validate a document against a schema
 *
 * @param {Object} doc - Document data to validate
 * @param {Object} schema - Schema definition
 * @returns {Object} { valid: boolean, errors: Array<{ field, expected, actual, message }> }
 */
function validateDocument(doc, schema) {
  const errors = [];

  for (const [fieldName, fieldSchema] of Object.entries(schema)) {
    const fieldErrors = validateField(doc[fieldName], fieldSchema, fieldName);
    errors.push(...fieldErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = { validateDocument };
