const { Module } = require('@nestjs/common');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { MockHcmBalance } = require('./mock-hcm-balance.entity');
const { MockHcmService } = require('./mock-hcm.service');
const { MockHcmController } = require('./mock-hcm.controller');

class MockHcmModule {}

Module({
  imports: [TypeOrmModule.forFeature([MockHcmBalance])],
  controllers: [MockHcmController],
  providers: [MockHcmService],
  exports: [MockHcmService],
})(MockHcmModule);

module.exports = { MockHcmModule };
