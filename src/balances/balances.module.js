const { Module } = require('@nestjs/common');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { Balance } = require('./balance.entity');
const { BalancesService } = require('./balances.service');
const { BalancesController } = require('./balances.controller');
const { HcmModule } = require('../hcm/hcm.module');

class BalancesModule {}

Module({
  imports: [TypeOrmModule.forFeature([Balance]), HcmModule],
  controllers: [BalancesController],
  providers: [BalancesService],
  exports: [BalancesService],
})(BalancesModule);

module.exports = { BalancesModule };
