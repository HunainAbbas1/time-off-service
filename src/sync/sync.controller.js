const { Body, Controller, Inject, Post } = require('@nestjs/common');
const { SyncService } = require('./sync.service');

class SyncController {
  constructor(syncService) {
    this.syncService = syncService;
  }

  processBatchBalances(body) {
    return this.syncService.processBatchSync(body);
  }
}

Controller('hcm')(SyncController);
Inject(SyncService)(SyncController, undefined, 0);

const processBatchBalancesDescriptor = Object.getOwnPropertyDescriptor(SyncController.prototype, 'processBatchBalances');
Post('batch-balances')(SyncController.prototype, 'processBatchBalances', processBatchBalancesDescriptor);
Body()(SyncController.prototype, 'processBatchBalances', 0);

module.exports = { SyncController };
