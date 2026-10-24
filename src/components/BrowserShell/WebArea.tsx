/**
 * Área de una pestaña con página web en la aplicación de escritorio. La página
 * la dibuja Chromium en una vista nativa situada encima de este elemento; aquí
 * solo se muestran los errores reales de navegación.
 */

import { useMessages } from '../../i18n';
import type { NavigationErrorInfo } from '../../types/native';
import { Icon } from '../common/Icon';
import { useBrowser } from './BrowserContext';

export function WebArea({ tabId }: { tabId: string }) {
  const { webState } = useBrowser();
  const error = webState[tabId]?.error ?? null;
  if (!error) return <section className="web-area" aria-hidden="true" />;
  return <NavigationErrorPage error={error} />;
}

function NavigationErrorPage({ error }: { error: NavigationErrorInfo }) {
  const m = useMessages();
  const t = m.errorPage;
  const { reload, goBack, canGoBack } = useBrowser();
  const title = t.titles[error.kind];
  return (
    <section className="error-page" aria-labelledby="error-page-title">
      <div className="error-card">
        <Icon name={error.kind === 'certificate' ? 'lock' : error.kind === 'crashed' ? 'warning' : 'globe'} size={36} />
        <h1 id="error-page-title">{title}</h1>
        <p>{t.bodies[error.kind]}</p>
        <dl className="error-card__details">
          <div>
            <dt>{t.address}</dt>
            <dd className="mono selectable">{error.url}</dd>
          </div>
          <div>
            <dt>{t.code}</dt>
            <dd className="mono">
              {error.description || '—'} ({error.code})
            </dd>
          </div>
        </dl>
        <div className="error-card__actions">
          <button type="button" className="btn btn--primary" onClick={reload}>
            <Icon name="reload" size={16} />
            {t.retry}
          </button>
          {canGoBack && (
            <button type="button" className="btn btn--ghost" onClick={goBack}>
              <Icon name="back" size={16} />
              {m.toolbar.back}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
