export type RemoteTransportErrorCode =
  | 'auth'
  | 'connection'
  | 'execution'
  | 'timeout'
  | 'config';

export class RemoteTransportError extends Error {
  constructor(
    readonly code: RemoteTransportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RemoteTransportError';
  }
}

export function enrichError(
  error: unknown,
  code: RemoteTransportErrorCode,
  hostAlias: string,
): RemoteTransportError {
  if (error instanceof RemoteTransportError) {
    return error;
  }

  if (error instanceof Error) {
    return new RemoteTransportError(code, `${error.message} (host: ${hostAlias})`, {
      cause: error,
    });
  }

  return new RemoteTransportError(code, `Unknown ${code} error on host ${hostAlias}: ${String(error)}`);
}
