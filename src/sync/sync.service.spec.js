const { SyncService } = require('./sync.service');
const { ErrorCodes } = require('../common/errors/error-codes');

describe('SyncService', () => {
  let service;
  let syncRunRepository;
  let balancesService;
  let syncRunCounter;

  beforeEach(() => {
    syncRunCounter = 1;
    syncRunRepository = {
      create: jest.fn((data) => ({ id: `sync_${syncRunCounter}`, ...data })),
      save: jest.fn(async (syncRun) => ({ ...syncRun, id: syncRun.id || `sync_${syncRunCounter++}` })),
    };

    balancesService = {
      upsertBalance: jest.fn(async (employeeId, locationId, availableDays, source) => ({
        employeeId,
        locationId,
        availableDays,
        source,
      })),
    };

    service = new SyncService(syncRunRepository, balancesService);
  });

  it('valid batch creates new balances', async () => {
    const result = await service.processBatchSync({
      balances: [
        { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 10 },
        { employeeId: 'emp_002', locationId: 'loc_001', availableDays: 8 },
      ],
    });

    expect(balancesService.upsertBalance).toHaveBeenCalledTimes(2);
    expect(balancesService.upsertBalance).toHaveBeenNthCalledWith(1, 'emp_001', 'loc_001', 10, 'HCM_BATCH');
    expect(result).toEqual(expect.objectContaining({
      status: 'SUCCESS',
      recordsReceived: 2,
      recordsProcessed: 2,
      recordsFailed: 0,
      errors: [],
    }));
  });

  it('valid batch updates existing balances', async () => {
    const result = await service.processBatchSync({
      balances: [
        { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 15 },
      ],
    });

    expect(balancesService.upsertBalance).toHaveBeenCalledWith('emp_001', 'loc_001', 15, 'HCM_BATCH');
    expect(result.status).toBe('SUCCESS');
  });

  it('negative availableDays record fails and is not persisted', async () => {
    const result = await service.processBatchSync({
      balances: [
        { employeeId: 'emp_001', locationId: 'loc_001', availableDays: -1 },
      ],
    });

    expect(balancesService.upsertBalance).not.toHaveBeenCalled();
    expect(result.status).toBe('FAILED');
    expect(result.recordsFailed).toBe(1);
    expect(result.errors).toEqual([
      { index: 0, message: 'availableDays must be greater than or equal to 0' },
    ]);
  });

  it('mixed valid and invalid records returns PARTIAL_SUCCESS', async () => {
    const result = await service.processBatchSync({
      balances: [
        { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 10 },
        { employeeId: 'emp_002', locationId: 'loc_001', availableDays: -1 },
      ],
    });

    expect(balancesService.upsertBalance).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      status: 'PARTIAL_SUCCESS',
      recordsReceived: 2,
      recordsProcessed: 1,
      recordsFailed: 1,
    }));
  });

  it('empty balances array returns VALIDATION_ERROR', async () => {
    await expect(service.processBatchSync({ balances: [] })).rejects.toMatchObject({
      response: {
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
        },
      },
      status: 400,
    });
  });

  it('missing balances field returns VALIDATION_ERROR', async () => {
    await expect(service.processBatchSync({})).rejects.toMatchObject({
      response: {
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
        },
      },
      status: 400,
    });
  });

  it('all invalid records returns FAILED', async () => {
    const result = await service.processBatchSync({
      balances: [
        { employeeId: '', locationId: 'loc_001', availableDays: 2 },
        { employeeId: 'emp_002', locationId: 'loc_001', availableDays: -1 },
      ],
    });

    expect(result.status).toBe('FAILED');
    expect(result.recordsReceived).toBe(2);
    expect(result.recordsProcessed).toBe(0);
    expect(result.recordsFailed).toBe(2);
    expect(balancesService.upsertBalance).not.toHaveBeenCalled();
  });

  it('sync run is saved for SUCCESS', async () => {
    await service.processBatchSync({
      balances: [
        { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 10 },
      ],
    });

    expect(syncRunRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'SUCCESS',
      recordsReceived: 1,
      recordsProcessed: 1,
      recordsFailed: 0,
      errorMessage: null,
    }));
  });

  it('sync run is saved for PARTIAL_SUCCESS', async () => {
    await service.processBatchSync({
      balances: [
        { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 10 },
        { employeeId: 'emp_002', locationId: 'loc_001', availableDays: -1 },
      ],
    });

    expect(syncRunRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PARTIAL_SUCCESS',
      recordsReceived: 2,
      recordsProcessed: 1,
      recordsFailed: 1,
      errorMessage: expect.stringContaining('availableDays must be greater than or equal to 0'),
    }));
  });

  it('sync run is saved for FAILED validation attempts', async () => {
    await expect(service.processBatchSync({ balances: [] })).rejects.toBeDefined();

    expect(syncRunRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'FAILED',
      recordsReceived: 0,
      recordsProcessed: 0,
      recordsFailed: 0,
      errorMessage: expect.stringContaining('balances must be a non-empty array'),
    }));
  });
});
