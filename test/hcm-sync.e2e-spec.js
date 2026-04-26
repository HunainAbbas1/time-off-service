const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { HttpExceptionFilter } = require('../src/common/filters/http-exception.filter');
const { ErrorCodes } = require('../src/common/errors/error-codes');

const dbPath = path.join(__dirname, 'hcm-sync.e2e.sqlite');
process.env.DB_PATH = dbPath;
const { AppModule } = require('../src/app.module');

describe('SyncController (e2e)', () => {
  let app;

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

  function getBalance(employeeId, locationId) {
    return request(app.getHttpServer())
      .get(`/balances/${employeeId}/${locationId}`)
      .set('x-user-id', 'mgr_001')
      .set('x-user-role', 'manager');
  }

  it('batch creates balances', async () => {
    const response = await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({
        balances: [
          { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 10 },
        ],
      })
      .expect(201);

    expect(response.body).toEqual(expect.objectContaining({
      status: 'SUCCESS',
      recordsReceived: 1,
      recordsProcessed: 1,
      recordsFailed: 0,
      errors: [],
    }));
    expect(response.body.syncRunId).toBeDefined();
  });

  it('batch updates existing balances', async () => {
    await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({
        balances: [
          { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 10 },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({
        balances: [
          { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 14 },
        ],
      })
      .expect(201);

    const balance = await getBalance('emp_001', 'loc_001').expect(200);
    expect(balance.body.availableDays).toBe(14);
    expect(balance.body.source).toBe('HCM_BATCH');
  });

  it('negative availableDays produces PARTIAL_SUCCESS when mixed with valid record', async () => {
    const response = await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({
        balances: [
          { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 10 },
          { employeeId: 'emp_002', locationId: 'loc_001', availableDays: -2 },
        ],
      })
      .expect(201);

    expect(response.body.status).toBe('PARTIAL_SUCCESS');
    expect(response.body.recordsProcessed).toBe(1);
    expect(response.body.recordsFailed).toBe(1);
    expect(response.body.errors).toEqual([
      { index: 1, message: 'availableDays must be greater than or equal to 0' },
    ]);

    await getBalance('emp_001', 'loc_001').expect(200);
    await getBalance('emp_002', 'loc_001').expect(404);
  });

  it('empty array returns 400 VALIDATION_ERROR', async () => {
    const response = await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({ balances: [] })
      .expect(400);

    expect(response.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('missing balances returns 400 VALIDATION_ERROR', async () => {
    const response = await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({})
      .expect(400);

    expect(response.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('all invalid records returns FAILED', async () => {
    const response = await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({
        balances: [
          { employeeId: '', locationId: 'loc_001', availableDays: 10 },
          { employeeId: 'emp_002', locationId: 'loc_001', availableDays: -1 },
        ],
      })
      .expect(201);

    expect(response.body.status).toBe('FAILED');
    expect(response.body.recordsReceived).toBe(2);
    expect(response.body.recordsProcessed).toBe(0);
    expect(response.body.recordsFailed).toBe(2);
  });

  it('response includes syncRunId and correct counts', async () => {
    const response = await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({
        balances: [
          { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 10 },
          { employeeId: 'emp_002', locationId: 'loc_001', availableDays: 8 },
        ],
      })
      .expect(201);

    expect(response.body.syncRunId).toBeDefined();
    expect(response.body.recordsReceived).toBe(2);
    expect(response.body.recordsProcessed).toBe(2);
    expect(response.body.recordsFailed).toBe(0);
  });

  it('after batch sync, GET balance returns the upserted value', async () => {
    await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({
        balances: [
          { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 11 },
        ],
      })
      .expect(201);

    const response = await getBalance('emp_001', 'loc_001').expect(200);
    expect(response.body).toEqual(expect.objectContaining({
      employeeId: 'emp_001',
      locationId: 'loc_001',
      availableDays: 11,
      source: 'HCM_BATCH',
    }));
  });

  it('endpoint does not require employee or manager auth headers', async () => {
    const response = await request(app.getHttpServer())
      .post('/hcm/batch-balances')
      .send({
        balances: [
          { employeeId: 'emp_001', locationId: 'loc_001', availableDays: 9 },
        ],
      })
      .expect(201);

    expect(response.body.status).toBe('SUCCESS');
  });
});
