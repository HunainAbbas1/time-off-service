const { Catch, HttpException, HttpStatus } = require('@nestjs/common');

/**
 * Global exception filter that normalizes all errors to:
 * { success: false, error: { code, message } }
 */
class HttpExceptionFilter {
  catch(exception, host) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        // Support pre-formatted error responses
        if (body.error && body.error.code) {
          return response.status(status).json(body);
        }
        code = body.code || body.error || code;
        message = body.message || message;
      } else {
        message = body;
      }
    }

    response.status(status).json({
      success: false,
      error: { code, message },
    });
  }
}

Catch()(HttpExceptionFilter);

module.exports = { HttpExceptionFilter };
