const { ForbiddenException, HttpException, HttpStatus, Injectable, Inject } = require('@nestjs/common');
const { InjectRepository } = require('@nestjs/typeorm');
const { TimeOffRequest } = require('./time-off-request.entity');
const { TimeOffRequestHistory } = require('./time-off-request-history.entity');
const { HcmService } = require('../hcm/hcm.service');
const { BalancesService } = require('../balances/balances.service');
const { ErrorCodes } = require('../common/errors/error-codes');
const { validateCreateTimeOffRequest } = require('./validators/create-time-off-request.validator');
const { validateRejectTimeOffRequest } = require('./validators/reject-time-off-request.validator');

const REQUEST_STATUSES = Object.freeze({
  PENDING_MANAGER_APPROVAL: 'PENDING_MANAGER_APPROVAL',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  FAILED_HCM_VALIDATION: 'FAILED_HCM_VALIDATION',
  FAILED_HCM_SUBMISSION: 'FAILED_HCM_SUBMISSION',
  CANCELLED: 'CANCELLED',
});

function structuredError(status, code, message) {
  return new HttpException({
    success: false,
    error: { code, message },
  }, status);
}

class TimeOffRequestsService {
  constructor(requestRepository, historyRepository, hcmService, balancesService) {
    this.requestRepository = requestRepository;
    this.historyRepository = historyRepository;
    this.hcmService = hcmService;
    this.balancesService = balancesService;
  }

  async create(body, user) {
    validateCreateTimeOffRequest(body);
    this.authorizeCreate(body.employeeId, user);

    if (body.idempotencyKey) {
      const existing = await this.requestRepository.findOne({
        where: {
          employeeId: body.employeeId,
          idempotencyKey: body.idempotencyKey,
        },
      });

      if (existing) {
        return this.toRequestResponse(existing);
      }
    }

    let localBalanceMissing = false;

    try {
      const localBalance = await this.balancesService.getLocalBalance(body.employeeId, body.locationId);
      if (localBalance.availableDays < body.amountDays) {
        throw structuredError(
          HttpStatus.BAD_REQUEST,
          ErrorCodes.INSUFFICIENT_LOCAL_BALANCE,
          `Insufficient local balance. Required: ${body.amountDays}, Available: ${localBalance.availableDays}`,
        );
      }
    } catch (error) {
      if (this.getErrorCode(error) === ErrorCodes.BALANCE_NOT_FOUND) {
        localBalanceMissing = true;
      } else {
        throw error;
      }
    }

    const hcmBalance = await this.hcmService.getBalance(body.employeeId, body.locationId);
    if (hcmBalance.availableDays < body.amountDays) {
      throw structuredError(
        HttpStatus.BAD_REQUEST,
        ErrorCodes.INSUFFICIENT_HCM_BALANCE,
        `Insufficient HCM balance. Required: ${body.amountDays}, Available: ${hcmBalance.availableDays}`,
      );
    }

    if (localBalanceMissing) {
      await this.balancesService.upsertBalance(
        body.employeeId,
        body.locationId,
        hcmBalance.availableDays,
        'HCM_REALTIME',
      );
    }

    const pendingDeduction = await this.getPendingDeduction(body.employeeId, body.locationId);
    const effectiveAvailableDays = hcmBalance.availableDays - pendingDeduction;
    if (effectiveAvailableDays < body.amountDays) {
      throw structuredError(
        HttpStatus.BAD_REQUEST,
        ErrorCodes.INSUFFICIENT_EFFECTIVE_BALANCE,
        `Insufficient effective balance. Required: ${body.amountDays}, Available: ${effectiveAvailableDays}`,
      );
    }

    const request = this.requestRepository.create({
      employeeId: body.employeeId,
      locationId: body.locationId,
      amountDays: body.amountDays,
      startDate: body.startDate,
      endDate: body.endDate,
      reason: body.reason || null,
      status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
      hcmSubmissionId: null,
      idempotencyKey: body.idempotencyKey || null,
    });

    const saved = await this.requestRepository.save(request);
    await this.createHistory(
      saved.id,
      null,
      REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
      user.userId,
      'employee',
      null,
      null,
    );

    return this.toRequestResponse(saved);
  }

  async findOne(id, user) {
    this.validateReadAuth(user);

    const request = await this.requestRepository.findOne({
      where: { id },
    });

    if (!request) {
      throw structuredError(
        HttpStatus.NOT_FOUND,
        ErrorCodes.REQUEST_NOT_FOUND,
        'Request not found',
      );
    }

    this.authorizeReadRequest(request, user);

    const history = await this.historyRepository.find({
      where: { requestId: id },
      order: { createdAt: 'ASC' },
    });

    return {
      ...this.toRequestResponse(request),
      history: history.map((entry) => this.toHistoryResponse(entry)),
    };
  }

  async findAll(filters, user) {
    this.validateReadAuth(user);

    const where = {};
    const requestedEmployeeId = filters && filters.employeeId;

    if (user.role === 'employee') {
      if (requestedEmployeeId && requestedEmployeeId !== user.userId) {
        throw new ForbiddenException({
          success: false,
          error: { code: ErrorCodes.FORBIDDEN, message: 'Insufficient permissions' },
        });
      }
      where.employeeId = user.userId;
    } else if (requestedEmployeeId) {
      where.employeeId = requestedEmployeeId;
    }

    if (filters && filters.locationId) {
      where.locationId = filters.locationId;
    }

    if (filters && filters.status) {
      where.status = filters.status;
    }

    const requests = await this.requestRepository.find({ where });
    return requests.map((request) => this.toRequestResponse(request));
  }

  async reject(id, body, user) {
    validateRejectTimeOffRequest(body);
    this.authorizeManager(user);

    const request = await this.getRequestOrThrow(id);
    this.assertPending(request);

    const fromStatus = request.status;
    request.status = REQUEST_STATUSES.REJECTED;
    const saved = await this.requestRepository.save(request);

    await this.createHistory(
      saved.id,
      fromStatus,
      REQUEST_STATUSES.REJECTED,
      user.userId,
      'manager',
      body && body.reason ? body.reason : null,
      null,
    );

    return this.toRequestResponse(saved);
  }

  async approve(id, user) {
    this.authorizeManager(user);

    const request = await this.getRequestOrThrow(id);
    this.assertPending(request);

    const amountDays = parseFloat(request.amountDays);
    const hcmBalance = await this.hcmService.getBalance(request.employeeId, request.locationId);

    if (hcmBalance.availableDays < amountDays) {
      const fromStatus = request.status;
      request.status = REQUEST_STATUSES.FAILED_HCM_VALIDATION;
      const saved = await this.requestRepository.save(request);
      await this.createHistory(
        saved.id,
        fromStatus,
        REQUEST_STATUSES.FAILED_HCM_VALIDATION,
        user.userId,
        'manager',
        null,
        {
          code: ErrorCodes.INSUFFICIENT_HCM_BALANCE,
          message: `Insufficient HCM balance. Required: ${amountDays}, Available: ${hcmBalance.availableDays}`,
        },
      );

      throw structuredError(
        HttpStatus.BAD_REQUEST,
        ErrorCodes.INSUFFICIENT_HCM_BALANCE,
        `Insufficient HCM balance. Required: ${amountDays}, Available: ${hcmBalance.availableDays}`,
      );
    }

    let submission;
    try {
      submission = await this.hcmService.submitTimeOff({
        employeeId: request.employeeId,
        locationId: request.locationId,
        amountDays,
        startDate: request.startDate,
        endDate: request.endDate,
        externalRequestId: request.id,
      });
    } catch (error) {
      const fromStatus = request.status;
      request.status = REQUEST_STATUSES.FAILED_HCM_SUBMISSION;
      const saved = await this.requestRepository.save(request);
      await this.createHistory(
        saved.id,
        fromStatus,
        REQUEST_STATUSES.FAILED_HCM_SUBMISSION,
        user.userId,
        'manager',
        null,
        {
          code: this.getErrorCode(error) || ErrorCodes.HCM_SUBMISSION_FAILED,
          message: this.getErrorMessage(error),
        },
      );

      throw structuredError(
        HttpStatus.BAD_REQUEST,
        ErrorCodes.HCM_SUBMISSION_FAILED,
        this.getErrorMessage(error),
      );
    }

    const fromStatus = request.status;
    request.status = REQUEST_STATUSES.COMPLETED;
    request.hcmSubmissionId = submission.hcmSubmissionId;
    const saved = await this.requestRepository.save(request);

    await this.createHistory(
      saved.id,
      fromStatus,
      REQUEST_STATUSES.COMPLETED,
      user.userId,
      'manager',
      null,
      { hcmSubmissionId: submission.hcmSubmissionId },
    );

    await this.balancesService.refreshFromHcm(request.employeeId, request.locationId);

    return this.toRequestResponse(saved);
  }

  authorizeCreate(employeeId, user) {
    if (!user || !user.userId || !user.role) {
      throw new ForbiddenException({
        success: false,
        error: { code: ErrorCodes.FORBIDDEN, message: 'Missing authentication headers' },
      });
    }

    if (user.role !== 'employee' || user.userId !== employeeId) {
      throw new ForbiddenException({
        success: false,
        error: { code: ErrorCodes.FORBIDDEN, message: 'Insufficient permissions' },
      });
    }
  }

  authorizeManager(user) {
    if (!user || !user.userId || !user.role) {
      throw new ForbiddenException({
        success: false,
        error: { code: ErrorCodes.FORBIDDEN, message: 'Missing authentication headers' },
      });
    }

    if (user.role !== 'manager') {
      throw new ForbiddenException({
        success: false,
        error: { code: ErrorCodes.FORBIDDEN, message: 'Insufficient permissions' },
      });
    }
  }

  async getRequestOrThrow(id) {
    const request = await this.requestRepository.findOne({
      where: { id },
    });

    if (!request) {
      throw structuredError(
        HttpStatus.NOT_FOUND,
        ErrorCodes.REQUEST_NOT_FOUND,
        'Request not found',
      );
    }

    return request;
  }

  assertPending(request) {
    if (request.status !== REQUEST_STATUSES.PENDING_MANAGER_APPROVAL) {
      throw structuredError(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_STATUS_TRANSITION,
        `Request must be ${REQUEST_STATUSES.PENDING_MANAGER_APPROVAL}`,
      );
    }
  }

  validateReadAuth(user) {
    if (!user || !user.userId || !user.role) {
      throw new ForbiddenException({
        success: false,
        error: { code: ErrorCodes.FORBIDDEN, message: 'Missing authentication headers' },
      });
    }

    if (!['employee', 'manager'].includes(user.role)) {
      throw new ForbiddenException({
        success: false,
        error: { code: ErrorCodes.FORBIDDEN, message: 'Insufficient permissions' },
      });
    }
  }

  authorizeReadRequest(request, user) {
    if (user.role === 'manager') {
      return;
    }

    if (user.role === 'employee' && request.employeeId === user.userId) {
      return;
    }

    throw new ForbiddenException({
      success: false,
      error: { code: ErrorCodes.FORBIDDEN, message: 'Insufficient permissions' },
    });
  }

  async getPendingDeduction(employeeId, locationId) {
    const pendingRequests = await this.requestRepository.find({
      where: {
        employeeId,
        locationId,
        status: REQUEST_STATUSES.PENDING_MANAGER_APPROVAL,
      },
    });

    return pendingRequests.reduce((sum, request) => sum + parseFloat(request.amountDays), 0);
  }

  async createHistory(requestId, fromStatus, toStatus, actorId, actorRole, reason, metadata) {
    const history = this.historyRepository.create({
      requestId,
      fromStatus,
      toStatus,
      actorId,
      actorRole,
      reason: reason || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    return this.historyRepository.save(history);
  }

  getErrorCode(error) {
    if (error && typeof error.getResponse === 'function') {
      const response = error.getResponse();
      return response && response.error && response.error.code;
    }

    return undefined;
  }

  getErrorMessage(error) {
    if (error && typeof error.getResponse === 'function') {
      const response = error.getResponse();
      if (response && response.error && response.error.message) {
        return response.error.message;
      }
      if (response && response.message) {
        return Array.isArray(response.message) ? response.message.join('; ') : response.message;
      }
    }

    return error && error.message ? error.message : 'HCM submission failed';
  }

  toRequestResponse(request) {
    return {
      id: request.id,
      employeeId: request.employeeId,
      locationId: request.locationId,
      amountDays: parseFloat(request.amountDays),
      startDate: request.startDate,
      endDate: request.endDate,
      reason: request.reason,
      status: request.status,
      hcmSubmissionId: request.hcmSubmissionId,
      idempotencyKey: request.idempotencyKey,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  toHistoryResponse(history) {
    return {
      id: history.id,
      requestId: history.requestId,
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      actorId: history.actorId,
      actorRole: history.actorRole,
      reason: history.reason,
      metadata: history.metadata,
      createdAt: history.createdAt,
    };
  }
}

Injectable()(TimeOffRequestsService);
InjectRepository(TimeOffRequest)(TimeOffRequestsService, undefined, 0);
InjectRepository(TimeOffRequestHistory)(TimeOffRequestsService, undefined, 1);
Inject(HcmService)(TimeOffRequestsService, undefined, 2);
Inject(BalancesService)(TimeOffRequestsService, undefined, 3);

module.exports = { TimeOffRequestsService, REQUEST_STATUSES };
