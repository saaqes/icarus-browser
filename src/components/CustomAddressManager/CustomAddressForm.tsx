import { useMemo } from 'react';
import { useHistoryItems } from '../../hooks/useNative';
import { useShortcuts } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import {
  displayUrlFor,
  formatLocation,
  formatSections,
  locationLabel,
  normalizeLocationInput,
  parseSections,
  shortAddress,
  type CustomAddressConflicts,
  type CustomAddressErrors,
} from '../../services/custom-addresses';
import { getCurrentEntry } from '../../services/tabs/tabs';
import { parseWebUrl } from '../../services/url-resolution/urlUtils';
import type { CustomAddress, CustomAddressInput } from '../../types/customAddress';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Field, Toggle } from '../common/Controls';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';

interface CustomAddressFormProps {
  mode: 'create' | 'edit';
  draft: CustomAddressInput;
  errors: CustomAddressErrors;
  conflicts: CustomAddressConflicts;
  dirty: boolean;
  entries: CustomAddress[];
  editingId: string | null;
  onChange: (patch: Partial<CustomAddressInput>) => void;
  onSave: () => void;
  onCancel: () => void;
}

interface DestinationOption {
  target: string;
  label: string;
  host: string;
  source: 'tab' | 'shortcut' | 'history';
}

const MAX_OPTIONS = 8;

/** Páginas que el usuario ya tiene a mano: pestañas abiertas, accesos directos e historial reciente. */
function useDestinationOptions(entries: CustomAddress[], editingId: string | null): DestinationOption[] {
  const { session, webState } = useBrowser();
  const [shortcuts] = useShortcuts();
  const { items: history } = useHistoryItems();
  return useMemo(() => {
    const used = new Set(entries.filter((entry) => entry.id !== editingId).map((entry) => entry.target));
    const options: DestinationOption[] = [];
    const add = (href: string, label: string, source: DestinationOption['source']) => {
      const url = parseWebUrl(href);
      if (!url || options.length >= MAX_OPTIONS) return;
      const target = `${url.origin}/`;
      if (used.has(target) || options.some((option) => option.target === target)) return;
      options.push({ target, label: label.trim() || url.host, host: url.host, source });
    };
    for (const tab of session.tabs) {
      const page = getCurrentEntry(tab).page;
      if (page.kind === 'web') add(webState[tab.id]?.url || page.url, webState[tab.id]?.title || page.title || '', 'tab');
    }
    shortcuts.forEach((shortcut) => add(shortcut.url, shortcut.title, 'shortcut'));
    history.slice(0, 50).forEach((item) => add(item.url, item.title, 'history'));
    return options;
  }, [editingId, entries, history, session.tabs, shortcuts, webState]);
}

/** Formulario: destino real, dirección personalizada y vista previa del resultado. */
export function CustomAddressForm({
  mode,
  draft,
  errors,
  conflicts,
  dirty,
  entries,
  editingId,
  onChange,
  onSave,
  onCancel,
}: CustomAddressFormProps) {
  const m = useMessages();
  const t = m.customAddresses.form;
  const options = useDestinationOptions(entries, editingId);
  const message = (field: 'target' | 'address' | 'sections') => {
    const code = errors[field];
    if (!code) return null;
    const other = conflicts[field];
    return m.customAddresses.errors[code](other ? shortAddress(other.address) : '', other ? shortAddress(other.target) : '');
  };

  const target = normalizeLocationInput(draft.target);
  const address = normalizeLocationInput(draft.address, target.ok ? target.location.protocol : undefined);
  const sections = parseSections(draft.sections ?? '');
  const preview =
    target.ok && address.ok && sections.ok && address.location.protocol === target.location.protocol
      ? { target: formatLocation(target.location), address: formatLocation(address.location), label: locationLabel(target.location), sections: sections.sections }
      : null;
  // Ejemplo de ruta (con la primera sección, si hay) tal como lo mostraría la barra.
  const example = preview ? `${preview.target.replace(/\/$/, '')}/ruta?x=1${preview.sections[0] ? `#${preview.sections[0]}` : ''}` : '';
  const exampleShown = preview
    ? displayUrlFor(example, [{ id: 'vista-previa', target: preview.target, address: preview.address, sections: preview.sections, enabled: true, createdAt: '', updatedAt: '' }])?.url ?? example
    : '';

  return (
    <form
      className="address-form"
      noValidate
      aria-label={mode === 'create' ? t.createTitle : t.editTitle}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <header className="address-form__header">
        <h3>{mode === 'create' ? t.createTitle : t.editTitle}</h3>
        {dirty && <span className="unsaved-badge">{t.unsaved}</span>}
      </header>

      <Field label={t.target} hint={t.targetHint} error={message('target')}>
        {(props) => (
          <input
            {...props}
            className="input mono"
            value={draft.target}
            placeholder={t.targetPlaceholder}
            spellCheck={false}
            autoCapitalize="off"
            data-autofocus={mode === 'create' && !draft.target ? true : undefined}
            onChange={(event) => onChange({ target: event.target.value })}
          />
        )}
      </Field>
      {options.length > 0 && (
        <div className="address-form__options">
          <p className="field-hint">{t.chooseFrom}</p>
          <ul aria-label={t.chooseFrom}>
            {options.map((option) => (
              <li key={option.target}>
                <button
                  type="button"
                  className={`destination-chip${draft.target === option.target ? ' is-selected' : ''}`}
                  title={`${t.sources[option.source]} · ${option.host}`}
                  onClick={() => onChange({ target: option.target })}
                >
                  <Favicon url={option.target} label={option.label} size={14} />
                  <span className="destination-chip__label">{option.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Field label={t.address} hint={t.addressHint} error={message('address')}>
        {(props) => (
          <input
            {...props}
            className="input mono"
            value={draft.address}
            placeholder={t.addressPlaceholder}
            spellCheck={false}
            autoCapitalize="off"
            data-autofocus={mode === 'create' && draft.target ? true : undefined}
            onChange={(event) => onChange({ address: event.target.value })}
          />
        )}
      </Field>

      <Field label={t.sections} hint={t.sectionsHint} error={message('sections')}>
        {(props) => (
          <input
            {...props}
            className="input mono"
            value={draft.sections ?? ''}
            placeholder={t.sectionsPlaceholder}
            spellCheck={false}
            autoCapitalize="off"
            onChange={(event) => onChange({ sections: event.target.value })}
          />
        )}
      </Field>

      <section className={`address-preview${draft.enabled ? '' : ' is-inactive'}`} aria-label={t.preview}>
        <h4>{t.preview}</h4>
        {preview ? (
          <>
            <div className="address-preview__bar" data-testid="address-preview">
              <Icon name={preview.address.startsWith('http:') ? 'warning' : 'sliders'} size={14} />
              {preview.address.startsWith('http:') && <span className="address-preview__insecure">{m.addressBar.notSecure}</span>}
              <span>{shortAddress(preview.address)}</span>
            </div>
            <ul className="address-preview__facts">
              <li>{t.previewShows(preview.label, shortAddress(preview.address))}</li>
              <li>{t.previewOpens(shortAddress(preview.address), preview.label)}</li>
              <li>{t.previewPaths(shortAddress(example), shortAddress(exampleShown))}</li>
              {preview.sections.length > 0 && <li>{t.previewSections(formatSections(preview.sections))}</li>}
            </ul>
          </>
        ) : (
          <p className="field-hint">{t.previewIncomplete}</p>
        )}
        <p className="address-preview__note">
          <Icon name="info" size={14} />
          {t.limitation}
        </p>
      </section>

      <Toggle label={t.enabled} checked={draft.enabled} onChange={(enabled) => onChange({ enabled })} />

      <div className="address-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {m.common.cancel}
        </button>
        <button type="submit" className="btn btn--primary">
          <Icon name="check" size={16} />
          {mode === 'create' ? m.common.save : m.common.saveChanges}
        </button>
      </div>
    </form>
  );
}
