const { Injectable, Inject } = require('@nestjs/common');
const { MockHcmService } = require('../mock-hcm/mock-hcm.service');

/**
 * Integration boundary adapter.
 * For this take-home: delegates to MockHcmService via DI.
 * In production: would call real HCM over HTTP.
 */
class HcmService {
  constructor(mockHcmService) {
    this.mockHcmService = mockHcmService;
  }

  async getBalance(employeeId, locationId) {
    return this.mockHcmService.getBalance(employeeId, locationId);
  }

  async submitTimeOff(payload) {
    return this.mockHcmService.submitTimeOff(payload);
  }
}

Injectable()(HcmService);
Inject(MockHcmService)(HcmService, undefined, 0);

module.exports = { HcmService };
