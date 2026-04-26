const { Injectable, Inject } = require('@nestjs/common');
const { InjectRepository } = require('@nestjs/typeorm');
const { HcmSyncRun } = require('./hcm-sync-run.entity');
const { BalancesService } = require('../balances/balances.service');
const {
  validateBatchBalanceSyncPayload,
  validateBatchBalanceRecord,
} = require('../balances/validators/batch-balance-sync.validator');

class SyncService {
  constructor(syncRunRepository, balancesService) {
    this.syncRunRepository = syncRunRepository;
    this.balancesService = balancesService;
  }

  async processBatchSync(payload) {
    try {
      validateBatchBalanceSyncPayload(payload);
    } catch (error) {
      await this.saveSyncRun({
        status: 'FAILED',
        recordsReceived: Array.isArray(payload && payload.balances) ? payload.balances.length : 0,
        recordsProcessed: 0,
        recordsFailed: Array.isArray(payload && payload.balances) ? payload.balances.length : 0,
        errors: [{ message: error.getResponse().error.message }],
      });
      throw error;
    }

    const records = payload.balances;
    const errors = [];
    let recordsProcessed = 0;

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const recordErrors = validateBatchBalanceRecord(record);

      if (recordErrors.length > 0) {
        errors.push({ index, message: recordErrors.join('; ') });
        continue;
      }

      try {
        await this.balancesService.upsertBalance(
          record.employeeId,
          record.locationId,
          record.availableDays,
          'HCM_BATCH',
        );
        recordsProcessed += 1;
      } catch (error) {
        errors.push({ index, message: this.getErrorMessage(error) });
      }
    }

    const recordsReceived = records.length;
    const recordsFailed = errors.length;
    const status = this.getStatus(recordsProcessed, recordsFailed);

    const syncRun = await this.saveSyncRun({
      status,
      recordsReceived,
      recordsProcessed,
      recordsFailed,
      errors,
    });

    return {
      syncRunId: syncRun.id,
      status,
      recordsReceived,
      recordsProcessed,
      recordsFailed,
      errors,
    };
  }

  getStatus(recordsProcessed, recordsFailed) {
    if (recordsProcessed > 0 && recordsFailed === 0) {
      return 'SUCCESS';
    }

    if (recordsProcessed > 0 && recordsFailed > 0) {
      return 'PARTIAL_SUCCESS';
    }

    return 'FAILED';
  }

  getErrorMessage(error) {
    if (error && typeof error.getResponse === 'function') {
      const response = error.getResponse();
      if (response && response.error && response.error.message) {
        return response.error.message;
      }
      if (response && response.message) {
        return Array.isArray(response.message) ? response.message.join('; ') : response.message;
      }
    }

    return error && error.message ? error.message : 'Failed to process record';
  }

  async saveSyncRun({ status, recordsReceived, recordsProcessed, recordsFailed, errors }) {
    const syncRun = this.syncRunRepository.create({
      syncType: 'BATCH_BALANCE_SYNC',
      status,
      recordsReceived,
      recordsProcessed,
      recordsFailed,
      errorMessage: errors && errors.length > 0 ? JSON.stringify(errors) : null,
    });

    return this.syncRunRepository.save(syncRun);
  }
}

Injectable()(SyncService);
InjectRepository(HcmSyncRun)(SyncService, undefined, 0);
Inject(BalancesService)(SyncService, undefined, 1);

module.exports = { SyncService };
