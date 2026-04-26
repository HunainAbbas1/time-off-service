const { Module } = require('@nestjs/common');
const { MockHcmModule } = require('../mock-hcm/mock-hcm.module');
const { HcmService } = require('./hcm.service');

/**
 * Integration boundary module.
 * Imports MockHcmModule to allow DI of MockHcmService into HcmService.
 */
class HcmModule {}

Module({
  imports: [MockHcmModule],
  providers: [HcmService],
  exports: [HcmService],
})(HcmModule);

module.exports = { HcmModule };
