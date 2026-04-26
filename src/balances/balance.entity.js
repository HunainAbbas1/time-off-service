const { EntitySchema } = require('typeorm');

/**
 * Local cached balance per employee per location.
 * Source of truth is HCM; this is a cache for defensive validation.
 */
const Balance = new EntitySchema({
  name: 'Balance',
  tableName: 'balances',
  columns: {
    id: { type: 'varchar', primary: true, generated: 'uuid' },
    employeeId: { type: 'varchar', nullable: false },
    locationId: { type: 'varchar', nullable: false },
    availableDays: { type: 'decimal', nullable: false, default: 0 },
    source: { type: 'varchar', nullable: false, default: 'LOCAL_ESTIMATE' },
    lastSyncedAt: { type: 'datetime', nullable: false, default: () => "datetime('now')" },
    createdAt: { type: 'datetime', createDate: true },
    updatedAt: { type: 'datetime', updateDate: true },
  },
  uniques: [
    { columns: ['employeeId', 'locationId'] },
  ],
});

module.exports = { Balance };
