import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

/**
 * Catches every unhandled exception and returns a consistent JSON shape.
 * Also maps common Prisma errors to sensible HTTP statuses and logs server
 * errors centrally (with stack) without leaking internals to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const r = res as Record<string, unknown>;
        message = (r.message as string | string[]) ?? exception.message;
        error = (r.error as string) ?? exception.name;
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      // Malformed query / missing required fields reaching Prisma → client error
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid or missing fields in request';
      error = 'BadRequest';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Map common Prisma error codes
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = `Unique constraint violation on ${(exception.meta?.target as string[])?.join(', ') ?? 'field'}`;
          error = 'Conflict';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          error = 'NotFound';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          message = 'Foreign key constraint failed';
          error = 'BadRequest';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          message = 'Database request error';
          error = 'BadRequest';
      }
    }

    // Log 5xx with full detail; 4xx as warnings
    const logMsg = `${request.method} ${request.url} → ${status} : ${JSON.stringify(message)}`;
    if (status >= 500) {
      this.logger.error(logMsg, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(logMsg);
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
