const { Module } = require('@nestjs/common');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { AppController } = require('./app.controller');

const { BalancesModule } = require('./balances/balances.module');
const { TimeOffRequestsModule } = require('./time-off-requests/time-off-requests.module');
const { HcmModule } = require('./hcm/hcm.module');
const { MockHcmModule } = require('./mock-hcm/mock-hcm.module');
const { SyncModule } = require('./sync/sync.module');

const { Balance } = require('./balances/balance.entity');
const { TimeOffRequest } = require('./time-off-requests/time-off-request.entity');
const { TimeOffRequestHistory } = require('./time-off-requests/time-off-request-history.entity');
const { MockHcmBalance } = require('./mock-hcm/mock-hcm-balance.entity');
const { HcmSyncRun } = require('./sync/hcm-sync-run.entity');

class AppModule {}

Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH || 'timeoff.sqlite',
      entities: [Balance, TimeOffRequest, TimeOffRequestHistory, MockHcmBalance, HcmSyncRun],
      synchronize: true,
    }),
    BalancesModule,
    TimeOffRequestsModule,
    HcmModule,
    MockHcmModule,
    SyncModule,
  ],
  controllers: [AppController],
})(AppModule);

module.exports = { AppModule };
