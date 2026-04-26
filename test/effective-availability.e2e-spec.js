const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { HttpExceptionFilter } = require('../src/common/filters/http-exception.filter');
const { BalancesService } = require('../src/balances/balances.service');
const { MockHcmService } = require('../src/mock-hcm/mock-hcm.service');
const { ErrorCodes } = require('../src/common/errors/error-codes');

const dbPath = path.join(__dirname, 'effective-availability.e2e.sqlite');
process.env.DB_PATH = dbPath;
const { AppModule } = require('../src/app.module');

describe('Effective availability (e2e)', () => {
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

  function body(overrides = {}) {
    return {
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 2,
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      ...overrides,
    };
  }

  function createRequest(payload = body(), userId = payload.employeeId) {
    return request(app.getHttpServer())
      .post('/time-off-requests')
      .set('x-user-id', userId)
      .set('x-user-role', 'employee')
      .send(payload);
  }

  async function seedBalance(employeeId, locationId, days) {
    await balancesService.upsertBalance(employeeId, locationId, days, 'LOCAL_ESTIMATE');
    await mockHcmService.seedBalance(employeeId, locationId, days);
  }

  async function seedRequest(overrides) {
    return requestRepository.save({
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 2,
      startDate: '2026-04-01',
      endDate: '2026-04-02',
      status: 'PENDING_MANAGER_APPROVAL',
      hcmSubmissionId: null,
      idempotencyKey: null,
      ...overrides,
    });
  }

  it('effective availability blocks over-commitment', async () => {
    await seedBalance('emp_001', 'loc_001', 10);
    await seedRequest({ amountDays: 9 });

    const response = await createRequest(body({ amountDays: 2 })).expect(400);

    expect(response.body.error.code).toBe(ErrorCodes.INSUFFICIENT_EFFECTIVE_BALANCE);
  });

  it('rejected request does not block new request', async () => {
    await seedBalance('emp_001', 'loc_001', 10);
    await seedRequest({ amountDays: 9, status: 'REJECTED' });

    const response = await createRequest(body({ amountDays: 2 })).expect(201);

    expect(response.body.status).toBe('PENDING_MANAGER_APPROVAL');
  });

  it('completed request does not double-subtract', async () => {
    await seedBalance('emp_001', 'loc_001', 8);
    await seedRequest({ amountDays: 2, status: 'COMPLETED' });

    const response = await createRequest(body({ amountDays: 8 })).expect(201);

    expect(response.body.amountDays).toBe(8);
  });

  it('pending request in another location does not block', async () => {
    await seedBalance('emp_001', 'loc_001', 10);
    await seedRequest({ locationId: 'loc_002', amountDays: 9 });

    const response = await createRequest(body({ amountDays: 2 })).expect(201);

    expect(response.body.status).toBe('PENDING_MANAGER_APPROVAL');
  });

  it('pending request for another employee does not block', async () => {
    await seedBalance('emp_001', 'loc_001', 10);
    await seedRequest({ employeeId: 'emp_002', amountDays: 9 });

    const response = await createRequest(body({ amountDays: 2 })).expect(201);

    expect(response.body.status).toBe('PENDING_MANAGER_APPROVAL');
  });
});
