/** Barra informativa bajo la barra de herramientas: solicitudes de permisos y avisos. */

import { useMessages } from '../../i18n';
import { Icon } from '../common/Icon';
import { ToastViewport } from '../common/Toast';
import { useBrowser } from './BrowserContext';

export function Infobar() {
  const m = useMessages();
  const t = m.permissions;
  const { permissionRequests, respondPermission, activeTab } = useBrowser();
  const request = permissionRequests.find((item) => item.tabId === activeTab.id);
  return (
    <div className="infobar">
      {request && (
        <div className="permission-bar" role="alertdialog" aria-labelledby={`perm-${request.id}`}>
          <Icon name="info" size={16} />
          <p id={`perm-${request.id}`}>
            <strong>{request.origin}</strong> {t.wants[request.permission](request.mediaTypes)}
          </p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => respondPermission(request.id, false)}>
            {t.block}
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => respondPermission(request.id, true)}>
            {t.allow}
          </button>
        </div>
      )}
      <ToastViewport inline />
    </div>
  );
}
