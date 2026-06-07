import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

/**
 * Centralized request logging: one line per request with method, path,
 * status code, duration and authenticated user (if any).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: { username?: string } }>();
    const res = http.getResponse<Response>();
    const start = Date.now();
    const { method, url } = req;

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          const user = req.user?.username ? ` user=${req.user.username}` : '';
          this.logger.log(`${method} ${url} ${res.statusCode} ${ms}ms${user}`);
        },
        error: () => {
          const ms = Date.now() - start;
          this.logger.warn(`${method} ${url} ERR ${ms}ms`);
        },
      }),
    );
  }
}
