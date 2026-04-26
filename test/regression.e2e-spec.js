const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { HttpExceptionFilter } = require('../src/common/filters/http-exception.filter');
const { BalancesService } = require('../src/balances/balances.service');
const { MockHcmService } = require('../src/mock-hcm/mock-hcm.service');

const dbPath = path.join(__dirname, 'regression.e2e.sqlite');
process.env.DB_PATH = dbPath;
const { AppModule } = require('../src/app.module');

describe('Regression scenarios (e2e)', () => {
  let app;
  let balancesService;
  let mockHcmService;

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

  async function seedLocalAndHcm(employeeId = 'emp_001', locationId = 'loc_001', days = 10) {
    await balancesService.upsertBalance(employeeId, locationId, days, 'LOCAL_ESTIMATE');
    await mockHcmService.seedBalance(employeeId, locationId, days);
  }

  function createBody(overrides = {}) {
    return {
      employeeId: 'emp_001',
      locationId: 'loc_001',
      amountDays: 2,
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      reason: 'Regression coverage',
      ...overrides,
    };
  }

  async function createRequest(body = createBody()) {
    return request(app.getHttpServer())
      .post('/time-off-requests')
      .set('x-user-id', body.employeeId)
      .set('x-user-role', 'employee')
      .send(body)
      .expect(201);
  }

  it('rejected request does not deduct HCM balance', async () => {
    await seedLocalAndHcm('emp_001', 'loc_001', 10);
    const created = await createRequest(createBody({ amountDays: 2 }));

    await request(app.getHttpServer())
      .patch(`/time-off-requests/${created.body.id}/reject`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .send({ reason: 'Coverage gap' })
      .expect(200);

    const hcmBalance = await request(app.getHttpServer())
      .get('/mock-hcm/balances/emp_001/loc_001')
      .expect(200);

    expect(hcmBalance.body.availableDays).toBe(10);
  });

  it('batch sync does not alter request history', async () => {
    await seedLocalAndHcm('emp_001', 'loc_001', 10);
    const created = await createRequest(createBody({ amountDays: 2 }));

    const before = await request(app.getHttpServer())
      .get(`/time-off-requests/${created.body.id}`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({
        balances: [
          { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 7 },
        ],
      })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get(`/time-off-requests/${created.body.id}`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(after.body.history).toEqual(before.body.history);
  });
});
