import { Catch, HttpException, type ExceptionFilter, type ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OAuthError } from '../../../packages/core/src/oauth.js';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../packages/core/src/errors.js';
import type { Account } from './auth/auth.service.js';
export interface ApiRequest extends Request {
  account?: Account;
  requestId: string;
}
export function requireAccount(req: ApiRequest): Account {
  if (!req.account) throw new DomainError('AUTHENTICATION_REQUIRED', 'Sign in to continue.', 401);
  return req.account;
}
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<ApiRequest>(),
      res = host.switchToHttp().getResponse<Response>();
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'The request could not be completed.',
      details: unknown;
    if (error instanceof OAuthError) {
      res.status(error.status).json({ error: error.error, error_description: error.message });
      return;
    }
    if (error instanceof DomainError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Review the highlighted fields.';
      details = error.issues.map((i) => ({ path: i.path, message: i.message }));
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = 'HTTP_ERROR';
      message = status === 404 ? 'Route unavailable' : error.message;
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    ) {
      status = 409;
      code = 'CONFLICT';
      message = 'This identifier is already reserved.';
    }
    const requestId = req.requestId ?? randomUUID();
    if (status >= 500)
      process.stderr.write(
        JSON.stringify({
          level: 'error',
          requestId,
          code,
          error: error instanceof Error ? error.name : 'UnknownError',
          ...(typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'string' &&
          /^[0-9A-Z]{5}$/.test(error.code)
            ? { sqlState: error.code }
            : {}),
        }) + '\n',
      );
    res
      .status(status)
      .json({ code, message, status, request_id: requestId, ...(details ? { details } : {}) });
  }
}
