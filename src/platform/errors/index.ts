/**
 * Application errors. Services throw these; the HTTP / server-action layer
 * maps them to responses. Cross-company access is always NotFoundError (404),
 * never ForbiddenError, so the existence of other tenants' data is not leaked.
 */
export type FieldErrors = Record<string, string[]>;

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = "not_found";
  constructor(message = "Not found") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = "forbidden";
  constructor(message = "Forbidden") {
    super(message);
  }
}

export class UnauthenticatedError extends AppError {
  readonly status = 401;
  readonly code = "unauthenticated";
  constructor(message = "Authentication required") {
    super(message);
  }
}

export class ValidationError extends AppError {
  readonly status = 422;
  readonly code = "validation_failed";
  constructor(
    readonly fieldErrors: FieldErrors,
    message = "Validation failed",
  ) {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = "conflict";
  constructor(
    message = "Conflict",
    readonly field?: string,
  ) {
    super(message);
  }
}

export class RateLimitedError extends AppError {
  readonly status = 429;
  readonly code = "rate_limited";
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests");
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
