const { BadRequestException } = require('@nestjs/common');

/**
 * Runs an array of rule functions against a body object.
 * Each rule returns null if valid, or an error string if invalid.
 * Throws BadRequestException with VALIDATION_ERROR on failure.
 */
function validate(body, rules) {
  const errors = [];
  for (const rule of rules) {
    const err = rule(body);
    if (err) errors.push(err);
  }
  if (errors.length > 0) {
    throw new BadRequestException({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: errors.join('; ') },
    });
  }
}

// --- Rule helpers ---

const required = (field) => (body) =>
  body[field] == null || body[field] === '' ? `${field} is required` : null;

const isString = (field) => (body) =>
  body[field] != null && typeof body[field] !== 'string'
    ? `${field} must be a string`
    : null;

const isNumber = (field) => (body) =>
  body[field] != null && typeof body[field] !== 'number'
    ? `${field} must be a number`
    : null;

const isPositive = (field) => (body) =>
  typeof body[field] === 'number' && body[field] <= 0
    ? `${field} must be greater than 0`
    : null;

const isNonNegative = (field) => (body) =>
  typeof body[field] === 'number' && body[field] < 0
    ? `${field} must be greater than or equal to 0`
    : null;

const isDateString = (field) => (body) => {
  if (body[field] == null) return null;
  const d = new Date(body[field]);
  return isNaN(d.getTime()) ? `${field} must be a valid ISO date` : null;
};

const isDateOrder = (startField, endField) => (body) => {
  if (body[startField] == null || body[endField] == null) return null;
  return body[startField] > body[endField]
    ? `${startField} must be before or equal to ${endField}`
    : null;
};

const isArray = (field) => (body) =>
  !Array.isArray(body[field]) ? `${field} must be an array` : null;

const isNonEmptyArray = (field) => (body) =>
  !Array.isArray(body[field]) || body[field].length === 0
    ? `${field} must be a non-empty array`
    : null;

module.exports = {
  validate,
  required,
  isString,
  isNumber,
  isPositive,
  isNonNegative,
  isDateString,
  isDateOrder,
  isArray,
  isNonEmptyArray,
};
