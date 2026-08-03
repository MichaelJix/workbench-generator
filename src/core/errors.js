export const ErrorCode = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_SPEC: 'INVALID_SPEC',
  UNSUPPORTED_SPEC_VERSION: 'UNSUPPORTED_SPEC_VERSION',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  EXPIRED: 'EXPIRED',
  INVALID_STATE: 'INVALID_STATE',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  TOKEN_REUSED: 'TOKEN_REUSED',
  UPSTREAM_FAILED: 'UPSTREAM_FAILED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  INTERNAL: 'INTERNAL'
});

const STATUS_BY_CODE = Object.freeze({
  [ErrorCode.INVALID_INPUT]: 400,
  [ErrorCode.INVALID_SPEC]: 400,
  [ErrorCode.UNSUPPORTED_SPEC_VERSION]: 400,
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.EXPIRED]: 410,
  [ErrorCode.INVALID_STATE]: 409,
  [ErrorCode.APPROVAL_REQUIRED]: 409,
  [ErrorCode.TOKEN_REUSED]: 409,
  [ErrorCode.UPSTREAM_FAILED]: 502,
  [ErrorCode.CONFIGURATION_ERROR]: 500,
  [ErrorCode.INTERNAL]: 500
});

export class AppError extends Error {
  constructor(code, message, details, options) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.status = STATUS_BY_CODE[code] || 500;
  }
}

export function asAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError(ErrorCode.INTERNAL, '内部错误', undefined, { cause: error });
}

export function invariant(condition, code, message, details) {
  if (!condition) throw new AppError(code, message, details);
}
