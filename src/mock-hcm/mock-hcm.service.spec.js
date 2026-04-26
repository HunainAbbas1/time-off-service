const { MockHcmService } = require('./mock-hcm.service');
const { ErrorCodes } = require('../common/errors/error-codes');

describe('MockHcmService', () => {
  let service;
  let mockRepository;

  beforeEach(async () => {
    // Create a mock repository
    mockRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };

    // Instantiate service directly with mock repository
    service = new MockHcmService(mockRepository);
  });

  describe('getBalance', () => {
    it('should return existing balance', async () => {
      const mockBalance = {
        id: 'id-123',
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 10,
      };

      mockRepository.findOne.mockResolvedValue(mockBalance);

      const result = await service.getBalance('emp_001', 'loc_001');

      expect(result).toEqual({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 10,
      });
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { employeeId: 'emp_001', locationId: 'loc_001' },
      });
    });

    it('should throw INVALID_DIMENSIONS when balance not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      try {
        await service.getBalance('emp_999', 'loc_999');
        fail('Expected exception to be thrown');
      } catch (error) {
        expect(error.getStatus()).toBe(400);
        const response = error.getResponse();
        expect(response.error.code).toBe(ErrorCodes.INVALID_DIMENSIONS);
      }
    });

    it('should throw HCM_UNAVAILABLE when unavailable flag is true', async () => {
      service.setUnavailable(true);

      try {
        await service.getBalance('emp_001', 'loc_001');
        fail('Expected exception to be thrown');
      } catch (error) {
        expect(error.getStatus()).toBe(503);
        const response = error.getResponse();
        expect(response.error.code).toBe(ErrorCodes.HCM_UNAVAILABLE);
      }
    });

    it('should restore normal behavior after setUnavailable(false)', async () => {
      const mockBalance = {
        id: 'id-123',
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 10,
      };

      service.setUnavailable(true);
      service.setUnavailable(false);

      mockRepository.findOne.mockResolvedValue(mockBalance);

      const result = await service.getBalance('emp_001', 'loc_001');

      expect(result).toEqual({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 10,
      });
    });
  });

  describe('submitTimeOff', () => {
    it('should deduct balance successfully', async () => {
      const mockBalance = {
        id: 'id-123',
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 10,
      };

      mockRepository.findOne.mockResolvedValue(mockBalance);
      mockRepository.save.mockResolvedValue({
        ...mockBalance,
        availableDays: 8,
      });

      const result = await service.submitTimeOff({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        amountDays: 2,
      });

      expect(result.status).toBe('ACCEPTED');
      expect(result.hcmSubmissionId).toBeDefined();
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          availableDays: 8,
        }),
      );
    });

    it('should return hcmSubmissionId and ACCEPTED status', async () => {
      const mockBalance = {
        id: 'id-123',
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 10,
      };

      mockRepository.findOne.mockResolvedValue(mockBalance);
      mockRepository.save.mockResolvedValue(mockBalance);

      const result = await service.submitTimeOff({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        amountDays: 1,
      });

      expect(result.hcmSubmissionId).toBeDefined();
      expect(typeof result.hcmSubmissionId).toBe('string');
      expect(result.status).toBe('ACCEPTED');
    });

    it('should throw INSUFFICIENT_HCM_BALANCE when balance is insufficient', async () => {
      const mockBalance = {
        id: 'id-123',
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 2,
      };

      mockRepository.findOne.mockResolvedValue(mockBalance);

      try {
        await service.submitTimeOff({
          employeeId: 'emp_001',
          locationId: 'loc_001',
          amountDays: 5,
        });
        fail('Expected exception to be thrown');
      } catch (error) {
        expect(error.getStatus()).toBe(400);
        const response = error.getResponse();
        expect(response.error.code).toBe(ErrorCodes.INSUFFICIENT_HCM_BALANCE);
      }
    });

    it('should not deduct balance when insufficient', async () => {
      const mockBalance = {
        id: 'id-123',
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 2,
      };

      mockRepository.findOne.mockResolvedValue(mockBalance);

      try {
        await service.submitTimeOff({
          employeeId: 'emp_001',
          locationId: 'loc_001',
          amountDays: 5,
        });
      } catch {
        // Expected
      }

      // Save should never be called
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should throw INVALID_DIMENSIONS when employee/location does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      try {
        await service.submitTimeOff({
          employeeId: 'emp_999',
          locationId: 'loc_999',
          amountDays: 1,
        });
        fail('Expected exception to be thrown');
      } catch (error) {
        expect(error.getStatus()).toBe(400);
        const response = error.getResponse();
        expect(response.error.code).toBe(ErrorCodes.INVALID_DIMENSIONS);
      }
    });

    it('should throw HCM_UNAVAILABLE when unavailable flag is true', async () => {
      service.setUnavailable(true);

      try {
        await service.submitTimeOff({
          employeeId: 'emp_001',
          locationId: 'loc_001',
          amountDays: 1,
        });
        fail('Expected exception to be thrown');
      } catch (error) {
        expect(error.getStatus()).toBe(503);
        const response = error.getResponse();
        expect(response.error.code).toBe(ErrorCodes.HCM_UNAVAILABLE);
      }
    });

    it('should throw validation error for amountDays <= 0', async () => {
      try {
        await service.submitTimeOff({
          employeeId: 'emp_001',
          locationId: 'loc_001',
          amountDays: 0,
        });
        fail('Expected exception to be thrown');
      } catch (error) {
        expect(error.getStatus()).toBe(400);
        const response = error.getResponse();
        expect(response.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('should throw validation error for negative amountDays', async () => {
      try {
        await service.submitTimeOff({
          employeeId: 'emp_001',
          locationId: 'loc_001',
          amountDays: -5,
        });
        fail('Expected exception to be thrown');
      } catch (error) {
        expect(error.getStatus()).toBe(400);
        const response = error.getResponse();
        expect(response.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('should throw validation error for non-numeric amountDays', async () => {
      try {
        await service.submitTimeOff({
          employeeId: 'emp_001',
          locationId: 'loc_001',
          amountDays: 'invalid',
        });
        fail('Expected exception to be thrown');
      } catch (error) {
        expect(error.getStatus()).toBe(400);
        const response = error.getResponse();
        expect(response.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('should throw INVALID_DIMENSIONS when employeeId is missing', async () => {
      try {
        await service.submitTimeOff({
          locationId: 'loc_001',
          amountDays: 1,
        });
        fail('Expected exception to be thrown');
      } catch (error) {
        expect(error.getStatus()).toBe(400);
        const response = error.getResponse();
        expect(response.error.code).toBe(ErrorCodes.INVALID_DIMENSIONS);
      }
    });

    it('should throw INVALID_DIMENSIONS when locationId is missing', async () => {
      try {
        await service.submitTimeOff({
          employeeId: 'emp_001',
          amountDays: 1,
        });
        fail('Expected exception to be thrown');
      } catch (error) {
        expect(error.getStatus()).toBe(400);
        const response = error.getResponse();
        expect(response.error.code).toBe(ErrorCodes.INVALID_DIMENSIONS);
      }
    });
  });

  describe('setUnavailable', () => {
    it('should set unavailable flag to true', () => {
      service.setUnavailable(true);
      expect(service._unavailable).toBe(true);
    });

    it('should set unavailable flag to false', () => {
      service.setUnavailable(true);
      service.setUnavailable(false);
      expect(service._unavailable).toBe(false);
    });
  });

  describe('seedBalance', () => {
    it('should insert new balance', async () => {
      const newBalance = {
        id: 'id-123',
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 10,
      };

      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.save.mockResolvedValue(newBalance);

      const result = await service.seedBalance('emp_001', 'loc_001', 10);

      expect(result).toEqual(newBalance);
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should update existing balance', async () => {
      const existingBalance = {
        id: 'id-123',
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 10,
      };

      const updatedBalance = {
        ...existingBalance,
        availableDays: 20,
      };

      mockRepository.findOne.mockResolvedValue(existingBalance);
      mockRepository.save.mockResolvedValue(updatedBalance);

      const result = await service.seedBalance('emp_001', 'loc_001', 20);

      expect(result).toEqual(updatedBalance);
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ availableDays: 20 }),
      );
    });
  });

  describe('reset', () => {
    it('should clear all balances and reset unavailable flag', async () => {
      service.setUnavailable(true);
      mockRepository.delete.mockResolvedValue({ affected: 5 });

      await service.reset();

      expect(service._unavailable).toBe(false);
      expect(mockRepository.delete).toHaveBeenCalledWith({});
    });
  });
});

