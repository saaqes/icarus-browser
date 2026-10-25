/**
 * Página interna que ocupa la pestaña cuando una página web se abre fuera de
 * ICARUS (versión web, sin motor propio). Deja claro que la navegación es externa:
 * el navegador del sistema siempre muestra la URL real, también cuando ICARUS
 * tiene una dirección personalizada para ella.
 */

import { useServices } from '../../app/ServicesContext';
import { useMessages } from '../../i18n';
import { formatAddress, shortAddress } from '../../services/custom-addresses/display';
import type { PageEntry } from '../../types/tabs';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';
import './InternalPages.css';

type ExternalEntry = Extract<PageEntry, { kind: 'web' }>;

export function ExternalPage({ page }: { page: ExternalEntry }) {
  const m = useMessages();
  const t = m.externalPage;
  const { engine } = useServices();
  const { describe, markCurrentOpened } = useBrowser();
  const presentation = describe(page);
  const display = formatAddress(presentation.addressUrl, false);

  return (
    <section className="external-page" aria-labelledby="external-page-title">
      <div className="external-card">
        <div className="external-card__site">
          <Favicon url={page.url} label={presentation.title} size={40} />
          <div>
            <p className="external-card__name">{presentation.title}</p>
            <p className="external-card__host">{display.host}</p>
          </div>
        </div>

        <h1 id="external-page-title" className="external-card__title">
          <Icon name="external" size={20} />
          {page.openedExternally ? t.title : t.pendingTitle}
        </h1>
        <p className="external-card__body">{page.openedExternally ? t.openedBody : t.pendingBody}</p>

        <dl className="external-card__details">
          {presentation.customAddress && (
            <div>
              <dt>{t.customAddress}</dt>
              <dd className="mono selectable">{shortAddress(presentation.addressUrl)}</dd>
            </div>
          )}
          <div>
            <dt>{presentation.customAddress ? t.openedUrl : t.realUrl}</dt>
            <dd className="mono selectable">{page.url}</dd>
          </div>
        </dl>

        {presentation.protocol === 'http:' && (
          <p className="external-card__warning">
            <Icon name="warning" size={16} />
            {t.insecure}
          </p>
        )}

        <div className="external-card__actions">
          {/* Un enlace real funciona aunque el entorno bloquee las ventanas emergentes. */}
          <a className="btn btn--primary" href={page.url} target="_blank" rel="noopener noreferrer" onClick={markCurrentOpened}>
            <Icon name="external" size={16} />
            {page.openedExternally ? t.openAgain : t.open}
          </a>
        </div>
        {page.openedExternally && <p className="external-card__hint">{t.notOpenedHint}</p>}
        <p className="external-card__engine">
          <Icon name="info" size={14} />
          {t.engine(engine.info.name)}
        </p>
      </div>
    </section>
  );
}
