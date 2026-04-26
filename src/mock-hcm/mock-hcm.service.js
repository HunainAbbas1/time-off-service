const { Injectable, HttpException, HttpStatus } = require('@nestjs/common');
const { InjectRepository } = require('@nestjs/typeorm');
const { v4: uuid } = require('uuid');
const { MockHcmBalance } = require('./mock-hcm-balance.entity');
const { ErrorCodes } = require('../common/errors/error-codes');

/**
 * Simulates external HCM system behaviour.
 * Used by HcmService via DI; also exposed via controller for E2E/demo.
 */
class MockHcmService {
  /** @type {boolean} When true, all calls return HCM_UNAVAILABLE */
  _unavailable = false;

  constructor(repository) {
    this.repository = repository;
  }

  // --- Test helpers ---

  /**
   * Set availability flag. When true, all getBalance/submitTimeOff calls throw HCM_UNAVAILABLE.
   */
  setUnavailable(flag) {
    this._unavailable = flag;
  }

  /**
   * Seed a balance record for testing.
   */
  async seedBalance(employeeId, locationId, availableDays) {
    const existing = await this.repository.findOne({
      where: { employeeId, locationId },
    });

    if (existing) {
      existing.availableDays = availableDays;
      return this.repository.save(existing);
    }

    return this.repository.save({
      id: uuid(),
      employeeId,
      locationId,
      availableDays,
    });
  }

  /**
   * Clear all balances and reset unavailability flag (for test isolation).
   */
  async reset() {
    this._unavailable = false;
    await this.repository.delete({});
  }

  // --- Core mock operations ---

  /**
   * Get balance for an employee at a location.
   * Returns { employeeId, locationId, availableDays }
   * Throws INVALID_DIMENSIONS (400) if not found
   * Throws HCM_UNAVAILABLE (503) if unavailable flag is set
   */
  async getBalance(employeeId, locationId) {
    // Check unavailability first
    if (this._unavailable) {
      throw new HttpException(
        {
          success: false,
          error: { code: ErrorCodes.HCM_UNAVAILABLE, message: 'HCM is temporarily unavailable' },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Fetch balance
    const balance = await this.repository.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      throw new HttpException(
        {
          success: false,
          error: { code: ErrorCodes.INVALID_DIMENSIONS, message: 'Employee or location does not exist in HCM' },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      employeeId: balance.employeeId,
      locationId: balance.locationId,
      availableDays: parseFloat(balance.availableDays),
    };
  }

  /**
   * Submit time-off request to HCM and atomically deduct balance.
   * Validates payload, checks balance sufficiency, deducts atomically.
   *
   * Payload: { employeeId, locationId, amountDays }
   * Returns: { hcmSubmissionId, status: "ACCEPTED" }
   * Throws: HCM_UNAVAILABLE (503), INVALID_DIMENSIONS (400), INSUFFICIENT_HCM_BALANCE (400)
   */
  async submitTimeOff(payload) {
    // Check unavailability first
    if (this._unavailable) {
      throw new HttpException(
        {
          success: false,
          error: { code: ErrorCodes.HCM_UNAVAILABLE, message: 'HCM is temporarily unavailable' },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Validate payload
    const { employeeId, locationId, amountDays } = payload;

    if (!employeeId || !locationId) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: ErrorCodes.INVALID_DIMENSIONS,
            message: 'employeeId and locationId are required',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (typeof amountDays !== 'number' || amountDays <= 0) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'amountDays must be a positive number',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Fetch current balance
    const balance = await this.repository.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      throw new HttpException(
        {
          success: false,
          error: { code: ErrorCodes.INVALID_DIMENSIONS, message: 'Employee or location does not exist in HCM' },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check sufficiency
    const currentAvailable = parseFloat(balance.availableDays);
    if (currentAvailable < amountDays) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: ErrorCodes.INSUFFICIENT_HCM_BALANCE,
            message: `Insufficient balance. Required: ${amountDays}, Available: ${currentAvailable}`,
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Atomically deduct
    balance.availableDays = currentAvailable - amountDays;
    await this.repository.save(balance);

    return {
      hcmSubmissionId: uuid(),
      status: 'ACCEPTED',
    };
  }
}

// Apply NestJS decorators programmatically
Injectable()(MockHcmService);
InjectRepository(MockHcmBalance)(MockHcmService, undefined, 0);

module.exports = { MockHcmService };
