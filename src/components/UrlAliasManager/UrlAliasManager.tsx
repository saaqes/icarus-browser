/**
 * Administrador «Cambiar nombre de URL» (Configuración → Avanzado).
 * Crear, editar, activar/desactivar, buscar, probar, eliminar (con confirmación),
 * importar/exportar y restaurar reglas de alias visual.
 */

import { useMemo, useRef, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useAliasRules } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import {
  conflictsForRule,
  createAliasRule,
  createDefaultAliasRules,
  deleteAliasRule,
  detectConflicts,
  emptyAliasRuleInput,
  exportAliasRules,
  filterAliasRules,
  mergeImportedRules,
  parseAliasRulesFile,
  setAliasRuleEnabled,
  toRuleInput,
  updateAliasRule,
  type AliasFieldErrors,
} from '../../services/alias-rules';
import { downloadTextFile, readFileAsText } from '../../services/backup/backup';
import type { AliasRule, AliasRuleInput } from '../../types/alias';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Toggle } from '../common/Controls';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';
import { useToast } from '../common/Toast';
import { AliasConflicts } from './AliasConflicts';
import { AliasRuleForm } from './AliasRuleForm';
import { AliasTester } from './AliasTester';
import './UrlAliasManager.css';

type EditorState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; id: string };

function sameInput(a: AliasRuleInput, b: AliasRuleInput): boolean {
  return (Object.keys(a) as Array<keyof AliasRuleInput>).every((key) => a[key] === b[key]);
}

export function UrlAliasManager({ onClose }: { onClose: () => void }) {
  const m = useMessages();
  const t = m.aliasManager;
  const services = useServices();
  const notify = useToast();
  const [rules, setRules] = useAliasRules();
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [draft, setDraft] = useState<AliasRuleInput>(emptyAliasRuleInput);
  const [errors, setErrors] = useState<AliasFieldErrors>({});
  const [deleting, setDeleting] = useState<AliasRule | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const conflicts = useMemo(() => detectConflicts(rules), [rules]);
  const visible = useMemo(() => filterAliasRules(rules, query), [rules, query]);
  const editingRule = editor.mode === 'edit' ? rules.find((rule) => rule.id === editor.id) ?? null : null;
  const original = editingRule ? toRuleInput(editingRule) : emptyAliasRuleInput();
  const dirty = editor.mode !== 'closed' && !sameInput(draft, original);
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(m.locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  /** Ejecuta una acción, pidiendo confirmación si hay cambios sin guardar. */
  const guard = (action: () => void) => {
    if (dirty) setPendingAction(() => action);
    else action();
  };

  const openEditor = (next: EditorState) => {
    setEditor(next);
    setErrors({});
    if (next.mode === 'edit') {
      const rule = rules.find((item) => item.id === next.id);
      setDraft(rule ? toRuleInput(rule) : emptyAliasRuleInput());
    } else {
      setDraft(emptyAliasRuleInput());
    }
  };

  const save = () => {
    const now = services.now();
    const result =
      editor.mode === 'edit'
        ? updateAliasRule(rules, editor.id, draft, now)
        : createAliasRule(rules, draft, { id: services.createId(), now });
    if (!result.ok) {
      setErrors(result.errors);
      notify('error', result.limit ? t.limit : t.form.fixErrors);
      return;
    }
    setRules(result.rules);
    setErrors({});
    setEditor({ mode: 'edit', id: result.rule.id });
    setDraft(toRuleInput(result.rule));
    notify('success', editor.mode === 'edit' ? t.saved : t.created);
  };

  const toggle = (rule: AliasRule, enabled: boolean) => {
    const result = setAliasRuleEnabled(rules, rule.id, enabled, services.now());
    if (!result.ok) {
      notify('error', t.toggleConflict(result.conflictWith.name));
      return;
    }
    setRules(result.rules);
    if (editor.mode === 'edit' && editor.id === rule.id) setDraft((current) => ({ ...current, enabled }));
    notify('success', enabled ? t.enabledToast(rule.name) : t.disabledToast(rule.name));
  };

  const exportRules = () => {
    downloadTextFile('icarus-reglas-alias.json', exportAliasRules(rules, services.now()));
    notify('success', t.exportDone);
  };

  const importRules = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseAliasRulesFile(await readFileAsText(file));
      if (!parsed.ok) {
        notify('error', t.importErrors[parsed.error]);
        return;
      }
      const summary = mergeImportedRules(services.aliasRules.getSnapshot(), parsed.items, {
        now: services.now(),
        createId: services.createId,
      });
      setRules(summary.rules);
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
    <Modal open title={t.title} onClose={() => guard(onClose)} size="full" className="alias-manager" description={t.subtitle}>
      <div className="alias-manager__toolbar">
        <label className="alias-manager__search">
          <Icon name="search" size={16} />
          <span className="visually-hidden">{t.searchLabel}</span>
          <input type="search" className="input" placeholder={t.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => guard(() => openEditor({ mode: 'create' }))}>
          <Icon name="plus" size={14} />
          {t.newRule}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={exportRules}>
          <Icon name="download" size={14} />
          {m.common.export}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} />
          {m.common.import}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => importRules(event.target.files?.[0])} data-testid="import-rules" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => guard(() => setRestoring(true))}>
          <Icon name="restore" size={14} />
          {t.restoreDefaults}
        </button>
      </div>

      <div className="alias-manager__layout">
        <div className="alias-manager__list-column">
          <p className="alias-manager__count">{t.count(visible.length, rules.length)}</p>
          {visible.length === 0 ? (
            <p className="widget-empty">{rules.length === 0 ? t.empty : t.noResults}</p>
          ) : (
            <ul className="alias-list" aria-label={t.listLabel}>
              {visible.map((rule) => {
                const ruleConflicts = conflictsForRule(rule.id, conflicts);
                const selected = editor.mode === 'edit' && editor.id === rule.id;
                return (
                  <li key={rule.id} className={`alias-row${selected ? ' is-selected' : ''}${rule.enabled ? '' : ' is-disabled'}`}>
                    <div className="alias-row__main">
                      <p className="alias-row__name">
                        {rule.name}
                        {ruleConflicts.length > 0 && (
                          <span className="conflict-badge" title={t.conflicts.title}>
                            <Icon name="warning" size={12} />
                            {t.conflictBadge}
                          </span>
                        )}
                      </p>
                      <p className="alias-row__mapping">
                        <span className="alias-chip">
                          <Icon name="tag" size={12} />
                          {rule.alias}
                        </span>
                        <span className="alias-row__pattern mono" title={rule.pattern}>
                          {t.form.matchTypes[rule.matchType]}: {rule.pattern}
                        </span>
                      </p>
                      <p className="alias-row__date">{t.updatedOn(formatDate(rule.updatedAt))}</p>
                    </div>
                    <div className="alias-row__actions">
                      <Toggle label={t.toggle(rule.name)} hideLabel checked={rule.enabled} onChange={(enabled) => toggle(rule, enabled)} />
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm"
                        aria-label={t.editRule(rule.name)}
                        title={t.editRule(rule.name)}
                        onClick={() => guard(() => openEditor({ mode: 'edit', id: rule.id }))}
                      >
                        <Icon name="edit" size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm icon-btn--danger"
                        aria-label={t.deleteRule(rule.name)}
                        title={t.deleteRule(rule.name)}
                        onClick={() => setDeleting(rule)}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <AliasConflicts rules={rules} conflicts={conflicts} />
        </div>

        <div className="alias-manager__editor-column">
          {editor.mode === 'closed' ? (
            <AliasTester rules={rules} />
          ) : (
            <AliasRuleForm
              mode={editor.mode}
              draft={draft}
              errors={errors}
              dirty={dirty}
              createdAt={editingRule ? formatDate(editingRule.createdAt) : null}
              updatedAt={editingRule ? formatDate(editingRule.updatedAt) : null}
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
        message={deleting ? t.deleteBody(deleting.name) : ''}
        confirmLabel={m.common.delete}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            setRules(deleteAliasRule(rules, deleting.id));
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
      <ConfirmDialog
        open={restoring}
        title={t.restoreTitle}
        message={t.restoreBody}
        confirmLabel={m.common.restore}
        danger
        onCancel={() => setRestoring(false)}
        onConfirm={() => {
          setRules(createDefaultAliasRules(services.now()));
          openEditor({ mode: 'closed' });
          setRestoring(false);
          notify('success', t.restored);
        }}
      />
    </Modal>
  );
}
