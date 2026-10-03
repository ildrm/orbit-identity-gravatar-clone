export function localeDirection(locale: string): 'rtl' | 'ltr' {
  return ['ar', 'fa', 'he', 'ur', 'ps', 'sd'].includes(locale.split('-')[0]!) ? 'rtl' : 'ltr';
}
export function formatMoment(
  value: string | number | Date,
  locale = 'en',
  timezone = 'UTC',
  dateOnly = false,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      dateStyle: 'medium',
      ...(dateOnly ? {} : { timeStyle: 'short' as const }),
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      ...(dateOnly ? {} : { timeStyle: 'short' as const }),
    }).format(date);
  }
}
