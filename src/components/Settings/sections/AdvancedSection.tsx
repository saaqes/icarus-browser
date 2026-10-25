import { useEffect, useRef, useState } from 'react';
import { useServices } from '../../../app/ServicesContext';
import { useCustomAddresses, useSettings, useShortcuts, useWidgetData } from '../../../hooks/useStores';
import { useMessages } from '../../../i18n';
import { createBackup, downloadTextFile, parseBackup, readFileAsText, type BackupData } from '../../../services/backup/backup';
import { STORAGE_PREFIX } from '../../../services/persistence/keys';
import { estimateUsage } from '../../../services/persistence/storage';
import type { EngineCapabilities } from '../../../services/navigation/engine';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { Icon } from '../../common/Icon';
import { useToast } from '../../common/Toast';
import { useBrowser } from '../../BrowserShell/BrowserContext';
import { CustomAddressManager, type CustomAddressEditorStart } from '../../CustomAddressManager/CustomAddressManager';
import { SettingsCard } from '../SettingsPage';

function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KB`;
}

export function AdvancedSection() {
  const m = useMessages();
  const t = m.settings.advanced;
  const services = useServices();
  const notify = useToast();
  const [settings] = useSettings();
  const [customAddresses] = useCustomAddresses();
  const [shortcuts] = useShortcuts();
  const [widgets] = useWidgetData();
  const [manager, setManager] = useState<{ start: CustomAddressEditorStart | null } | null>(null);
  const { customAddressEditor, clearCustomAddressEditor } = useBrowser();
  const [pendingImport, setPendingImport] = useState<{ data: BackupData; repaired: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const capabilities = services.engine.info.capabilities;
  const activeAddresses = customAddresses.filter((entry) => entry.enabled).length;

  // Petición desde la información del sitio de la barra: abrir el editor en esa entrada o destino.
  useEffect(() => {
    if (!customAddressEditor) return;
    setManager({ start: { editId: customAddressEditor.editId, target: customAddressEditor.target } });
    clearCustomAddressEditor();
  }, [clearCustomAddressEditor, customAddressEditor]);

  const exportAll = () => {
    const content = createBackup({ settings, shortcuts, customAddresses, widgets }, __APP_VERSION__, services.now());
    downloadTextFile(`icarus-configuracion-${services.now().toISOString().slice(0, 10)}.json`, content);
    notify('success', t.exportDone);
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = parseBackup(await readFileAsText(file));
      if (!result.ok) notify('error', t.importErrors[result.error]);
      else setPendingImport({ data: result.data, repaired: result.issues.some((issue) => !issue.endsWith(':missing')) });
    } catch {
      notify('error', t.importErrors.read);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyImport = () => {
    if (!pendingImport) return;
    const { data, repaired } = pendingImport;
    services.settings.set(data.settings);
    services.shortcuts.set(data.shortcuts);
    services.customAddresses.set(data.customAddresses);
    services.widgets.set(data.widgets);
    setPendingImport(null);
    notify('success', t.importDone);
    if (repaired) notify('info', t.importRepaired);
  };

  return (
    <>
      <SettingsCard title={t.presentation}>
        <div className="discreet-row">
          <div>
            <p className="discreet-row__hint">{t.customAddressesHint}</p>
            <p className="discreet-row__meta">{t.activeAddresses(activeAddresses, customAddresses.length)}</p>
          </div>
          <button type="button" className="btn btn--subtle btn--sm" onClick={() => setManager({ start: null })}>
            <Icon name="edit" size={14} />
            {t.customAddressesButton}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title={t.backup} description={t.backupHint}>
        <div className="manager-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={exportAll}>
            <Icon name="download" size={14} />
            {t.exportAll}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={14} />
            {t.importAll}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => onImportFile(event.target.files?.[0])} data-testid="import-config" />
        </div>
      </SettingsCard>

      <SettingsCard title={services.native ? t.experimentalDesktop : t.experimental}>
        <dl className="capabilities">
          <div className="capabilities__row">
            <dt>{t.engine}</dt>
            <dd>{services.engine.info.name}</dd>
          </div>
          {(Object.keys(capabilities) as Array<keyof EngineCapabilities>).map((key) => (
            <div key={key} className="capabilities__row">
              <dt>{t.capabilities[key]}</dt>
              <dd className={capabilities[key] ? 'is-yes' : 'is-no'}>{capabilities[key] ? t.available : t.unavailable}</dd>
            </div>
          ))}
        </dl>
        <ul className="notes-list">
          {(services.native ? t.notesDesktop : t.notes).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </SettingsCard>

      <SettingsCard title={t.storage}>
        <p className={`info-box${services.storage.kind === 'memory' ? ' info-box--warning' : ''}`}>
          <Icon name={services.storage.kind === 'memory' ? 'warning' : 'database'} size={16} />
          {services.storage.kind === 'memory'
            ? t.storageMemory
            : services.native
              ? t.storageNative(services.native.dataDirectory)
              : t.storageLocal(formatBytes(estimateUsage(services.storage, STORAGE_PREFIX), m.locale))}
        </p>
      </SettingsCard>

      {manager && <CustomAddressManager start={manager.start} onClose={() => setManager(null)} />}
      <ConfirmDialog
        open={pendingImport !== null}
        title={t.importConfirmTitle}
        message={t.importConfirmBody}
        confirmLabel={m.common.import}
        onCancel={() => setPendingImport(null)}
        onConfirm={applyImport}
      />
    </>
  );
}
