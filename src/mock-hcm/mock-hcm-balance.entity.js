const { EntitySchema } = require('typeorm');

/**
 * HCM-side balance (mock). Separate from local cache.
 * Simulates the external HCM system's balance storage.
 */
const MockHcmBalance = new EntitySchema({
  name: 'MockHcmBalance',
  tableName: 'mock_hcm_balances',
  columns: {
    id: { type: 'varchar', primary: true, generated: 'uuid' },
    employeeId: { type: 'varchar', nullable: false },
    locationId: { type: 'varchar', nullable: false },
    availableDays: { type: 'decimal', nullable: false, default: 0 },
  },
  uniques: [
    { columns: ['employeeId', 'locationId'] },
  ],
});

module.exports = { MockHcmBalance };
