const { Injectable, CanActivate, ForbiddenException, Inject } = require('@nestjs/common');
const { Reflector } = require('@nestjs/core');

/**
 * Guard that checks x-user-role header against required roles.
 * Usage: @UseGuards(RoleGuard) with @SetMetadata('roles', ['manager'])
 */
class RoleGuard {
  constructor(reflector) {
    this.reflector = reflector;
  }

  canActivate(context) {
    const requiredRoles = this.reflector.get('roles', context.getHandler());
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userRole = request.headers['x-user-role'];

    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      });
    }

    return true;
  }
}

Injectable()(RoleGuard);
Inject(Reflector)(RoleGuard, undefined, 0);

module.exports = { RoleGuard };
