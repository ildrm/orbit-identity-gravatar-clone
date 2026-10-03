'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { formatMoment, localeDirection } from './locale';
type Preferences = { locale: string; timezone: string };
const Context = createContext({
  locale: 'en',
  timezone: 'UTC',
  setPreferences: (_preferences: Preferences) => {},
  formatDate: (value: string | number | Date, dateOnly = false) =>
    formatMoment(value, 'en', 'UTC', dateOnly),
});
export function LocaleProvider({
  locale,
  timezone,
  children,
}: Preferences & { children: ReactNode }) {
  const [preferences, setPreferences] = useState({ locale, timezone });
  return (
    <Context.Provider
      value={{
        ...preferences,
        setPreferences,
        formatDate: (value, dateOnly = false) =>
          formatMoment(value, preferences.locale, preferences.timezone, dateOnly),
      }}
    >
      <div dir={localeDirection(preferences.locale)} data-account-locale={preferences.locale}>
        {children}
      </div>
    </Context.Provider>
  );
}
export function useLocale() {
  return useContext(Context);
}
