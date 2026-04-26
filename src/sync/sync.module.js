const { Module } = require('@nestjs/common');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { HcmSyncRun } = require('./hcm-sync-run.entity');
const { SyncService } = require('./sync.service');
const { SyncController } = require('./sync.controller');
const { BalancesModule } = require('../balances/balances.module');

class SyncModule {}

Module({
  imports: [TypeOrmModule.forFeature([HcmSyncRun]), BalancesModule],
  controllers: [SyncController],
  providers: [SyncService],
})(SyncModule);

module.exports = { SyncModule };
