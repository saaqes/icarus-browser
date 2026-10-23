import { createContext, useContext, type ReactNode } from 'react';
import type { AppServices } from './services';

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices debe usarse dentro de <ServicesProvider>');
  return services;
}
