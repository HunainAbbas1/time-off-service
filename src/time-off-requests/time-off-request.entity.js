const { EntitySchema } = require('typeorm');

/**
 * Time-off request lifecycle entity.
 * Idempotency is enforced in service logic, not via DB constraint.
 */
const TimeOffRequest = new EntitySchema({
  name: 'TimeOffRequest',
  tableName: 'time_off_requests',
  columns: {
    id: { type: 'varchar', primary: true, generated: 'uuid' },
    employeeId: { type: 'varchar', nullable: false },
    locationId: { type: 'varchar', nullable: false },
    amountDays: { type: 'decimal', nullable: false },
    startDate: { type: 'varchar', nullable: false },
    endDate: { type: 'varchar', nullable: false },
    reason: { type: 'varchar', nullable: true },
    status: { type: 'varchar', nullable: false },
    hcmSubmissionId: { type: 'varchar', nullable: true },
    idempotencyKey: { type: 'varchar', nullable: true },
    createdAt: { type: 'datetime', createDate: true },
    updatedAt: { type: 'datetime', updateDate: true },
  },
});

module.exports = { TimeOffRequest };
