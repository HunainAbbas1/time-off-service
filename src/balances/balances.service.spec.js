const { HttpException } = require('@nestjs/common');
const { BalancesService } = require('./balances.service');
const { ErrorCodes } = require('../common/errors/error-codes');

function makeHttpError(status, code) {
  return new HttpException({
    success: false,
    error: { code, message: code },
  }, status);
}

describe('BalancesService', () => {
  let service;
  let repository;
  let hcmService;

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(),
    };

    hcmService = {
      getBalance: jest.fn(),
    };

    service = new BalancesService(repository, hcmService);
  });

  describe('getLocalBalance', () => {
    it('returns existing local balance', async () => {
      const lastSyncedAt = new Date('2026-04-26T06:00:00.000Z');
      repository.findOne.mockResolvedValue({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: '12.5',
        source: 'HCM_BATCH',
        lastSyncedAt,
      });

      const result = await service.getLocalBalance('emp_001', 'loc_001');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { employeeId: 'emp_001', locationId: 'loc_001' },
      });
      expect(result).toEqual({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 12.5,
        source: 'HCM_BATCH',
        lastSyncedAt,
      });
    });

    it('throws BALANCE_NOT_FOUND when missing', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.getLocalBalance('emp_404', 'loc_001')).rejects.toMatchObject({
        response: {
          error: {
            code: ErrorCodes.BALANCE_NOT_FOUND,
          },
        },
        status: 404,
      });
    });
  });

  describe('upsertBalance', () => {
    it('creates a new balance', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.save.mockImplementation(async (balance) => balance);

      const result = await service.upsertBalance('emp_001', 'loc_001', 8, 'LOCAL_ESTIMATE');

      expect(repository.create).toHaveBeenCalledWith({
        employeeId: 'emp_001',
        locationId: 'loc_001',
      });
      expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 8,
        source: 'LOCAL_ESTIMATE',
        lastSyncedAt: expect.any(Date),
      }));
      expect(result).toEqual(expect.objectContaining({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 8,
        source: 'LOCAL_ESTIMATE',
        lastSyncedAt: expect.any(Date),
      }));
    });

    it('updates an existing balance', async () => {
      const existing = {
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 3,
        source: 'LOCAL_ESTIMATE',
        lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      repository.findOne.mockResolvedValue(existing);
      repository.save.mockImplementation(async (balance) => balance);

      const result = await service.upsertBalance('emp_001', 'loc_001', 11, 'HCM_BATCH');

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledWith(existing);
      expect(result.availableDays).toBe(11);
      expect(result.source).toBe('HCM_BATCH');
      expect(result.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('rejects negative availableDays', async () => {
      await expect(
        service.upsertBalance('emp_001', 'loc_001', -1, 'HCM_BATCH'),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
          },
        },
        status: 400,
      });
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects invalid source', async () => {
      await expect(
        service.upsertBalance('emp_001', 'loc_001', 1, 'BAD_SOURCE'),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
          },
        },
        status: 400,
      });
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('refreshFromHcm', () => {
    it('creates local balance from HCM', async () => {
      hcmService.getBalance.mockResolvedValue({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 14,
      });
      repository.findOne.mockResolvedValue(null);
      repository.save.mockImplementation(async (balance) => balance);

      const result = await service.refreshFromHcm('emp_001', 'loc_001');

      expect(hcmService.getBalance).toHaveBeenCalledWith('emp_001', 'loc_001');
      expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 14,
        source: 'HCM_REALTIME',
      }));
      expect(result.availableDays).toBe(14);
      expect(result.source).toBe('HCM_REALTIME');
    });

    it('updates existing local balance from HCM', async () => {
      const existing = {
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 4,
        source: 'LOCAL_ESTIMATE',
        lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      hcmService.getBalance.mockResolvedValue({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 9,
      });
      repository.findOne.mockResolvedValue(existing);
      repository.save.mockImplementation(async (balance) => balance);

      const result = await service.refreshFromHcm('emp_001', 'loc_001');

      expect(repository.save).toHaveBeenCalledWith(existing);
      expect(result.availableDays).toBe(9);
      expect(result.source).toBe('HCM_REALTIME');
    });

    it('does not overwrite existing balance when HCM throws INVALID_DIMENSIONS', async () => {
      const hcmError = makeHttpError(400, ErrorCodes.INVALID_DIMENSIONS);
      hcmService.getBalance.mockRejectedValue(hcmError);

      await expect(service.refreshFromHcm('emp_404', 'loc_001')).rejects.toBe(hcmError);
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('does not overwrite existing balance when HCM throws HCM_UNAVAILABLE', async () => {
      const hcmError = makeHttpError(503, ErrorCodes.HCM_UNAVAILABLE);
      hcmService.getBalance.mockRejectedValue(hcmError);

      await expect(service.refreshFromHcm('emp_001', 'loc_001')).rejects.toBe(hcmError);
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });
  });
});
