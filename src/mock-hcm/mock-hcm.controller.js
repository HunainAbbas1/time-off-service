const { Controller, Get, Post, Param, Body, Inject } = require('@nestjs/common');
const { MockHcmService } = require('./mock-hcm.service');

/**
 * Exposes mock HCM endpoints for E2E testing and demonstration.
 * In production these would be on a separate external system.
 */
class MockHcmController {
  constructor(mockHcmService) {
    this.mockHcmService = mockHcmService;
  }

  getBalance(employeeId, locationId) {
    return this.mockHcmService.getBalance(employeeId, locationId);
  }

  submitTimeOff(body) {
    return this.mockHcmService.submitTimeOff(body);
  }
}

Controller('mock-hcm')(MockHcmController);
Inject(MockHcmService)(MockHcmController, undefined, 0);

const getBalanceDescriptor = Object.getOwnPropertyDescriptor(MockHcmController.prototype, 'getBalance');
Get('balances/:employeeId/:locationId')(MockHcmController.prototype, 'getBalance', getBalanceDescriptor);
Param('employeeId')(MockHcmController.prototype, 'getBalance', 0);
Param('locationId')(MockHcmController.prototype, 'getBalance', 1);

const submitTimeOffDescriptor = Object.getOwnPropertyDescriptor(MockHcmController.prototype, 'submitTimeOff');
Post('time-off')(MockHcmController.prototype, 'submitTimeOff', submitTimeOffDescriptor);
Body()(MockHcmController.prototype, 'submitTimeOff', 0);

module.exports = { MockHcmController };
