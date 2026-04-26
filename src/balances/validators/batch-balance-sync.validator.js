const { BadRequestException } = require('@nestjs/common');
const { validate, required, isNonEmptyArray } = require('../../common/validators/validate');
const { ErrorCodes } = require('../../common/errors/error-codes');

function validateBatchBalanceSyncPayload(body) {
  validate(body || {}, [
    required('balances'),
    isNonEmptyArray('balances'),
  ]);
}

function validateBatchBalanceRecord(record) {
  const errors = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['record must be an object'];
  }

  if (record.employeeId == null || record.employeeId === '') {
    errors.push('employeeId is required');
  } else if (typeof record.employeeId !== 'string') {
    errors.push('employeeId must be a string');
  }

  if (record.locationId == null || record.locationId === '') {
    errors.push('locationId is required');
  } else if (typeof record.locationId !== 'string') {
    errors.push('locationId must be a string');
  }

  if (record.availableDays == null) {
    errors.push('availableDays is required');
  } else if (typeof record.availableDays !== 'number' || Number.isNaN(record.availableDays)) {
    errors.push('availableDays must be a number');
  } else if (record.availableDays < 0) {
    errors.push('availableDays must be greater than or equal to 0');
  }

  return errors;
}

function validationError(message) {
  return new BadRequestException({
    success: false,
    error: { code: ErrorCodes.VALIDATION_ERROR, message },
  });
}

module.exports = {
  validateBatchBalanceSyncPayload,
  validateBatchBalanceRecord,
  validationError,
};
