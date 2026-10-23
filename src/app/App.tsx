import { useEffect, useState } from 'react';
import { BrowserProvider } from '../components/BrowserShell/BrowserContext';
import { BrowserShell } from '../components/BrowserShell/BrowserShell';
import { ToastProvider, useToast } from '../components/common/Toast';
import { useSettings } from '../hooks/useStores';
import { I18nProvider, useMessages } from '../i18n';
import { AppearanceRoot } from './AppearanceRoot';
import { createAppServices, type AppServices } from './services';
import { ServicesProvider, useServices } from './ServicesContext';

/** Avisa de errores de guardado y de datos recuperados al arrancar. */
function PersistenceNotices() {
  const m = useMessages();
  const notify = useToast();
  const services = useServices();

  useEffect(() => services.onSaveError((event) => notify('error', m.persistence.saveFailed[event.reason])), [m, notify, services]);

  useEffect(() => {
    const loads = [services.settings, services.shortcuts, services.aliasRules, services.widgets, services.backgroundImage].map(
      (store) => store.initialLoad.status,
    );
    if (services.storage.kind === 'memory') notify('info', m.persistence.memoryOnly);
    if (loads.some((status) => status === 'corrupt' || status === 'repaired')) notify('info', m.persistence.recovered);
    if (loads.includes('newer-version')) notify('info', m.persistence.newerVersion);
  }, [m, notify, services]);

  return null;
}

/** Sincroniza los cambios hechos en otra ventana del mismo navegador. */
function useCrossWindowSync(services: AppServices) {
  useEffect(() => {
    const stores = [services.settings, services.shortcuts, services.aliasRules, services.widgets, services.backgroundImage];
    const onStorage = (event: StorageEvent) => {
      const store = stores.find((item) => item.key === event.key);
      if (store) store.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [services]);
}

function LocalizedApp() {
  const [settings] = useSettings();
  return (
    <I18nProvider language={settings.general.language}>
      <ToastProvider>
        <AppearanceRoot>
          <BrowserProvider>
            <BrowserShell />
          </BrowserProvider>
        </AppearanceRoot>
        <PersistenceNotices />
      </ToastProvider>
    </I18nProvider>
  );
}

export function App({ services: injected }: { services?: AppServices }) {
  const [services] = useState(() => injected ?? createAppServices());
  useCrossWindowSync(services);
  return (
    <ServicesProvider services={services}>
      <LocalizedApp />
    </ServicesProvider>
  );
}
