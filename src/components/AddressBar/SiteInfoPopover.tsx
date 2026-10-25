import { useRef, type RefObject } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { useMessages } from '../../i18n';
import { formatAddress } from '../../services/custom-addresses/display';
import type { PagePresentation } from '../../services/tabs/pages';
import { parseWebUrl } from '../../services/url-resolution/urlUtils';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon } from '../common/Icon';
import { useToast } from '../common/Toast';

/**
 * Estado de la conexión que indica la barra:
 * - secure: HTTPS con certificado aceptado por Chromium (aplicación de escritorio).
 * - unverified: HTTPS abierto en el navegador del sistema (versión web): ICARUS no lo verifica.
 * - insecure: HTTP. dangerous: certificado no válido. internal: página de ICARUS.
 */
export type SecurityState = 'secure' | 'unverified' | 'insecure' | 'dangerous' | 'internal';

interface SiteInfoPopoverProps {
  presentation: PagePresentation;
  security: SecurityState;
  /** Dirección que muestra la barra. */
  addressUrl: string;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * Información del sitio, como el panel del icono de la barra en Chrome: estado real
 * de la conexión y, si se muestra una dirección personalizada, a qué sitio van de
 * verdad las solicitudes (nunca se oculta al pedir la información de seguridad).
 */
export function SiteInfoPopover({ presentation, security, addressUrl, anchorRef, onClose }: SiteInfoPopoverProps) {
  const m = useMessages();
  const t = m.addressBar.info;
  const notify = useToast();
  const { openCustomAddressEditor } = useBrowser();
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, true, onClose, anchorRef);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(addressUrl);
      notify('success', t.copied);
    } catch {
      notify('error', t.copyFailed);
    }
  };

  if (presentation.kind !== 'web') {
    return (
      <div ref={ref} className="site-info" role="dialog" aria-label={t.title}>
        <h2 className="site-info__title">{addressUrl}</h2>
        <p className="site-info__note">
          <Icon name="info" size={14} />
          {presentation.kind === 'newtab' ? t.newTab : t.internal}
        </p>
      </div>
    );
  }

  const shownHost = formatAddress(addressUrl, false).host;
  const realHost = presentation.hostname ?? '';
  const realOrigin = parseWebUrl(presentation.realUrl)?.origin ?? null;
  const custom = security === 'dangerous' ? null : presentation.customAddress;
  const connection = {
    secure: { icon: 'lock' as const, title: t.secureTitle, body: t.secureBody(realHost), warn: false },
    unverified: { icon: 'info' as const, title: t.unverifiedTitle, body: t.unverifiedBody, warn: false },
    insecure: { icon: 'warning' as const, title: t.insecureTitle, body: t.insecureBody, warn: true },
    dangerous: { icon: 'warning' as const, title: t.insecureTitle, body: t.dangerousBody(realHost), warn: true },
    internal: { icon: 'info' as const, title: '', body: '', warn: false },
  }[security];

  return (
    <div ref={ref} className="site-info" role="dialog" aria-label={t.title}>
      <h2 className="site-info__title">{shownHost}</h2>
      <div className={`site-info__section${connection.warn ? ' is-warning' : ''}`} data-testid="site-connection">
        <Icon name={connection.icon} size={16} />
        <div>
          <p className="site-info__heading">{connection.title}</p>
          <p className="site-info__text">{connection.body}</p>
        </div>
      </div>
      {custom && (
        <div className="site-info__section" data-testid="site-custom-address">
          <Icon name="globe" size={16} />
          <div>
            <p className="site-info__heading">{t.customTitle}</p>
            <p className="site-info__text">{t.customBody(shownHost, realHost)}</p>
          </div>
        </div>
      )}
      <div className="site-info__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={copy}>
          <Icon name="copy" size={14} />
          {t.copyAddress}
        </button>
        {realOrigin && security !== 'dangerous' && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              onClose();
              openCustomAddressEditor(custom ? { editId: custom.id } : { target: `${realOrigin}/` });
            }}
          >
            <Icon name="edit" size={14} />
            {custom ? t.editCustom : t.customize}
          </button>
        )}
      </div>
    </div>
  );
}
