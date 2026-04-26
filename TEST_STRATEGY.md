# Test Strategy And Regression Report

## How To Run

```bash
npm test
npm run test:e2e
npm run test:cov
npm run build
```

## Current Verified Results

- Unit tests: 93 service-level test cases.
- E2E tests: 58 endpoint/regression test cases.
- Build: passing.
- Coverage: passing.

Coverage summary:

```text
Overall coverage includes NestJS bootstrap/configuration files, which are intentionally lighter on unit tests.
Core business services: Mock HCM 100%, Balances 94.44%, Sync 83.33%, Time-Off Requests 96.59%.
```

## Unit Test Coverage By Module

### Mock HCM

File:

- `src/mock-hcm/mock-hcm.service.spec.js`

Coverage:

- balance lookup
- invalid dimensions
- HCM unavailable mode
- successful time-off submission
- insufficient balance does not deduct
- HCM-side balance deduction

### Balance Service

File:

- `src/balances/balances.service.spec.js`

Coverage:

- local balance lookup
- missing local balance
- create balance
- update balance
- validation of negative balances
- validation of invalid source values
- real-time refresh from HCM
- HCM errors do not overwrite local cache

### Sync Service

File:

- `src/sync/sync.service.spec.js`

Coverage:

- valid batch creates balances
- valid batch updates balances
- invalid records are skipped
- mixed valid/invalid records return `PARTIAL_SUCCESS`
- empty or missing payload returns `VALIDATION_ERROR`
- all invalid records return `FAILED`
- sync run rows are saved for success, partial success, and failed attempts

### Time-Off Requests Service

File:

- `src/time-off-requests/time-off-requests.service.spec.js`

Coverage:

- request creation validation
- authorization
- local balance rejection
- HCM validation
- idempotency
- history writing
- effective availability
- find/list behavior
- manager approval
- manager rejection
- invalid transitions
- HCM unavailable behavior
- HCM submission failure behavior

## E2E Test Coverage

### Balance Endpoints

File:

- `test/balances.e2e-spec.js`

Coverage:

- manager balance access
- employee own-balance access
- employee cross-employee denial
- missing auth
- missing balance
- refresh from HCM
- invalid HCM dimensions
- HCM unavailable

### Batch Sync Endpoint

File:

- `test/hcm-sync.e2e-spec.js`

Coverage:

- batch creates balances
- batch updates balances
- mixed valid/invalid records
- empty payload validation
- missing payload validation
- all invalid records
- response counts and `syncRunId`
- post-sync balance lookup
- no employee/manager auth required

### Time-Off Creation, Get/List, Approve/Reject

File:

- `test/time-off-requests.e2e-spec.js`

Coverage:

- employee creates request
- employee cannot create for another employee
- manager cannot create employee request
- missing auth
- insufficient local balance
- missing local balance with valid HCM upserts local cache
- insufficient HCM balance
- invalid HCM dimensions
- idempotency key retry
- get by id with history
- manager get/list/filter
- employee own list only
- manager rejection
- rejection history
- manager approval
- approval HCM deduction
- local balance refresh after approval
- completed request includes `hcmSubmissionId`
- employee cannot approve/reject
- completed/rejected invalid transitions
- HCM unavailable during approval keeps request pending
- HCM balance changed lower before approval marks `FAILED_HCM_VALIDATION`

### Effective Availability

File:

- `test/effective-availability.e2e-spec.js`

Coverage:

- pending request over-commitment is blocked
- rejected request does not block new request
- completed request does not double-subtract
- pending request in another location does not block
- pending request for another employee does not block

### Regression Tests

File:

- `test/regression.e2e-spec.js`

Coverage:

- rejected request does not deduct HCM balance
- batch sync does not delete or alter request history

## Specific Requirement Mapping

- HCM invalid dimensions: unit tests and `test/time-off-requests.e2e-spec.js`
- HCM unavailable: unit tests and balance/time-off e2e tests
- insufficient HCM balance: unit tests and time-off e2e tests
- insufficient local balance: unit tests and time-off e2e tests
- effective availability over-commitment: unit tests and `test/effective-availability.e2e-spec.js`
- rejected/completed request not counted as pending: unit tests and effective availability e2e tests
- idempotency key retry: unit tests and time-off e2e tests
- approval deducts HCM once: time-off e2e double-approval test
- double approval blocked: time-off e2e test
- rejected request cannot be approved: time-off e2e test
- failed validation status: time-off e2e test
- batch sync partial success: sync unit tests and hcm-sync e2e tests
- authorization failures: balance and time-off e2e tests
- batch sync/refresh does not alter request history: regression e2e test
- rejected request does not affect HCM balance: regression e2e test

## Mock HCM Behavior

The mock HCM is intentionally stateful so the ExampleHR service can be tested against source-of-truth behavior.

Covered behavior:

- balance lookup by employee/location
- invalid dimensions when no HCM balance exists
- unavailable mode with `HCM_UNAVAILABLE`
- submission check-and-deduct
- insufficient balance rejection without deduction

## Race / Concurrency Regression Strategy

The test suite covers the main race-prone business cases:

1. Approving the same request twice does not double-deduct HCM balance.
   - Covered in `test/time-off-requests.e2e-spec.js`.
2. Completed request cannot be approved again.
   - Covered in `test/time-off-requests.e2e-spec.js`.
3. HCM balance changed lower before approval marks `FAILED_HCM_VALIDATION`.
   - Covered in `test/time-off-requests.e2e-spec.js`.
4. Pending 9-day request with HCM=10 blocks a new 2-day request.
   - Covered in `test/effective-availability.e2e-spec.js`.
5. Batch sync does not delete or alter request history.
   - Covered in `test/regression.e2e-spec.js`.
6. Rejected request does not affect HCM balance.
   - Covered in `test/regression.e2e-spec.js`.

Production should add true concurrent request tests once database row locks or optimistic locking are introduced.
