const { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } = require('@nestjs/common');
const { TimeOffRequestsService } = require('./time-off-requests.service');

class TimeOffRequestsController {
  constructor(timeOffRequestsService) {
    this.timeOffRequestsService = timeOffRequestsService;
  }

  create(body, request) {
    return this.timeOffRequestsService.create(body, {
      userId: request.headers['x-user-id'] || null,
      role: request.headers['x-user-role'] || null,
    });
  }

  findAll(query, request) {
    return this.timeOffRequestsService.findAll(query || {}, {
      userId: request.headers['x-user-id'] || null,
      role: request.headers['x-user-role'] || null,
    });
  }

  findOne(id, request) {
    return this.timeOffRequestsService.findOne(id, {
      userId: request.headers['x-user-id'] || null,
      role: request.headers['x-user-role'] || null,
    });
  }

  approve(id, request) {
    return this.timeOffRequestsService.approve(id, {
      userId: request.headers['x-user-id'] || null,
      role: request.headers['x-user-role'] || null,
    });
  }

  reject(id, body, request) {
    return this.timeOffRequestsService.reject(id, body || {}, {
      userId: request.headers['x-user-id'] || null,
      role: request.headers['x-user-role'] || null,
    });
  }
}

Controller('time-off-requests')(TimeOffRequestsController);
Inject(TimeOffRequestsService)(TimeOffRequestsController, undefined, 0);

const createDescriptor = Object.getOwnPropertyDescriptor(TimeOffRequestsController.prototype, 'create');
Post()(TimeOffRequestsController.prototype, 'create', createDescriptor);
Body()(TimeOffRequestsController.prototype, 'create', 0);
Req()(TimeOffRequestsController.prototype, 'create', 1);

const findAllDescriptor = Object.getOwnPropertyDescriptor(TimeOffRequestsController.prototype, 'findAll');
Get()(TimeOffRequestsController.prototype, 'findAll', findAllDescriptor);
Query()(TimeOffRequestsController.prototype, 'findAll', 0);
Req()(TimeOffRequestsController.prototype, 'findAll', 1);

const findOneDescriptor = Object.getOwnPropertyDescriptor(TimeOffRequestsController.prototype, 'findOne');
Get(':id')(TimeOffRequestsController.prototype, 'findOne', findOneDescriptor);
Param('id')(TimeOffRequestsController.prototype, 'findOne', 0);
Req()(TimeOffRequestsController.prototype, 'findOne', 1);

const approveDescriptor = Object.getOwnPropertyDescriptor(TimeOffRequestsController.prototype, 'approve');
Patch(':id/approve')(TimeOffRequestsController.prototype, 'approve', approveDescriptor);
Param('id')(TimeOffRequestsController.prototype, 'approve', 0);
Req()(TimeOffRequestsController.prototype, 'approve', 1);

const rejectDescriptor = Object.getOwnPropertyDescriptor(TimeOffRequestsController.prototype, 'reject');
Patch(':id/reject')(TimeOffRequestsController.prototype, 'reject', rejectDescriptor);
Param('id')(TimeOffRequestsController.prototype, 'reject', 0);
Body()(TimeOffRequestsController.prototype, 'reject', 1);
Req()(TimeOffRequestsController.prototype, 'reject', 2);

module.exports = { TimeOffRequestsController };
