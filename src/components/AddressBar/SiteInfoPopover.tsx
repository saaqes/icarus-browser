import { useRef, type RefObject } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { useMessages } from '../../i18n';
import type { PagePresentation } from '../../services/tabs/pages';
import { Icon } from '../common/Icon';
import { useToast } from '../common/Toast';

interface SiteInfoPopoverProps {
  presentation: PagePresentation;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onEdit: () => void;
}

/** Información verificable de la página: URL real, protocolo y, si aplica, alias y regla. */
export function SiteInfoPopover({ presentation, anchorRef, onClose, onEdit }: SiteInfoPopoverProps) {
  const m = useMessages();
  const t = m.addressBar.info;
  const notify = useToast();
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, true, onClose, anchorRef);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(presentation.realUrl);
      notify('success', t.copied);
    } catch {
      notify('error', t.copyFailed);
    }
  };

  const external = presentation.kind === 'external';

  return (
    <div ref={ref} className="site-info" role="dialog" aria-label={t.title}>
      <h2 className="site-info__title">{t.title}</h2>
      {external ? (
        <>
          <dl className="site-info__list">
            <div>
              <dt>{t.realUrl}</dt>
              <dd className="mono selectable" data-testid="real-url">
                {presentation.realUrl}
              </dd>
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
          <p className={`site-info__note${presentation.protocol === 'http:' ? ' is-warning' : ''}`}>
            <Icon name={presentation.protocol === 'http:' ? 'warning' : 'info'} size={14} />
            {presentation.protocol === 'http:' ? t.http : t.https}
          </p>
          {presentation.alias && (
            <p className="site-info__note">
              <Icon name="tag" size={14} />
              {t.aliasNote}
            </p>
          )}
          <div className="site-info__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={copy}>
              <Icon name="copy" size={14} />
              {t.copyRealUrl}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit}>
              <Icon name="edit" size={14} />
              {t.editRealUrl}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mono selectable">{presentation.realUrl}</p>
          <p className="site-info__note">
            <Icon name="info" size={14} />
            {presentation.kind === 'newtab' ? t.newTab : t.internal}
          </p>
        </>
      )}
    </div>
  );
}
