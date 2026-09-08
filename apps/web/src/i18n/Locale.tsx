import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { STRINGS, type Locale, type MessageKey } from './strings.js';

const KEY = 'tibia-idle.locale';

interface LocaleApi {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
}

const Context = createContext<LocaleApi | null>(null);

function readLocale(): Locale {
  const stored = localStorage.getItem(KEY);
  return stored === 'en' ? 'en' : 'pt';
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale);

  const api = useMemo<LocaleApi>(() => ({
    locale,
    setLocale: (next) => {
      localStorage.setItem(KEY, next);
      setLocaleState(next);
    },
    t: (key) => STRINGS[locale][key] ?? STRINGS.pt[key],
  }), [locale]);

  return <Context.Provider value={api}>{children}</Context.Provider>;
}

export function useLocale(): LocaleApi {
  const value = useContext(Context);
  if (!value) throw new Error('LocaleProvider missing');
  return value;
}
