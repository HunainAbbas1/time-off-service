const { BadRequestException, Injectable, NotFoundException, Inject } = require('@nestjs/common');
const { InjectRepository } = require('@nestjs/typeorm');
const { Balance } = require('./balance.entity');
const { HcmService } = require('../hcm/hcm.service');
const { ErrorCodes } = require('../common/errors/error-codes');

const VALID_BALANCE_SOURCES = Object.freeze([
  'HCM_BATCH',
  'HCM_REALTIME',
  'LOCAL_ESTIMATE',
]);

function toBalanceResponse(balance) {
  return {
    employeeId: balance.employeeId,
    locationId: balance.locationId,
    availableDays: parseFloat(balance.availableDays),
    source: balance.source,
    lastSyncedAt: balance.lastSyncedAt,
  };
}

function validationError(message) {
  return new BadRequestException({
    success: false,
    error: { code: ErrorCodes.VALIDATION_ERROR, message },
  });
}

class BalancesService {
  constructor(repository, hcmService) {
    this.repository = repository;
    this.hcmService = hcmService;
  }

  async getLocalBalance(employeeId, locationId) {
    const balance = await this.repository.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      throw new NotFoundException({
        success: false,
        error: {
          code: ErrorCodes.BALANCE_NOT_FOUND,
          message: 'Balance not found',
        },
      });
    }

    return toBalanceResponse(balance);
  }

  async upsertBalance(employeeId, locationId, availableDays, source) {
    this.validateUpsertInput(employeeId, locationId, availableDays, source);

    const existing = await this.repository.findOne({
      where: { employeeId, locationId },
    });

    const balance = existing || this.repository.create({ employeeId, locationId });
    balance.availableDays = availableDays;
    balance.source = source;
    balance.lastSyncedAt = new Date();

    const saved = await this.repository.save(balance);
    return toBalanceResponse(saved);
  }

  async refreshFromHcm(employeeId, locationId) {
    const hcmBalance = await this.hcmService.getBalance(employeeId, locationId);
    return this.upsertBalance(
      hcmBalance.employeeId,
      hcmBalance.locationId,
      hcmBalance.availableDays,
      'HCM_REALTIME',
    );
  }

  validateUpsertInput(employeeId, locationId, availableDays, source) {
    if (!employeeId) {
      throw validationError('employeeId is required');
    }

    if (!locationId) {
      throw validationError('locationId is required');
    }

    if (typeof availableDays !== 'number' || Number.isNaN(availableDays) || availableDays < 0) {
      throw validationError('availableDays must be a number greater than or equal to 0');
    }

    if (!VALID_BALANCE_SOURCES.includes(source)) {
      throw validationError(`source must be one of: ${VALID_BALANCE_SOURCES.join(', ')}`);
    }
  }
}

Injectable()(BalancesService);
InjectRepository(Balance)(BalancesService, undefined, 0);
Inject(HcmService)(BalancesService, undefined, 1);

module.exports = { BalancesService, VALID_BALANCE_SOURCES };
