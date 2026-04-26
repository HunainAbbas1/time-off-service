# Wizdaa / ExampleHR Time-Off Microservice

A JavaScript-only NestJS microservice for managing employee time-off balances, HCM balance synchronization, and manager approval workflows.

This project was built for the ExampleHR/Wizdaa time-off microservice assessment. It models a local time-off service that treats HCM as the source of truth while keeping a defensive local balance cache and a complete request lifecycle with audit history.

## Deliverables

- [TRD.md](./TRD.md) — Technical Requirements Document
- [README.md](./README.md) — Setup, architecture, API usage
- [TEST_STRATEGY.md](./TEST_STRATEGY.md) — Test plan, coverage, and regression strategy
- `src/` — NestJS JavaScript implementation
- `test/` — E2E tests
- `*.spec.js` — Unit tests beside source modules

## Tech Stack

- JavaScript, CommonJS modules
- Node.js 18+ recommended
- NestJS
- SQLite
- TypeORM with `EntitySchema`
- Jest
- Supertest

No TypeScript application files, DTO decorators, `class-validator`, `class-transformer`, or `ValidationPipe` are used.

## JavaScript Decorator Strategy

NestJS examples commonly use TypeScript decorator syntax such as `@Controller()` and constructor parameter decorators. This project must remain JavaScript-only, and the Nest CLI build path rejects JavaScript parameter decorators.

To keep the build stable, all Nest decorators are applied manually/programmatically after class declarations:

```js
class ExampleController {
  constructor(exampleService) {
    this.exampleService = exampleService;
  }
}

Controller('examples')(ExampleController);
Inject(ExampleService)(ExampleController, undefined, 0);
```

This preserves NestJS module/controller/service behavior while keeping `npm run build` reliable in a pure JavaScript codebase.

## Architecture Overview

### Common Layer

Shared infrastructure:

- Error code constants in `src/common/errors/error-codes.js`
- Plain JavaScript validation helpers in `src/common/validators/validate.js`
- Global HTTP exception filter for consistent error responses
- Header-based current-user helper and role guard support

All structured errors follow:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Readable message"
  }
}
```

### Mock HCM Module

Simulates the external HCM system.

Responsibilities:

- Stores HCM-side balances in `mock_hcm_balances`
- Returns HCM balances
- Simulates HCM unavailability
- Atomically checks and deducts balance during HCM time-off submission

Endpoints:

- `GET /mock-hcm/balances/:employeeId/:locationId`
- `POST /mock-hcm/time-off`

### HCM Integration Module

Acts as the integration boundary between the time-off service and HCM.

For this take-home, `HcmService` delegates to `MockHcmService` through Nest dependency injection. In production, this boundary would be replaced with an HTTP adapter to a real HCM service.

### Balance Module

Maintains the local balance cache.

Responsibilities:

- Read local cached balances
- Refresh local cache from HCM
- Upsert balances from batch sync or real-time HCM checks

The local balance cache is defensive. HCM remains the source of truth.

### Sync Module

Implements batch balance synchronization from HCM/system input.

Endpoint:

- `POST /hcm/batch-balances`

The sync module validates each record, upserts valid local balances with source `HCM_BATCH`, skips invalid records, and records an `hcm_sync_runs` row for observability.

### Time-Off Requests Module

Implements request creation, listing, retrieval, approval, rejection, history, idempotency, HCM validation, and effective availability checks.

Responsibilities:

- Employee request creation
- Manager request approval/rejection
- Request status transitions
- HCM balance validation
- HCM submission on approval
- Local balance refresh after HCM deduction
- Audit history for lifecycle changes

## HCM Source Of Truth

HCM is treated as the authoritative source for current balances. The local service uses HCM in two ways:

- Real-time validation when creating or approving time-off requests
- Batch synchronization into a local cache

The local cache is used to fail fast when it clearly shows insufficient balance, but HCM is always checked before creating or approving a request.

## Local Balance Cache

The `balances` table stores a local cached balance per employee/location pair.

Balance source values:

- `HCM_BATCH`
- `HCM_REALTIME`
- `LOCAL_ESTIMATE`

The cache is updated through:

- `POST /hcm/batch-balances`
- `POST /balances/:employeeId/:locationId/refresh`
- request creation when local cache is missing but HCM is valid
- request approval after HCM deduction

## Effective Availability / Pending Deduction

HCM balance is only deducted when a manager approves a request and the service submits it to HCM. That means pending requests can otherwise over-commit a balance.

This service prevents over-commitment during creation with:

```text
effectiveAvailableDays =
  latestHcmAvailableDays
  - SUM(amountDays) for pending requests
    with the same employeeId and locationId
```

Only `PENDING_MANAGER_APPROVAL` requests count against effective availability.

Excluded statuses:

- `REJECTED`
- `COMPLETED`
- `FAILED_HCM_VALIDATION`
- `FAILED_HCM_SUBMISSION`
- `CANCELLED`

## Request Lifecycle

1. Employee creates a time-off request.
2. Service validates the payload and authorization.
3. Service checks idempotency by `(employeeId, idempotencyKey)`.
4. Service checks local cached balance if present.
5. Service checks real-time HCM balance.
6. Service applies effective availability / pending deduction logic.
7. Request is saved as `PENDING_MANAGER_APPROVAL`.
8. History row is written.
9. Manager may reject:
   - status becomes `REJECTED`
   - history row is written
   - HCM balance is not affected
10. Manager may approve:
   - HCM balance is rechecked
   - request is submitted to HCM
   - HCM deducts balance
   - request becomes `COMPLETED`
   - `hcmSubmissionId` is stored
   - history row is written
   - local balance is refreshed from HCM

Failure states:

- `FAILED_HCM_VALIDATION`: HCM balance is insufficient at approval time
- `FAILED_HCM_SUBMISSION`: HCM submission fails after validation

## API Endpoints

### Health

```text
GET /health
```

### Mock HCM

```text
GET  /mock-hcm/balances/:employeeId/:locationId
POST /mock-hcm/time-off
```

### Balances

```text
GET  /balances/:employeeId/:locationId
POST /balances/:employeeId/:locationId/refresh
```

Authorization:

- employee can access only their own `employeeId`
- manager can access any employee

### Batch Sync

```text
POST /hcm/batch-balances
```

Open/system-level endpoint for this take-home.

### Time-Off Requests

```text
POST  /time-off-requests
GET   /time-off-requests
GET   /time-off-requests/:id
PATCH /time-off-requests/:id/approve
PATCH /time-off-requests/:id/reject
```

Authorization:

- employee can create and view only their own requests
- manager can view, approve, and reject any request
- manager cannot create employee requests in this implementation

## Auth Simulation

Authentication/authorization is simulated with headers:

```text
x-user-id: emp_001
x-user-role: employee
```

or:

```text
x-user-id: mgr_001
x-user-role: manager
```

Missing or invalid headers return `FORBIDDEN`.

## Setup

Recommended runtime:

```text
Node.js 18+
```

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Start built app:

```bash
npm run start
```

Start in watch mode:

```bash
npm run start:dev
```

Default URL:

```text
http://localhost:3000
```

The app listens on port `3000` by default.

The app uses SQLite and creates `timeoff.sqlite` by default. You can override the database path:

```bash
DB_PATH=custom.sqlite npm run start
```

On Windows PowerShell:

```powershell
$env:DB_PATH = "custom.sqlite"
npm run start
```

## Tests

Unit tests:

```bash
npm test
```

E2E tests:

```bash
npm run test:e2e
```

Coverage:

```bash
npm run test:cov
```

## Verified Test Results

- `npm test`: 93 unit tests passing
- `npm run test:e2e`: 58 e2e tests in the suite, including regression coverage
- `npm run build`: passing
- `npm run test:cov`: passing

Coverage summary:

```text
Overall coverage includes NestJS bootstrap/configuration files, which are intentionally lighter on unit tests.
Core business services: Mock HCM 100%, Balances 94.44%, Sync 83.33%, Time-Off Requests 96.59%.
```

## Example Requests

### Health

```bash
curl http://localhost:3000/health
```

### Batch Sync Balances

```bash
curl -X POST http://localhost:3000/hcm/batch-balances \
  -H "Content-Type: application/json" \
  -d '{
    "balances": [
      { "employeeId": "emp_001", "locationId": "loc_001", "availableDays": 10 },
      { "employeeId": "emp_002", "locationId": "loc_001", "availableDays": 8 }
    ]
  }'
```

### Get Balance As Manager

```bash
curl http://localhost:3000/balances/emp_001/loc_001 \
  -H "x-user-id: mgr_001" \
  -H "x-user-role: manager"
```

### Create Time-Off Request

```bash
curl -X POST http://localhost:3000/time-off-requests \
  -H "Content-Type: application/json" \
  -H "x-user-id: emp_001" \
  -H "x-user-role: employee" \
  -d '{
    "employeeId": "emp_001",
    "locationId": "loc_001",
    "amountDays": 2,
    "startDate": "2026-05-01",
    "endDate": "2026-05-02",
    "reason": "Family trip",
    "idempotencyKey": "optional-key"
  }'
```

### List Requests As Manager

```bash
curl "http://localhost:3000/time-off-requests?status=PENDING_MANAGER_APPROVAL" \
  -H "x-user-id: mgr_001" \
  -H "x-user-role: manager"
```

### Approve Request

```bash
curl -X PATCH http://localhost:3000/time-off-requests/<request-id>/approve \
  -H "x-user-id: mgr_001" \
  -H "x-user-role: manager"
```

### Reject Request

```bash
curl -X PATCH http://localhost:3000/time-off-requests/<request-id>/reject \
  -H "Content-Type: application/json" \
  -H "x-user-id: mgr_001" \
  -H "x-user-role: manager" \
  -d '{ "reason": "Coverage gap" }'
```

## Design Decisions

- HCM is the source of truth for balances.
- The local balance cache is used defensively and refreshed from HCM.
- The service fails closed on HCM unavailability.
- Idempotency is handled in service logic by `(employeeId, idempotencyKey)`.
- Validation uses plain JavaScript helper functions.
- TypeORM `EntitySchema` avoids TypeScript/decorator entity definitions.
- HCM adapter uses DI to `MockHcmService` for the take-home; a real deployment would swap this boundary for HTTP.
- Effective availability prevents pending requests from over-committing HCM balance.

## Known Limitations / Production Hardening

- Add DB transactions around request status updates and history writes in production.
- Real HCM integration should use an HTTP client adapter instead of `MockHcmService` DI.
- Real auth should use JWT, OAuth, or another production identity mechanism instead of headers.
- SQLite should be replaced with Postgres/MySQL for production.
- TypeORM `synchronize: true` should be replaced with migrations.
- Add structured logging, metrics, tracing, and alerting.
- Add request pagination for large request lists.
