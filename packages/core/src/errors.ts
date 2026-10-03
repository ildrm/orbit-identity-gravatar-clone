export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
export function requireValue<T>(value: T | null | undefined, message = 'Resource unavailable'): T {
  if (value == null) throw new DomainError('NOT_FOUND', message, 404);
  return value;
}
