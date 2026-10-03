import type { ApiError } from '../../../packages/contracts/src/index';
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/v1' + path, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as ApiError | null;
    throw new RequestError(
      response.status,
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? 'The request could not be completed.',
    );
  }
  return body as T;
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
