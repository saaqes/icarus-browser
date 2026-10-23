import { createContext, useContext, type ReactNode } from 'react';
import type { LanguageCode } from '../types/settings';
import { es, type Messages } from './es';

const CATALOG: Record<LanguageCode, Messages> = { es };

const I18nContext = createContext<Messages>(es);

export function I18nProvider({ language, children }: { language: LanguageCode; children: ReactNode }) {
  return <I18nContext.Provider value={CATALOG[language] ?? es}>{children}</I18nContext.Provider>;
}

/** Textos de la interfaz en el idioma configurado. */
export function useMessages(): Messages {
  return useContext(I18nContext);
}

export type { Messages };
