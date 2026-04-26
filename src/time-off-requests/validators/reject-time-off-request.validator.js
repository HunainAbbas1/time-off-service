const { validate, isString } = require('../../common/validators/validate');

function validateRejectTimeOffRequest(body) {
  validate(body || {}, [
    isString('reason'),
  ]);
}

module.exports = { validateRejectTimeOffRequest };
