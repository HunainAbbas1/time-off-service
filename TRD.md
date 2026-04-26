# Technical Requirements Document: ExampleHR / Wizdaa Time-Off Microservice

## 1. Product Context

ExampleHR needs a time-off module for employees whose leave balances are owned by an external HCM system such as ReadyOn, Workday, SAP SuccessFactors, or a similar HR platform. HCM is the source of truth for employment data and balances. ExampleHR provides the operational workflow where employees request time off and managers approve or reject those requests.

Balances are scoped per employee and per location. This matters because employees can accrue or consume time-off balances differently across locations, employment groups, or policy regions.

## 2. Problem Statement

ExampleHR must make request decisions without relying on stale local data. HCM balances can change independently through work anniversaries, annual refreshes, manual HR corrections, policy changes, payouts, or adjustments entered directly in the HCM.

The service must synchronize balances from HCM, validate requests against HCM in real time, and prevent over-commitment when multiple pending requests exist locally before manager approval.

## 3. Goals

- Create and manage employee time-off requests.
- Maintain a defensive local balance cache.
- Validate request creation and approval against HCM.
- Support batch balance synchronization from HCM.
- Support manager approval and rejection.
- Preserve request status history for auditability.
- Provide structured, defensive error handling.
- Keep the implementation buildable and runnable as JavaScript-only NestJS.

## 4. Non-Goals

- Real Workday, SAP, ReadyOn, or other HCM HTTP integration.
- Real JWT/OAuth authentication.
- Production-grade database deployment.
- Frontend UI.
- Payroll export, accrual policy calculation, or calendar scheduling.

## 5. Architecture

### Common Layer

Shared cross-cutting code:

- `src/common/errors/error-codes.js`
- `src/common/validators/validate.js`
- `src/common/filters/http-exception.filter.js`
- lightweight auth/role helpers

The common layer keeps validation and error response shapes consistent without TypeScript DTO decorators, `class-validator`, `class-transformer`, or `ValidationPipe`.

### Mock HCM Module

Simulates an external HCM.

Responsibilities:

- Store HCM-side balances.
- Return balances by employee/location.
- Simulate HCM unavailability.
- Submit approved time-off and deduct balance.
- Reject invalid dimensions and insufficient balances.

### HCM Integration Module

`HcmService` is the boundary between ExampleHR and HCM. For this assessment, it delegates to `MockHcmService` through dependency injection. In production, this would become an HTTP adapter with retries, timeouts, authentication, idempotency, and observability.

### Balance Module

Maintains the local cached balance table.

Responsibilities:

- Read local balances.
- Upsert balances from batch sync or real-time HCM checks.
- Refresh a local balance from HCM.
- Enforce valid balance source values.

### Sync Module

Processes HCM batch balance syncs through `POST /hcm/batch-balances`.

Responsibilities:

- Validate batch payloads.
- Persist valid records.
- Skip invalid records.
- Record sync run status and counts.
- Return per-record validation errors.

### Time-Off Requests Module

Owns the employee request lifecycle.

Responsibilities:

- Create requests.
- Enforce authorization.
- Enforce idempotency.
- Calculate effective availability.
- List and retrieve requests.
- Approve and reject requests.
- Submit approved requests to HCM.
- Write audit history.

## 6. Data Model

The project uses TypeORM `EntitySchema` to avoid decorator-based TypeScript entities.

### `balances`

Local balance cache keyed by employee/location.

Key fields:

- `employeeId`
- `locationId`
- `availableDays`
- `source`
- `lastSyncedAt`

Source values:

- `HCM_BATCH`
- `HCM_REALTIME`
- `LOCAL_ESTIMATE`

### `mock_hcm_balances`

Simulated HCM balance store.

Key fields:

- `employeeId`
- `locationId`
- `availableDays`

### `hcm_sync_runs`

Batch sync audit table.

Key fields:

- `status`
- `recordsReceived`
- `recordsProcessed`
- `recordsFailed`
- `errors`
- timestamps

### `time_off_requests`

Primary request table.

Key fields:

- `id`
- `employeeId`
- `locationId`
- `amountDays`
- `startDate`
- `endDate`
- `reason`
- `status`
- `hcmSubmissionId`
- `idempotencyKey`
- timestamps

### `time_off_request_history`

Audit history table.

Key fields:

- `requestId`
- `fromStatus`
- `toStatus`
- `actorId`
- `actorRole`
- `reason`
- `metadata`
- `createdAt`

### Employee Handling

The current implementation treats `employeeId` as an HCM-owned identifier instead of storing a full Employee table. This is intentional because HCM is the source of truth for employment data. The service only needs employee identity for request ownership, authorization simulation, and balance lookup. A production service could add a lightweight employee read model if ExampleHR needed local profile display, manager hierarchy, or policy assignment.

## 7. HCM Sync Strategy

The service combines real-time HCM validation with a local cache.

- Request creation performs a real-time balance check through HCM.
- Request approval performs a second real-time HCM validation before submission.
- Batch sync updates cached local balances through `POST /hcm/batch-balances`.
- Manual refresh updates a single local balance through `POST /balances/:employeeId/:locationId/refresh`.
- Work anniversary, annual refresh, HR correction, and policy refresh scenarios are handled through batch sync or targeted refresh.

The local cache records balance source as `HCM_BATCH`, `HCM_REALTIME`, or `LOCAL_ESTIMATE`.

## 8. Balance Integrity Strategy

The local cache is used as a fast defensive check. If the local cache shows insufficient balance, the request is rejected before unnecessary HCM work. If no local balance exists, the service continues to HCM validation.

HCM remains the source of truth. Creation and approval both validate against HCM.

Pending local requests are handled with effective availability:

```text
effectiveAvailableDays = latestHcmAvailableDays - pendingDaysForSameEmployeeAndLocation
```

Only requests in `PENDING_MANAGER_APPROVAL` count as pending deduction.

These statuses do not count:

- `COMPLETED`
- `REJECTED`
- `FAILED_HCM_VALIDATION`
- `FAILED_HCM_SUBMISSION`
- `CANCELLED`

This prevents pending local requests from over-committing HCM balance before final approval.

## 9. Concurrency And Race Conditions

Current protections:

- Mock HCM performs check-and-deduct on approval.
- Invalid status transitions prevent completed/rejected/failed requests from being approved again.
- Completed requests cannot be approved again, preventing double deduction.
- Effective availability prevents local pending over-commitment.
- Idempotency keys prevent duplicate request creation retries for the same employee.
- `externalRequestId` is sent to HCM submission to model a production idempotency boundary.

Production hardening:

- Wrap request status update and history write in a database transaction.
- Use row locks or optimistic locking on high-concurrency approval paths.
- Add database uniqueness for `(employeeId, idempotencyKey)` where the key is not null.
- Use an external HCM idempotency key for submission retries.
- Add retry/backoff for transient HCM errors while still failing closed where balances cannot be trusted.

## 10. Request Lifecycle / State Machine

### States

- `PENDING_MANAGER_APPROVAL`
- `REJECTED`
- `COMPLETED`
- `FAILED_HCM_VALIDATION`
- `FAILED_HCM_SUBMISSION`
- `CANCELLED` planned/recognized in service status constants, not exposed as a public endpoint in this implementation

### Transitions

Valid transitions:

- create request: `null -> PENDING_MANAGER_APPROVAL`
- manager reject: `PENDING_MANAGER_APPROVAL -> REJECTED`
- manager approve success: `PENDING_MANAGER_APPROVAL -> COMPLETED`
- manager approve with insufficient HCM balance: `PENDING_MANAGER_APPROVAL -> FAILED_HCM_VALIDATION`
- manager approve with HCM submission failure: `PENDING_MANAGER_APPROVAL -> FAILED_HCM_SUBMISSION`

Invalid transitions:

- approving completed, rejected, or failed requests
- rejecting completed, rejected, or failed requests
- employee approval or rejection
- manager creating an employee request in this phase

## 11. Error Handling

Errors use a consistent response shape:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Readable message"
  }
}
```

Supported domain codes include:

- `INVALID_DIMENSIONS`
- `INSUFFICIENT_LOCAL_BALANCE`
- `INSUFFICIENT_HCM_BALANCE`
- `INSUFFICIENT_EFFECTIVE_BALANCE`
- `HCM_UNAVAILABLE`
- `HCM_SUBMISSION_FAILED`
- `INVALID_STATUS_TRANSITION`
- `REQUEST_NOT_FOUND`
- `BALANCE_NOT_FOUND`
- `FORBIDDEN`
- `VALIDATION_ERROR`

## 12. API Contract

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

### HCM Batch Sync

```text
POST /hcm/batch-balances
```

Body:

```json
{
  "balances": [
    {
      "employeeId": "emp_001",
      "locationId": "loc_001",
      "availableDays": 10
    }
  ]
}
```

### Time-Off Requests

```text
POST  /time-off-requests
GET   /time-off-requests
GET   /time-off-requests/:id
PATCH /time-off-requests/:id/approve
PATCH /time-off-requests/:id/reject
```

Create body:

```json
{
  "employeeId": "emp_001",
  "locationId": "loc_001",
  "amountDays": 2,
  "startDate": "2026-05-01",
  "endDate": "2026-05-02",
  "reason": "Family trip",
  "idempotencyKey": "optional-key"
}
```

## 13. Security Considerations

Auth is simulated with request headers:

```text
x-user-id: emp_001
x-user-role: employee
```

or:

```text
x-user-id: mgr_001
x-user-role: manager
```

Rules:

- employees can access only their own requests and balances
- managers can list, view, approve, and reject any request
- managers cannot create employee requests in this implementation
- missing or invalid headers return `FORBIDDEN`

Production should use JWT/OAuth and real identity claims. No secrets are committed.

## 14. Alternatives Considered

### REST vs GraphQL

REST was selected because the assessment endpoints map cleanly to resource operations and are easy to test with Supertest and curl.

### Trust HCM Only vs Local Cache + HCM Validation

HCM-only validation would reduce local state but provide weaker performance and observability. Local-cache-only would risk stale decisions. The implementation uses a local cache defensively while still validating against HCM.

### Fail Open vs Fail Closed

The service fails closed when HCM is unavailable because approving or creating requests without source-of-truth validation can over-commit balances.

### Deduct At Creation vs Deduct At Approval

The service does not deduct HCM balance at creation. Deduction happens only after manager approval. Effective availability handles pending local requests before approval.

### Service-Level Idempotency vs DB Partial Unique Index

Service-level idempotency is implemented for portability in SQLite. Production should add a partial unique index for `(employeeId, idempotencyKey)` where `idempotencyKey` is not null.

### DI-Based HCM Mock vs HTTP Adapter

Dependency injection keeps the assessment deterministic and easy to test. Production should replace `MockHcmService` delegation with an HTTP adapter.

## 15. Known Limitations / Production Hardening

- Replace SQLite with Postgres or MySQL.
- Replace TypeORM `synchronize: true` with migrations.
- Add real HCM HTTP integration.
- Add real JWT/OAuth authentication.
- Add DB transactions around request update + history write.
- Add DB row locks or optimistic locking for approval.
- Add structured logging, metrics, tracing, and alerting.
- Add retry/backoff and circuit breaker behavior for HCM calls.
- Add pagination for request listing.
- Add production-grade idempotency persistence and indexes.
