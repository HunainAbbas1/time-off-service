const { HttpException } = require('@nestjs/common');
const { TimeOffRequestsService, REQUEST_STATUSES } = require('./time-off-requests.service');
const { ErrorCodes } = require('../common/errors/error-codes');

function makeHttpError(status, code) {
  return new HttpException({
    success: false,
    error: { code, message: code },
  }, status);
}

function validBody(overrides = {}) {
  return {
    employeeId: 'emp_001',
    locationId: 'loc_001',
    amountDays: 2,
    startDate: '2026-05-01',
    endDate: '2026-05-02',
    reason: 'Family trip',
    ...overrides,
  };
}

function employeeUser(overrides = {}) {
  return { userId: 'emp_001', role: 'employee', ...overrides };
}

describe('TimeOffRequestsService', () => {
  let service;
  let requestRepository;
  let historyRepository;
  let hcmService;
  let balancesService;
  let savedRequests;
  let savedHistory;

  beforeEach(() => {
    savedRequests = [];
    savedHistory = [];
    requestRepository = {
      findOne: jest.fn(async ({ where }) => savedRequests.find((request) => (
        Object.entries(where).every(([key, value]) => request[key] === value)
      )) || null),
      find: jest.fn(async ({ where }) => savedRequests.filter((request) => (
        Object.entries(where).every(([key, value]) => request[key] === value)
      ))),
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(async (request) => {
        const saved = {
          id: request.id || `req_${savedRequests.length + 1}`,
          createdAt: request.createdAt || new Date('2026-04-26T06:00:00.000Z'),
          updatedAt: request.updatedAt || new Date('2026-04-26T06:00:00.000Z'),
          ...request,
        };
        savedRequests.push(saved);
        return saved;
      }),
    };

    historyRepository = {
      create: jest.fn((data) => ({ ...data })),
      find: jest.fn(async ({ where, order }) => {
        const history = savedHistory.filter((entry) => (
          Object.entries(where).every(([key, value]) => entry[key] === value)
        ));

        if (order && order.createdAt === 'ASC') {
          return history.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        }

        return history;
      }),
      save: jest.fn(async (history) => {
        const saved = {
          id: history.id || `hist_${savedHistory.length + 1}`,
          createdAt: history.createdAt || new Date('2026-04-26T06:00:00.000Z'),
          ...history,
        };
        savedHistory.push(saved);
        return saved;
      }),
    };

    hcmService = {
      getBalance: jest.fn(async () => ({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 10,
      })),
      submitTimeOff: jest.fn(async () => ({
        hcmSubmissionId: 'hcm_sub_001',
        status: 'ACCEPTED',
      })),
    };

    balancesService = {
      getLocalBalance: jest.fn(async () => ({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        availableDays: 10,
        source: 'HCM_BATCH',
      })),
      upsertBalance: jest.fn(async (employeeId, locationId, availableDays, source) => ({
        employeeId,
        locationId,
        availableDays,
        source,
      })),
      refreshFromHcm: jest.fn(async (employeeId, locationId) => ({
        employeeId,
        locationId,
        availableDays: 8,
        source: 'HCM_REALTIME',
      })),
    };

    service = new TimeOffRequestsService(
      requestRepository,
      historyRepository,
      hcmService,
      balancesService,
    );
  });

  it('creates valid request with existing local and HCM balance', async () => {
    const result = await service.create(validBody(), employeeUser());

    expect(result).toEqual(expect.objectContaining({
      id: 'req_1',
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 2,
      status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
    }));
    expect(balancesService.upsertBalance).not.toHaveBeenCalled();
    expect(requestRepository.save).toHaveBeenCalledTimes(1);
  });

  it('creates valid request when local balance is missing but HCM is valid and upserts local cache', async () => {
    balancesService.getLocalBalance.mockRejectedValue(makeHttpError(404, ErrorCodes.BALANCE_NOT_FOUND));

    const result = await service.create(validBody(), employeeUser());

    expect(balancesService.upsertBalance).toHaveBeenCalledWith('emp_001', 'loc_001', 10, 'HCM_REALTIME');
    expect(result.status).toBe(REQUEST_STATUSES.PENDING_MANAGER_APPROVAL);
  });

  it('missing employeeId returns VALIDATION_ERROR', async () => {
    await expect(service.create(validBody({ employeeId: '' }), employeeUser())).rejects.toMatchObject({
      response: { error: { code: ErrorCodes.VALIDATION_ERROR } },
      status: 400,
    });
  });

  it('amountDays <= 0 returns VALIDATION_ERROR', async () => {
    await expect(service.create(validBody({ amountDays: 0 }), employeeUser())).rejects.toMatchObject({
      response: { error: { code: ErrorCodes.VALIDATION_ERROR } },
      status: 400,
    });
  });

  it('startDate after endDate returns VALIDATION_ERROR', async () => {
    await expect(
      service.create(validBody({ startDate: '2026-05-03', endDate: '2026-05-02' }), employeeUser()),
    ).rejects.toMatchObject({
      response: { error: { code: ErrorCodes.VALIDATION_ERROR } },
      status: 400,
    });
  });

  it('employee cannot create request for another employee', async () => {
    await expect(service.create(validBody({ employeeId: 'emp_002' }), employeeUser())).rejects.toMatchObject({
      response: { error: { code: ErrorCodes.FORBIDDEN } },
      status: 403,
    });
  });

  it('manager cannot create request', async () => {
    await expect(service.create(validBody(), { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
      response: { error: { code: ErrorCodes.FORBIDDEN } },
      status: 403,
    });
  });

  it('insufficient local balance returns INSUFFICIENT_LOCAL_BALANCE and does not create request', async () => {
    balancesService.getLocalBalance.mockResolvedValue({ availableDays: 1 });

    await expect(service.create(validBody({ amountDays: 2 }), employeeUser())).rejects.toMatchObject({
      response: { error: { code: ErrorCodes.INSUFFICIENT_LOCAL_BALANCE } },
      status: 400,
    });
    expect(requestRepository.save).not.toHaveBeenCalled();
  });

  it('insufficient HCM balance returns INSUFFICIENT_HCM_BALANCE and does not create request', async () => {
    hcmService.getBalance.mockResolvedValue({ employeeId: 'emp_001', locationId: 'loc_001', availableDays: 1 });

    await expect(service.create(validBody({ amountDays: 2 }), employeeUser())).rejects.toMatchObject({
      response: { error: { code: ErrorCodes.INSUFFICIENT_HCM_BALANCE } },
      status: 400,
    });
    expect(requestRepository.save).not.toHaveBeenCalled();
  });

  it('invalid HCM dimensions returns INVALID_DIMENSIONS', async () => {
    const hcmError = makeHttpError(400, ErrorCodes.INVALID_DIMENSIONS);
    hcmService.getBalance.mockRejectedValue(hcmError);

    await expect(service.create(validBody(), employeeUser())).rejects.toBe(hcmError);
  });

  it('HCM unavailable returns HCM_UNAVAILABLE', async () => {
    const hcmError = makeHttpError(503, ErrorCodes.HCM_UNAVAILABLE);
    hcmService.getBalance.mockRejectedValue(hcmError);

    await expect(service.create(validBody(), employeeUser())).rejects.toBe(hcmError);
  });

  it('same employeeId and same idempotencyKey returns existing request and does not create duplicate', async () => {
    savedRequests.push({
      id: 'req_existing',
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 2,
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      reason: 'Existing',
      status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
      hcmSubmissionId: null,
      idempotencyKey: 'same-key',
    });

    const result = await service.create(validBody({ idempotencyKey: 'same-key' }), employeeUser());

    expect(result.id).toBe('req_existing');
    expect(requestRepository.save).not.toHaveBeenCalled();
  });

  it('same idempotencyKey for different employee does not conflict', async () => {
    savedRequests.push({
      id: 'req_other',
      employeeId: 'emp_002',
      locationId: 'loc_001',
      amountDays: 2,
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
      idempotencyKey: 'same-key',
    });

    const result = await service.create(validBody({ idempotencyKey: 'same-key' }), employeeUser());

    expect(result.id).toBe('req_2');
    expect(requestRepository.save).toHaveBeenCalledTimes(1);
  });

  it('history row is written on successful creation', async () => {
    const result = await service.create(validBody(), employeeUser());

    expect(historyRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      requestId: result.id,
      fromStatus: null,
      toStatus: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
      actorId: 'emp_001',
      actorRole: 'employee',
    }));
  });

  it('pending request blocks new request when effective availability is insufficient', async () => {
    savedRequests.push({
      id: 'req_pending',
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 9,
      status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
    });

    await expect(service.create(validBody({ amountDays: 2 }), employeeUser())).rejects.toMatchObject({
      response: { error: { code: ErrorCodes.INSUFFICIENT_EFFECTIVE_BALANCE } },
      status: 400,
    });
  });

  it('rejected request does not block new request', async () => {
    savedRequests.push({
      id: 'req_rejected',
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 9,
      status: REQUEST_STATUSES.REJECTED,
    });

    const result = await service.create(validBody({ amountDays: 2 }), employeeUser());
    expect(result.status).toBe(REQUEST_STATUSES.PENDING_MANAGER_APPROVAL);
  });

  it('completed request does not get double-subtracted', async () => {
    savedRequests.push({
      id: 'req_completed',
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 2,
      status: REQUEST_STATUSES.COMPLETED,
    });

    hcmService.getBalance.mockResolvedValue({ employeeId: 'emp_001', locationId: 'loc_001', availableDays: 8 });
    balancesService.getLocalBalance.mockResolvedValue({ availableDays: 8 });

    const result = await service.create(validBody({ amountDays: 8 }), employeeUser());
    expect(result.amountDays).toBe(8);
  });

  it('pending deduction is scoped by employeeId and locationId', async () => {
    savedRequests.push({
      id: 'req_pending',
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 9,
      status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
    });

    const deduction = await service.getPendingDeduction('emp_001', 'loc_001');
    expect(deduction).toBe(9);
  });

  it('pending request in another location does not affect this location', async () => {
    savedRequests.push({
      id: 'req_other_location',
      employeeId: 'emp_001',
      locationId: 'loc_002',
      amountDays: 9,
      status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
    });

    const result = await service.create(validBody({ amountDays: 2 }), employeeUser());
    expect(result.status).toBe(REQUEST_STATUSES.PENDING_MANAGER_APPROVAL);
  });

  it('pending request for another employee does not affect this employee', async () => {
    savedRequests.push({
      id: 'req_other_employee',
      employeeId: 'emp_002',
      locationId: 'loc_001',
      amountDays: 9,
      status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
    });

    const result = await service.create(validBody({ amountDays: 2 }), employeeUser());
    expect(result.status).toBe(REQUEST_STATUSES.PENDING_MANAGER_APPROVAL);
  });

  describe('findOne', () => {
    beforeEach(() => {
      savedRequests.push(
        {
          id: 'req_001',
          employeeId: 'emp_001',
          locationId: 'loc_001',
          amountDays: 2,
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          reason: 'Own',
          status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
          hcmSubmissionId: null,
          idempotencyKey: null,
        },
        {
          id: 'req_002',
          employeeId: 'emp_002',
          locationId: 'loc_001',
          amountDays: 3,
          startDate: '2026-05-03',
          endDate: '2026-05-04',
          reason: 'Other',
          status: REQUEST_STATUSES.REJECTED,
          hcmSubmissionId: null,
          idempotencyKey: null,
        },
      );
    });

    it('returns own request for employee', async () => {
      const result = await service.findOne('req_001', employeeUser());

      expect(result).toEqual(expect.objectContaining({
        id: 'req_001',
        employeeId: 'emp_001',
        history: [],
      }));
    });

    it('returns any request for manager', async () => {
      const result = await service.findOne('req_002', { userId: 'mgr_001', role: 'manager' });

      expect(result.employeeId).toBe('emp_002');
    });

    it('missing request returns REQUEST_NOT_FOUND', async () => {
      await expect(service.findOne('missing', employeeUser())).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.REQUEST_NOT_FOUND } },
        status: 404,
      });
    });

    it('employee cannot findOne for another employee', async () => {
      await expect(service.findOne('req_002', employeeUser())).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.FORBIDDEN } },
        status: 403,
      });
    });

    it('returns history array ordered by createdAt ascending', async () => {
      savedHistory.push(
        {
          id: 'hist_2',
          requestId: 'req_001',
          toStatus: 'SECOND',
          createdAt: new Date('2026-05-02T00:00:00.000Z'),
        },
        {
          id: 'hist_1',
          requestId: 'req_001',
          toStatus: 'FIRST',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
        },
      );

      const result = await service.findOne('req_001', employeeUser());

      expect(result.history.map((entry) => entry.id)).toEqual(['hist_1', 'hist_2']);
      expect(historyRepository.find).toHaveBeenCalledWith({
        where: { requestId: 'req_001' },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      savedRequests.push(
        {
          id: 'req_001',
          employeeId: 'emp_001',
          locationId: 'loc_001',
          amountDays: 2,
          startDate: '2026-05-01',
          endDate: '2026-05-02',
          status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
        },
        {
          id: 'req_002',
          employeeId: 'emp_002',
          locationId: 'loc_002',
          amountDays: 3,
          startDate: '2026-05-03',
          endDate: '2026-05-04',
          status: REQUEST_STATUSES.REJECTED,
        },
        {
          id: 'req_003',
          employeeId: 'emp_001',
          locationId: 'loc_002',
          amountDays: 1,
          startDate: '2026-05-05',
          endDate: '2026-05-06',
          status: REQUEST_STATUSES.COMPLETED,
        },
      );
    });

    it('returns employee own requests', async () => {
      const result = await service.findAll({}, employeeUser());

      expect(result.map((request) => request.id)).toEqual(['req_001', 'req_003']);
    });

    it('manager returns all requests', async () => {
      const result = await service.findAll({}, { userId: 'mgr_001', role: 'manager' });

      expect(result).toHaveLength(3);
    });

    it('filters by employeeId', async () => {
      const result = await service.findAll({ employeeId: 'emp_002' }, { userId: 'mgr_001', role: 'manager' });

      expect(result.map((request) => request.id)).toEqual(['req_002']);
    });

    it('filters by locationId', async () => {
      const result = await service.findAll({ locationId: 'loc_002' }, { userId: 'mgr_001', role: 'manager' });

      expect(result.map((request) => request.id)).toEqual(['req_002', 'req_003']);
    });

    it('filters by status', async () => {
      const result = await service.findAll({ status: REQUEST_STATUSES.REJECTED }, { userId: 'mgr_001', role: 'manager' });

      expect(result.map((request) => request.id)).toEqual(['req_002']);
    });

    it('employee cannot filter or list another employee requests', async () => {
      await expect(service.findAll({ employeeId: 'emp_002' }, employeeUser())).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.FORBIDDEN } },
        status: 403,
      });
    });

    it('missing auth returns FORBIDDEN', async () => {
      await expect(service.findAll({}, { userId: null, role: null })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.FORBIDDEN } },
        status: 403,
      });
    });

    it('invalid role returns FORBIDDEN', async () => {
      await expect(service.findAll({}, { userId: 'sys_001', role: 'system' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.FORBIDDEN } },
        status: 403,
      });
    });
  });

  describe('reject', () => {
    beforeEach(() => {
      savedRequests.push({
        id: 'req_pending',
        employeeId: 'emp_001',
        locationId: 'loc_001',
        amountDays: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
        hcmSubmissionId: null,
      });
    });

    it('manager rejects pending request successfully', async () => {
      const result = await service.reject('req_pending', {}, { userId: 'mgr_001', role: 'manager' });

      expect(result.status).toBe(REQUEST_STATUSES.REJECTED);
      expect(savedRequests[0].status).toBe(REQUEST_STATUSES.REJECTED);
    });

    it('reject writes history with reason', async () => {
      await service.reject('req_pending', { reason: 'Not enough coverage' }, { userId: 'mgr_001', role: 'manager' });

      expect(historyRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        requestId: 'req_pending',
        fromStatus: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
        toStatus: REQUEST_STATUSES.REJECTED,
        actorId: 'mgr_001',
        actorRole: 'manager',
        reason: 'Not enough coverage',
      }));
    });

    it('employee cannot reject request', async () => {
      await expect(service.reject('req_pending', {}, employeeUser())).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.FORBIDDEN } },
        status: 403,
      });
    });

    it('missing auth cannot reject request', async () => {
      await expect(service.reject('req_pending', {}, { userId: null, role: null })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.FORBIDDEN } },
        status: 403,
      });
    });

    it('reject missing request returns REQUEST_NOT_FOUND', async () => {
      await expect(service.reject('missing', {}, { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.REQUEST_NOT_FOUND } },
        status: 404,
      });
    });

    it('reject completed request returns INVALID_STATUS_TRANSITION', async () => {
      savedRequests[0].status = REQUEST_STATUSES.COMPLETED;

      await expect(service.reject('req_pending', {}, { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.INVALID_STATUS_TRANSITION } },
        status: 409,
      });
    });
  });

  describe('approve', () => {
    beforeEach(() => {
      savedRequests.push({
        id: 'req_pending',
        employeeId: 'emp_001',
        locationId: 'loc_001',
        amountDays: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
        hcmSubmissionId: null,
      });
    });

    it('manager approves pending request successfully', async () => {
      const result = await service.approve('req_pending', { userId: 'mgr_001', role: 'manager' });

      expect(result.status).toBe(REQUEST_STATUSES.COMPLETED);
      expect(result.hcmSubmissionId).toBe('hcm_sub_001');
      expect(hcmService.submitTimeOff).toHaveBeenCalledWith(expect.objectContaining({
        employeeId: 'emp_001',
        locationId: 'loc_001',
        amountDays: 2,
        externalRequestId: 'req_pending',
      }));
    });

    it('approve writes history and stores hcmSubmissionId', async () => {
      await service.approve('req_pending', { userId: 'mgr_001', role: 'manager' });

      expect(savedRequests[0].hcmSubmissionId).toBe('hcm_sub_001');
      expect(historyRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        requestId: 'req_pending',
        fromStatus: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
        toStatus: REQUEST_STATUSES.COMPLETED,
        actorId: 'mgr_001',
        actorRole: 'manager',
        metadata: JSON.stringify({ hcmSubmissionId: 'hcm_sub_001' }),
      }));
    });

    it('approve refreshes local balance after HCM submission', async () => {
      await service.approve('req_pending', { userId: 'mgr_001', role: 'manager' });

      expect(balancesService.refreshFromHcm).toHaveBeenCalledWith('emp_001', 'loc_001');
    });

    it('employee cannot approve request', async () => {
      await expect(service.approve('req_pending', employeeUser())).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.FORBIDDEN } },
        status: 403,
      });
    });

    it('missing auth cannot approve request', async () => {
      await expect(service.approve('req_pending', { userId: null, role: null })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.FORBIDDEN } },
        status: 403,
      });
    });

    it('approve missing request returns REQUEST_NOT_FOUND', async () => {
      await expect(service.approve('missing', { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.REQUEST_NOT_FOUND } },
        status: 404,
      });
    });

    it('approve completed request returns INVALID_STATUS_TRANSITION', async () => {
      savedRequests[0].status = REQUEST_STATUSES.COMPLETED;

      await expect(service.approve('req_pending', { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.INVALID_STATUS_TRANSITION } },
        status: 409,
      });
    });

    it('approve rejected request returns INVALID_STATUS_TRANSITION', async () => {
      savedRequests[0].status = REQUEST_STATUSES.REJECTED;

      await expect(service.approve('req_pending', { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.INVALID_STATUS_TRANSITION } },
        status: 409,
      });
    });

    it('HCM unavailable during approval keeps status PENDING_MANAGER_APPROVAL', async () => {
      const hcmError = makeHttpError(503, ErrorCodes.HCM_UNAVAILABLE);
      hcmService.getBalance.mockRejectedValue(hcmError);

      await expect(service.approve('req_pending', { userId: 'mgr_001', role: 'manager' })).rejects.toBe(hcmError);
      expect(savedRequests[0].status).toBe(REQUEST_STATUSES.PENDING_MANAGER_APPROVAL);
      expect(hcmService.submitTimeOff).not.toHaveBeenCalled();
      expect(historyRepository.save).not.toHaveBeenCalled();
    });

    it('insufficient HCM balance marks request FAILED_HCM_VALIDATION and returns INSUFFICIENT_HCM_BALANCE', async () => {
      hcmService.getBalance.mockResolvedValue({ employeeId: 'emp_001', locationId: 'loc_001', availableDays: 1 });

      await expect(service.approve('req_pending', { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.INSUFFICIENT_HCM_BALANCE } },
        status: 400,
      });
      expect(savedRequests[0].status).toBe(REQUEST_STATUSES.FAILED_HCM_VALIDATION);
    });

    it('HCM submission failure marks request FAILED_HCM_SUBMISSION', async () => {
      hcmService.submitTimeOff.mockRejectedValue(makeHttpError(503, ErrorCodes.HCM_UNAVAILABLE));

      await expect(service.approve('req_pending', { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.HCM_SUBMISSION_FAILED } },
        status: 400,
      });
      expect(savedRequests[0].status).toBe(REQUEST_STATUSES.FAILED_HCM_SUBMISSION);
    });

    it('HCM submission failure writes history and does not refresh local balance', async () => {
      hcmService.submitTimeOff.mockRejectedValue(makeHttpError(503, ErrorCodes.HCM_UNAVAILABLE));

      await expect(service.approve('req_pending', { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.HCM_SUBMISSION_FAILED } },
      });

      expect(historyRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        requestId: 'req_pending',
        fromStatus: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
        toStatus: REQUEST_STATUSES.FAILED_HCM_SUBMISSION,
        actorId: 'mgr_001',
        actorRole: 'manager',
        metadata: JSON.stringify({
          code: ErrorCodes.HCM_UNAVAILABLE,
          message: ErrorCodes.HCM_UNAVAILABLE,
        }),
      }));
      expect(balancesService.refreshFromHcm).not.toHaveBeenCalled();
    });

    it('approving completed request does not call HCM submit again', async () => {
      savedRequests[0].status = REQUEST_STATUSES.COMPLETED;

      await expect(service.approve('req_pending', { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.INVALID_STATUS_TRANSITION } },
      });
      expect(hcmService.submitTimeOff).not.toHaveBeenCalled();
    });

    it('rejecting completed request does not call HCM', async () => {
      savedRequests[0].status = REQUEST_STATUSES.COMPLETED;

      await expect(service.reject('req_pending', {}, { userId: 'mgr_001', role: 'manager' })).rejects.toMatchObject({
        response: { error: { code: ErrorCodes.INVALID_STATUS_TRANSITION } },
      });
      expect(hcmService.getBalance).not.toHaveBeenCalled();
      expect(hcmService.submitTimeOff).not.toHaveBeenCalled();
    });
  });
});
