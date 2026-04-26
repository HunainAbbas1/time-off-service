const { EntitySchema } = require('typeorm');

/**
 * Audit trail for request status transitions.
 */
const TimeOffRequestHistory = new EntitySchema({
  name: 'TimeOffRequestHistory',
  tableName: 'time_off_request_history',
  columns: {
    id: { type: 'varchar', primary: true, generated: 'uuid' },
    requestId: { type: 'varchar', nullable: false },
    fromStatus: { type: 'varchar', nullable: true },
    toStatus: { type: 'varchar', nullable: false },
    actorId: { type: 'varchar', nullable: true },
    actorRole: { type: 'varchar', nullable: true },
    reason: { type: 'varchar', nullable: true },
    metadata: { type: 'text', nullable: true },
    createdAt: { type: 'datetime', createDate: true },
  },
});

module.exports = { TimeOffRequestHistory };
