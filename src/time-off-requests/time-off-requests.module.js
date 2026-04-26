const { Module } = require('@nestjs/common');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { TimeOffRequest } = require('./time-off-request.entity');
const { TimeOffRequestHistory } = require('./time-off-request-history.entity');
const { TimeOffRequestsService } = require('./time-off-requests.service');
const { TimeOffRequestsController } = require('./time-off-requests.controller');
const { HcmModule } = require('../hcm/hcm.module');
const { BalancesModule } = require('../balances/balances.module');

class TimeOffRequestsModule {}

Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest, TimeOffRequestHistory]),
    HcmModule,
    BalancesModule,
  ],
  controllers: [TimeOffRequestsController],
  providers: [TimeOffRequestsService],
})(TimeOffRequestsModule);

module.exports = { TimeOffRequestsModule };
