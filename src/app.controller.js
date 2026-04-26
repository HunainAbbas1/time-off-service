const { Controller, Get } = require('@nestjs/common');

class AppController {
  getHealth() {
    return { status: 'ok' };
  }
}

Controller()(AppController);
Get('health')(AppController.prototype, 'getHealth', Object.getOwnPropertyDescriptor(AppController.prototype, 'getHealth'));

module.exports = { AppController };
