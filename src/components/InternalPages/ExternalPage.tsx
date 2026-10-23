/**
 * Página interna que ocupa la pestaña cuando una página web se abre fuera de
 * ICARUS. Deja claro que la navegación es externa y muestra la URL real,
 * separada del alias visual si lo hay.
 */

import { useServices } from '../../app/ServicesContext';
import { useMessages } from '../../i18n';
import { splitUrlForDisplay } from '../../services/url-resolution/urlUtils';
import type { PageEntry } from '../../types/tabs';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';
import './InternalPages.css';

type ExternalEntry = Extract<PageEntry, { kind: 'external' }>;

export function ExternalPage({ page }: { page: ExternalEntry }) {
  const m = useMessages();
  const t = m.externalPage;
  const { engine } = useServices();
  const { describe, openCurrentExternally } = useBrowser();
  const presentation = describe(page);
  const display = splitUrlForDisplay(page.url);

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
          <div>
            <dt>{t.realUrl}</dt>
            <dd className="mono selectable">{page.url}</dd>
          </div>
          {presentation.alias && (
            <>
              <div>
                <dt>{t.alias}</dt>
                <dd>
                  <span className="alias-chip">
                    <Icon name="tag" size={12} />
                    {m.addressBar.aliasBadge}
                  </span>{' '}
                  <span className="mono">{presentation.alias.rule.alias}</span>
                </dd>
              </div>
              <div>
                <dt>{t.rule}</dt>
                <dd>{presentation.alias.rule.name}</dd>
              </div>
              <div>
                <dt>{t.target}</dt>
                <dd className="mono selectable">{presentation.alias.rule.targetUrl}</dd>
              </div>
            </>
          )}
        </dl>

        {presentation.protocol === 'http:' && (
          <p className="external-card__warning">
            <Icon name="warning" size={16} />
            {t.insecure}
          </p>
        )}

        <div className="external-card__actions">
          <button type="button" className="btn btn--primary" onClick={openCurrentExternally}>
            <Icon name="external" size={16} />
            {page.openedExternally ? t.openAgain : t.open}
          </button>
          <a className="external-card__fallback" href={page.url} target="_blank" rel="noopener noreferrer">
            {t.fallbackLink}
          </a>
        </div>
        <p className="external-card__engine">
          <Icon name="info" size={14} />
          {t.engine(engine.info.name)}
        </p>
      </div>
    </section>
  );
}
