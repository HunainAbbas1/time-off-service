const { validate, required, isString, isNumber, isDateString, isDateOrder } = require('../../common/validators/validate');

function validateCreateTimeOffRequest(body) {
  validate(body || {}, [
    required('employeeId'),
    isString('employeeId'),
    required('locationId'),
    isString('locationId'),
    required('amountDays'),
    isNumber('amountDays'),
    positiveAmountDays,
    required('startDate'),
    isString('startDate'),
    isDateString('startDate'),
    required('endDate'),
    isString('endDate'),
    isDateString('endDate'),
    isDateOrder('startDate', 'endDate'),
    isString('reason'),
    isString('idempotencyKey'),
  ]);
}

function positiveAmountDays(body) {
  return typeof body.amountDays === 'number' && body.amountDays <= 0
    ? 'amountDays must be greater than 0'
    : null;
}

module.exports = { validateCreateTimeOffRequest };
