const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { HttpExceptionFilter } = require('../src/common/filters/http-exception.filter');
const { BalancesService } = require('../src/balances/balances.service');
const { MockHcmService } = require('../src/mock-hcm/mock-hcm.service');
const { ErrorCodes } = require('../src/common/errors/error-codes');

const dbPath = path.join(__dirname, 'time-off-requests.e2e.sqlite');
process.env.DB_PATH = dbPath;
const { AppModule } = require('../src/app.module');

describe('TimeOffRequestsController create (e2e)', () => {
  let app;
  let balancesService;
  let mockHcmService;
  let requestRepository;

  beforeEach(async () => {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    balancesService = app.get(BalancesService);
    mockHcmService = app.get(MockHcmService);
    requestRepository = app.get(DataSource).getRepository('TimeOffRequest');
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  afterAll(() => {
    delete process.env.DB_PATH;
  });

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

  function postCreate(body, userId = 'emp_001', role = 'employee') {
    const req = request(app.getHttpServer()).post('/time-off-requests').send(body);
    if (userId) req.set('x-user-id', userId);
    if (role) req.set('x-user-role', role);
    return req;
  }

  async function seedLocalAndHcm(employeeId = 'emp_001', locationId = 'loc_001', localDays = 10, hcmDays = 10) {
    await balancesService.upsertBalance(employeeId, locationId, localDays, 'LOCAL_ESTIMATE');
    await mockHcmService.seedBalance(employeeId, locationId, hcmDays);
  }

  async function seedRequest(overrides = {}) {
    return requestRepository.save({
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 2,
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      reason: null,
      status: 'PENDING_MANAGER_APPROVAL',
      hcmSubmissionId: null,
      idempotencyKey: null,
      ...overrides,
    });
  }

  it('employee creates valid request', async () => {
    await seedLocalAndHcm();

    const response = await postCreate(validBody()).expect(201);

    expect(response.body).toEqual(expect.objectContaining({
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 2,
      status: 'PENDING_MANAGER_APPROVAL',
    }));
  });

  it('employee cannot create for another employee', async () => {
    await seedLocalAndHcm('emp_002', 'loc_001', 10, 10);

    const response = await postCreate(validBody({ employeeId: 'emp_002' }), 'emp_001', 'employee')
      .expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('manager cannot create request', async () => {
    await seedLocalAndHcm();

    const response = await postCreate(validBody(), 'mgr_001', 'manager').expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('missing auth returns FORBIDDEN', async () => {
    await seedLocalAndHcm();

    const response = await postCreate(validBody(), null, null).expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('insufficient local balance returns INSUFFICIENT_LOCAL_BALANCE', async () => {
    await seedLocalAndHcm('emp_001', 'loc_001', 1, 10);

    const response = await postCreate(validBody({ amountDays: 2 })).expect(400);

    expect(response.body.error.code).toBe(ErrorCodes.INSUFFICIENT_LOCAL_BALANCE);
  });

  it('missing local balance but valid HCM creates request and upserts local balance', async () => {
    await mockHcmService.seedBalance('emp_001', 'loc_001', 10);

    const response = await postCreate(validBody()).expect(201);
    expect(response.body.status).toBe('PENDING_MANAGER_APPROVAL');

    const balance = await request(app.getHttpServer())
      .get('/balances/emp_001/loc_001')
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(balance.body.availableDays).toBe(10);
    expect(balance.body.source).toBe('HCM_REALTIME');
  });

  it('insufficient HCM balance returns INSUFFICIENT_HCM_BALANCE', async () => {
    await seedLocalAndHcm('emp_001', 'loc_001', 10, 1);

    const response = await postCreate(validBody({ amountDays: 2 })).expect(400);

    expect(response.body.error.code).toBe(ErrorCodes.INSUFFICIENT_HCM_BALANCE);
  });

  it('invalid HCM dimensions returns INVALID_DIMENSIONS', async () => {
    const response = await postCreate(validBody()).expect(400);

    expect(response.body.error.code).toBe(ErrorCodes.INVALID_DIMENSIONS);
  });

  it('idempotency key returns existing request on retry', async () => {
    await seedLocalAndHcm();

    const first = await postCreate(validBody({ idempotencyKey: 'idem-001' })).expect(201);
    const second = await postCreate(validBody({ idempotencyKey: 'idem-001' })).expect(201);
    const count = await requestRepository.count();

    expect(second.body.id).toBe(first.body.id);
    expect(count).toBe(1);
  });

  it('employee creates request, then GET by id returns it with history', async () => {
    await seedLocalAndHcm();

    const created = await postCreate(validBody()).expect(201);
    const response = await request(app.getHttpServer())
      .get(`/time-off-requests/${created.body.id}`)
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      id: created.body.id,
      employeeId: 'emp_001',
      status: 'PENDING_MANAGER_APPROVAL',
    }));
    expect(response.body.history).toHaveLength(1);
    expect(response.body.history[0]).toEqual(expect.objectContaining({
      toStatus: 'PENDING_MANAGER_APPROVAL',
      actorId: 'emp_001',
      actorRole: 'employee',
    }));
  });

  it('manager can GET any request by id', async () => {
    await seedLocalAndHcm('emp_002', 'loc_001', 10, 10);
    const created = await postCreate(validBody({ employeeId: 'emp_002' }), 'emp_002', 'employee').expect(201);

    const response = await request(app.getHttpServer())
      .get(`/time-off-requests/${created.body.id}`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(response.body.employeeId).toBe('emp_002');
  });

  it('employee cannot GET another employee request', async () => {
    await seedLocalAndHcm('emp_002', 'loc_001', 10, 10);
    const created = await postCreate(validBody({ employeeId: 'emp_002' }), 'emp_002', 'employee').expect(201);

    const response = await request(app.getHttpServer())
      .get(`/time-off-requests/${created.body.id}`)
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('missing request returns REQUEST_NOT_FOUND', async () => {
    const response = await request(app.getHttpServer())
      .get('/time-off-requests/missing-id')
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .expect(404);

    expect(response.body.error.code).toBe(ErrorCodes.REQUEST_NOT_FOUND);
  });

  it('employee lists own requests', async () => {
    await seedLocalAndHcm('emp_001', 'loc_001', 10, 10);
    await seedLocalAndHcm('emp_002', 'loc_001', 10, 10);
    await postCreate(validBody({ idempotencyKey: 'emp1-a' }), 'emp_001', 'employee').expect(201);
    await postCreate(validBody({ employeeId: 'emp_002', idempotencyKey: 'emp2-a' }), 'emp_002', 'employee').expect(201);

    const response = await request(app.getHttpServer())
      .get('/time-off-requests')
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].employeeId).toBe('emp_001');
    expect(response.body[0].history).toBeUndefined();
  });

  it('manager lists all requests', async () => {
    await seedRequest({ employeeId: 'emp_001' });
    await seedRequest({ employeeId: 'emp_002' });

    const response = await request(app.getHttpServer())
      .get('/time-off-requests')
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(response.body).toHaveLength(2);
  });

  it('manager filters by employeeId', async () => {
    await seedRequest({ employeeId: 'emp_001' });
    await seedRequest({ employeeId: 'emp_002' });

    const response = await request(app.getHttpServer())
      .get('/time-off-requests?employeeId=emp_002')
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].employeeId).toBe('emp_002');
  });

  it('manager filters by status', async () => {
    await seedRequest({ employeeId: 'emp_001', status: 'PENDING_MANAGER_APPROVAL' });
    await seedRequest({ employeeId: 'emp_002', status: 'REJECTED' });

    const response = await request(app.getHttpServer())
      .get('/time-off-requests?status=REJECTED')
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].status).toBe('REJECTED');
  });

  it('employee cannot list another employeeId', async () => {
    const response = await request(app.getHttpServer())
      .get('/time-off-requests?employeeId=emp_002')
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('missing auth returns FORBIDDEN for list', async () => {
    const response = await request(app.getHttpServer())
      .get('/time-off-requests')
      .expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('manager rejects pending request', async () => {
    await seedLocalAndHcm();
    const created = await postCreate(validBody()).expect(201);

    const response = await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/reject`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .send({ reason: 'Coverage gap' })
      .expect(200);

    expect(response.body.status).toBe('REJECTED');
  });

  it('rejected request has history row', async () => {
    await seedLocalAndHcm();
    const created = await postCreate(validBody()).expect(201);

    await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/reject`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .send({ reason: 'Coverage gap' })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/time-off-requests/${created.body.id}`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(response.body.history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromStatus: 'PENDING_MANAGER_APPROVAL',
        toStatus: 'REJECTED',
        actorId: 'mgr_001',
        actorRole: 'manager',
        reason: 'Coverage gap',
      }),
    ]));
  });

  it('employee cannot reject', async () => {
    await seedLocalAndHcm();
    const created = await postCreate(validBody()).expect(201);

    const response = await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/reject`)
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .send({})
      .expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('completed request cannot be rejected', async () => {
    await seedLocalAndHcm();
    const created = await postCreate(validBody()).expect(201);

    await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    const response = await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/reject`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .send({})
      .expect(409);

    expect(response.body.error.code).toBe(ErrorCodes.INVALID_STATUS_TRANSITION);
  });

  it('manager approves pending request', async () => {
    await seedLocalAndHcm();
    const created = await postCreate(validBody()).expect(201);

    const response = await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(response.body.status).toBe('COMPLETED');
  });

  it('approval deducts HCM balance', async () => {
    await seedLocalAndHcm('emp_001', 'loc_001', 10, 10);
    const created = await postCreate(validBody({ amountDays: 2 })).expect(201);

    await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    const hcmBalance = await request(app.getHttpServer())
      .get('/mock-hcm/balances/emp_001/loc_001')
      .expect(200);

    expect(hcmBalance.body.availableDays).toBe(8);
  });

  it('approval refreshes local balance', async () => {
    await seedLocalAndHcm('emp_001', 'loc_001', 10, 10);
    const created = await postCreate(validBody({ amountDays: 2 })).expect(201);

    await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    const localBalance = await request(app.getHttpServer())
      .get('/balances/emp_001/loc_001')
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(localBalance.body.availableDays).toBe(8);
    expect(localBalance.body.source).toBe('HCM_REALTIME');
  });

  it('completed request has hcmSubmissionId', async () => {
    await seedLocalAndHcm();
    const created = await postCreate(validBody()).expect(201);

    const response = await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(response.body.hcmSubmissionId).toBeDefined();
  });

  it('employee cannot approve', async () => {
    await seedLocalAndHcm();
    const created = await postCreate(validBody()).expect(201);

    const response = await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('approving already completed request returns INVALID_STATUS_TRANSITION and does not double deduct', async () => {
    await seedLocalAndHcm('emp_001', 'loc_001', 10, 10);
    const created = await postCreate(validBody({ amountDays: 2 })).expect(201);

    await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    const second = await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(409);

    expect(second.body.error.code).toBe(ErrorCodes.INVALID_STATUS_TRANSITION);

    const hcmBalance = await request(app.getHttpServer())
      .get('/mock-hcm/balances/emp_001/loc_001')
      .expect(200);
    expect(hcmBalance.body.availableDays).toBe(8);
  });

  it('approving rejected request returns INVALID_STATUS_TRANSITION', async () => {
    await seedLocalAndHcm();
    const created = await postCreate(validBody()).expect(201);

    await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/reject`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .send({})
      .expect(200);

    const response = await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(409);

    expect(response.body.error.code).toBe(ErrorCodes.INVALID_STATUS_TRANSITION);
  });

  it('HCM unavailable during approval returns HCM_UNAVAILABLE and request remains pending', async () => {
    await seedLocalAndHcm();
    const created = await postCreate(validBody()).expect(201);
    mockHcmService.setUnavailable(true);

    const response = await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(503);

    expect(response.body.error.code).toBe(ErrorCodes.HCM_UNAVAILABLE);

    const requestState = await request(app.getHttpServer())
      .get(`/time-off-requests/${created.body.id}`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);
    expect(requestState.body.status).toBe('PENDING_MANAGER_APPROVAL');
  });

  it('HCM balance changed lower before approval returns INSUFFICIENT_HCM_BALANCE and marks request FAILED_HCM_VALIDATION', async () => {
    await seedLocalAndHcm('emp_001', 'loc_001', 10, 10);
    const created = await postCreate(validBody({ amountDays: 2 })).expect(201);
    await mockHcmService.seedBalance('emp_001', 'loc_001', 1);

    const response = await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(400);

    expect(response.body.error.code).toBe(ErrorCodes.INSUFFICIENT_HCM_BALANCE);

    const requestState = await request(app.getHttpServer())
      .get(`/time-off-requests/${created.body.id}`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);
    expect(requestState.body.status).toBe('FAILED_HCM_VALIDATION');
  });
});
