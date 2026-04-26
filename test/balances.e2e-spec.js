const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { HttpExceptionFilter } = require('../src/common/filters/http-exception.filter');
const { BalancesService } = require('../src/balances/balances.service');
const { MockHcmService } = require('../src/mock-hcm/mock-hcm.service');
const { ErrorCodes } = require('../src/common/errors/error-codes');

const dbPath = path.join(__dirname, 'balances.e2e.sqlite');
process.env.DB_PATH = dbPath;
const { AppModule } = require('../src/app.module');

describe('BalancesController (e2e)', () => {
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

  async function seedLocalBalance(employeeId = 'emp_001', locationId = 'loc_001', availableDays = 10) {
    return balancesService.upsertBalance(employeeId, locationId, availableDays, 'LOCAL_ESTIMATE');
  }

  it('manager can get any local balance', async () => {
    await seedLocalBalance('emp_001', 'loc_001', 10);

    const response = await request(app.getHttpServer())
      .get('/balances/emp_001/loc_001')
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      employeeId: 'emp_001',
      locationId: 'loc_001',
      availableDays: 10,
      source: 'LOCAL_ESTIMATE',
    }));
  });

  it('employee can get own local balance', async () => {
    await seedLocalBalance('emp_001', 'loc_001', 7);

    const response = await request(app.getHttpServer())
      .get('/balances/emp_001/loc_001')
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .expect(200);

    expect(response.body.availableDays).toBe(7);
  });

  it('employee cannot get another employee balance', async () => {
    await seedLocalBalance('emp_002', 'loc_001', 7);

    const response = await request(app.getHttpServer())
      .get('/balances/emp_002/loc_001')
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('manager can refresh any balance', async () => {
    await mockHcmService.seedBalance('emp_001', 'loc_001', 12);

    const response = await request(app.getHttpServer())
      .post('/balances/emp_001/loc_001/refresh')
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(201);

    expect(response.body).toEqual(expect.objectContaining({
      employeeId: 'emp_001',
      locationId: 'loc_001',
      availableDays: 12,
      source: 'HCM_REALTIME',
    }));
  });

  it('employee can refresh own balance', async () => {
    await mockHcmService.seedBalance('emp_001', 'loc_001', 6);

    const response = await request(app.getHttpServer())
      .post('/balances/emp_001/loc_001/refresh')
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .expect(201);

    expect(response.body.availableDays).toBe(6);
  });

  it('employee cannot refresh another employee balance', async () => {
    await mockHcmService.seedBalance('emp_002', 'loc_001', 6);

    const response = await request(app.getHttpServer())
      .post('/balances/emp_002/loc_001/refresh')
      .set('x-user-id', 'emp_001')
      .set('x-user-role', 'employee')
      .expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('missing auth headers return FORBIDDEN', async () => {
    await seedLocalBalance('emp_001', 'loc_001', 10);

    const response = await request(app.getHttpServer())
      .get('/balances/emp_001/loc_001')
      .expect(403);

    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('missing balance returns BALANCE_NOT_FOUND', async () => {
    const response = await request(app.getHttpServer())
      .get('/balances/emp_001/loc_001')
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(404);

    expect(response.body.error.code).toBe(ErrorCodes.BALANCE_NOT_FOUND);
  });

  it('refresh invalid HCM dimensions returns INVALID_DIMENSIONS', async () => {
    const response = await request(app.getHttpServer())
      .post('/balances/emp_missing/loc_missing/refresh')
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(400);

    expect(response.body.error.code).toBe(ErrorCodes.INVALID_DIMENSIONS);
  });

  it('refresh HCM unavailable returns HCM_UNAVAILABLE', async () => {
    await mockHcmService.seedBalance('emp_001', 'loc_001', 10);
    mockHcmService.setUnavailable(true);

    const response = await request(app.getHttpServer())
      .post('/balances/emp_001/loc_001/refresh')
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager')
      .expect(503);

    expect(response.body.error.code).toBe(ErrorCodes.HCM_UNAVAILABLE);
  });
});
