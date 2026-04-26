const { EntitySchema } = require('typeorm');

/**
 * Records batch sync attempts for observability.
 */
const HcmSyncRun = new EntitySchema({
  name: 'HcmSyncRun',
  tableName: 'hcm_sync_runs',
  columns: {
    id: { type: 'varchar', primary: true, generated: 'uuid' },
    syncType: { type: 'varchar', nullable: false, default: 'BATCH_BALANCE_SYNC' },
    status: { type: 'varchar', nullable: false },
    recordsReceived: { type: 'integer', nullable: false, default: 0 },
    recordsProcessed: { type: 'integer', nullable: false, default: 0 },
    recordsFailed: { type: 'integer', nullable: false, default: 0 },
    errorMessage: { type: 'text', nullable: true },
    createdAt: { type: 'datetime', createDate: true },
  },
});

module.exports = { HcmSyncRun };
