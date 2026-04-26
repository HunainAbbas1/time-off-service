const { Controller, ForbiddenException, Get, Inject, Param, Post, Req } = require('@nestjs/common');
const { BalancesService } = require('./balances.service');
const { ErrorCodes } = require('../common/errors/error-codes');

function forbidden(message = 'Insufficient permissions') {
  return new ForbiddenException({
    success: false,
    error: { code: ErrorCodes.FORBIDDEN, message },
  });
}

function authorizeBalanceAccess(employeeId, request) {
  const userId = request.headers['x-user-id'];
  const role = request.headers['x-user-role'];

  if (!userId || !role) {
    throw forbidden('Missing authentication headers');
  }

  if (role === 'manager') {
    return;
  }

  if (role === 'employee' && userId === employeeId) {
    return;
  }

  throw forbidden();
}

class BalancesController {
  constructor(balancesService) {
    this.balancesService = balancesService;
  }

  getBalance(employeeId, locationId, request) {
    authorizeBalanceAccess(employeeId, request);
    return this.balancesService.getLocalBalance(employeeId, locationId);
  }

  refreshBalance(employeeId, locationId, request) {
    authorizeBalanceAccess(employeeId, request);
    return this.balancesService.refreshFromHcm(employeeId, locationId);
  }
}

Controller('balances')(BalancesController);
Inject(BalancesService)(BalancesController, undefined, 0);

const getBalanceDescriptor = Object.getOwnPropertyDescriptor(BalancesController.prototype, 'getBalance');
Get(':employeeId/:locationId')(BalancesController.prototype, 'getBalance', getBalanceDescriptor);
Param('employeeId')(BalancesController.prototype, 'getBalance', 0);
Param('locationId')(BalancesController.prototype, 'getBalance', 1);
Req()(BalancesController.prototype, 'getBalance', 2);

const refreshBalanceDescriptor = Object.getOwnPropertyDescriptor(BalancesController.prototype, 'refreshBalance');
Post(':employeeId/:locationId/refresh')(BalancesController.prototype, 'refreshBalance', refreshBalanceDescriptor);
Param('employeeId')(BalancesController.prototype, 'refreshBalance', 0);
Param('locationId')(BalancesController.prototype, 'refreshBalance', 1);
Req()(BalancesController.prototype, 'refreshBalance', 2);

module.exports = { BalancesController, authorizeBalanceAccess };
