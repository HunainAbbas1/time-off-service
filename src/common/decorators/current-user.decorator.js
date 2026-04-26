const { createParamDecorator } = require('@nestjs/common');

/**
 * Extracts the current user from x-user-id and x-user-role headers.
 * Returns { userId, role }.
 */
const CurrentUser = createParamDecorator((data, ctx) => {
  const request = ctx.switchToHttp().getRequest();
  return {
    userId: request.headers['x-user-id'] || null,
    role: request.headers['x-user-role'] || null,
  };
});

module.exports = { CurrentUser };
