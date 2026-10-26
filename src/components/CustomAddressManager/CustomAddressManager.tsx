/**
 * Editor de direcciones personalizadas (Configuración → Avanzado → «Personalizar
 * direcciones URL», o desde la información del sitio en la barra).
 *
 * Lista cada dirección con su destino, y permite crear, editar, activar o
 * desactivar, eliminar, importar y exportar. Los conflictos se muestran en el
 * campo afectado nombrando la otra entrada: nunca se sobrescribe otra
 * configuración en silencio.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useCustomAddresses } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import {
  createCustomAddress,
  deleteCustomAddress,
  emptyCustomAddressInput,
  exportCustomAddresses,
  filterCustomAddresses,
  formatSections,
  mergeImportedCustomAddresses,
  parseCustomAddressFile,
  setCustomAddressEnabled,
  shortAddress,
  toCustomAddressInput,
  updateCustomAddress,
  type CustomAddressConflicts,
  type CustomAddressErrors,
} from '../../services/custom-addresses';
import { downloadTextFile, readFileAsText } from '../../services/backup/backup';
import type { CustomAddress, CustomAddressInput } from '../../types/customAddress';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Toggle } from '../common/Controls';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';
import { useToast } from '../common/Toast';
import { CustomAddressForm } from './CustomAddressForm';
import './CustomAddressManager.css';

type EditorState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; id: string };

/** Qué abrir al mostrar el editor (p. ej. desde la información del sitio). */
export interface CustomAddressEditorStart {
  editId?: string;
  target?: string;
}

function sameInput(a: CustomAddressInput, b: CustomAddressInput): boolean {
  return a.target === b.target && a.address === b.address && (a.sections ?? '') === (b.sections ?? '') && a.enabled === b.enabled;
}

const SEARCH_THRESHOLD = 6;

export function CustomAddressManager({ onClose, start }: { onClose: () => void; start?: CustomAddressEditorStart | null }) {
  const m = useMessages();
  const t = m.customAddresses;
  const services = useServices();
  const notify = useToast();
  const [entries, setEntries] = useCustomAddresses();
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [draft, setDraft] = useState<CustomAddressInput>(emptyCustomAddressInput);
  const [errors, setErrors] = useState<CustomAddressErrors>({});
  const [conflicts, setConflicts] = useState<CustomAddressConflicts>({});
  const [deleting, setDeleting] = useState<CustomAddress | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => filterCustomAddresses(entries, query), [entries, query]);
  const editing = editor.mode === 'edit' ? entries.find((entry) => entry.id === editor.id) ?? null : null;
  const original = editing ? toCustomAddressInput(editing) : emptyCustomAddressInput();
  const dirty = editor.mode !== 'closed' && !sameInput(draft, original);

  const openEditor = (next: EditorState, initial?: Partial<CustomAddressInput>) => {
    setEditor(next);
    setErrors({});
    setConflicts({});
    if (next.mode === 'edit') {
      const entry = entries.find((item) => item.id === next.id);
      setDraft(entry ? toCustomAddressInput(entry) : emptyCustomAddressInput());
    } else {
      setDraft({ ...emptyCustomAddressInput(), ...initial });
    }
  };

  // Al abrirse desde la barra: editar la entrada del sitio actual o empezar una con su destino.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !start) return;
    started.current = true;
    if (start.editId && entries.some((entry) => entry.id === start.editId)) openEditor({ mode: 'edit', id: start.editId });
    else openEditor({ mode: 'create' }, { target: start.target ?? '' });
  }, [start]);

  /** Ejecuta una acción, pidiendo confirmación si hay cambios sin guardar. */
  const guard = (action: () => void) => {
    if (dirty) setPendingAction(() => action);
    else action();
  };

  const save = () => {
    const now = services.now();
    const result =
      editor.mode === 'edit' ? updateCustomAddress(entries, editor.id, draft, now) : createCustomAddress(entries, draft, { id: services.createId(), now });
    if (!result.ok) {
      setErrors(result.errors);
      setConflicts(result.conflicts);
      notify('error', result.limit ? t.limit : t.form.fixErrors);
      return;
    }
    setEntries(result.entries);
    setErrors({});
    setConflicts({});
    setEditor({ mode: 'edit', id: result.entry.id });
    setDraft(toCustomAddressInput(result.entry));
    notify('success', editor.mode === 'edit' ? t.saved : t.created(shortAddress(result.entry.address)));
  };

  const toggle = (entry: CustomAddress, enabled: boolean) => {
    const result = setCustomAddressEnabled(entries, entry.id, enabled, services.now());
    if (!result.ok) {
      notify('error', t.toggleConflict(shortAddress(result.conflictWith.address), shortAddress(result.conflictWith.target)));
      return;
    }
    setEntries(result.entries);
    if (editor.mode === 'edit' && editor.id === entry.id) setDraft((current) => ({ ...current, enabled }));
    notify('success', enabled ? t.enabledToast(shortAddress(entry.address)) : t.disabledToast(shortAddress(entry.address)));
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseCustomAddressFile(await readFileAsText(file));
      if (!parsed.ok) {
        notify('error', t.importErrors[parsed.error]);
        return;
      }
      const summary = mergeImportedCustomAddresses(services.customAddresses.getSnapshot(), parsed.items, { now: services.now() });
      setEntries(summary.entries);
      notify('success', t.importDone(summary.added, summary.updated));
      if (summary.skipped) notify('info', t.importSkipped(summary.skipped));
      if (summary.disabled) notify('info', t.importDisabled(summary.disabled));
    } catch {
      notify('error', t.importErrors.read);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Modal open title={t.title} onClose={() => guard(onClose)} size="lg" className="address-manager" description={t.subtitle}>
      <div className="address-manager__toolbar">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => guard(() => openEditor({ mode: 'create' }))}>
          <Icon name="plus" size={14} />
          {t.add}
        </button>
        {entries.length > SEARCH_THRESHOLD && (
          <label className="address-manager__search">
            <Icon name="search" size={16} />
            <span className="visually-hidden">{t.searchLabel}</span>
            <input type="search" className="input" placeholder={t.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        )}
        <span className="address-manager__spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => downloadTextFile('icarus-direcciones.json', exportCustomAddresses(entries, services.now()))} disabled={entries.length === 0}>
          <Icon name="download" size={14} />
          {m.common.export}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} />
          {m.common.import}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => importFile(event.target.files?.[0])} data-testid="import-addresses" />
      </div>

      <div className="address-manager__layout">
        <div className="address-manager__list-column">
          {visible.length === 0 ? (
            <p className="address-manager__empty">{entries.length === 0 ? t.empty : t.noResults}</p>
          ) : (
            <ul className="address-list" aria-label={t.listLabel}>
              {visible.map((entry) => {
                const selected = editor.mode === 'edit' && editor.id === entry.id;
                const address = shortAddress(entry.address);
                const target = shortAddress(entry.target);
                return (
                  <li key={entry.id} className={`address-row${selected ? ' is-selected' : ''}${entry.enabled ? '' : ' is-disabled'}`}>
                    <button type="button" className="address-row__main" onClick={() => guard(() => openEditor({ mode: 'edit', id: entry.id }))} aria-label={t.editEntry(address)}>
                      <Favicon url={entry.target} label={address} size={18} />
                      <span className="address-row__text">
                        <span className="address-row__address">{address}</span>
                        <span className="address-row__target">{t.targetOf(target)}</span>
                        {entry.sections?.length ? <span className="address-row__sections">{t.sectionsOf(formatSections(entry.sections))}</span> : null}
                        {!entry.enabled && <span className="address-row__state">{t.disabled}</span>}
                      </span>
                    </button>
                    <div className="address-row__actions">
                      <Toggle label={t.toggle(address)} hideLabel checked={entry.enabled} onChange={(enabled) => toggle(entry, enabled)} />
                      <button type="button" className="icon-btn icon-btn--sm icon-btn--danger" aria-label={t.deleteEntry(address)} title={t.deleteEntry(address)} onClick={() => setDeleting(entry)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="address-manager__editor-column">
          {editor.mode === 'closed' ? (
            <section className="address-howto" aria-label={t.howTo.title}>
              <h3>{t.howTo.title}</h3>
              <ol>
                {t.howTo.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="field-hint">{t.howTo.security}</p>
            </section>
          ) : (
            <CustomAddressForm
              mode={editor.mode}
              draft={draft}
              errors={errors}
              conflicts={conflicts}
              dirty={dirty}
              entries={entries}
              editingId={editor.mode === 'edit' ? editor.id : null}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              onSave={save}
              onCancel={() => guard(() => openEditor({ mode: 'closed' }))}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={t.deleteTitle}
        message={deleting ? t.deleteBody(shortAddress(deleting.address), shortAddress(deleting.target)) : ''}
        confirmLabel={m.common.delete}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            setEntries(deleteCustomAddress(entries, deleting.id));
            if (editor.mode === 'edit' && editor.id === deleting.id) openEditor({ mode: 'closed' });
            notify('success', t.deleted);
          }
          setDeleting(null);
        }}
      />
      <ConfirmDialog
        open={pendingAction !== null}
        title={t.discardTitle}
        message={t.discardBody}
        confirmLabel={m.common.discard}
        cancelLabel={m.common.keepEditing}
        danger
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          setDraft(original);
          action?.();
        }}
      />
    </Modal>
  );
}
