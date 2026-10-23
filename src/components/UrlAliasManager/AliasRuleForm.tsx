import { useMessages } from '../../i18n';
import type { AliasFieldErrors } from '../../services/alias-rules';
import { ALIAS_MATCH_TYPES, type AliasMatchType, type AliasRuleInput } from '../../types/alias';
import { Field, Toggle } from '../common/Controls';
import { Icon } from '../common/Icon';
import { AliasPreview } from './AliasPreview';

interface AliasRuleFormProps {
  mode: 'create' | 'edit';
  draft: AliasRuleInput;
  errors: AliasFieldErrors;
  dirty: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  onChange: (patch: Partial<AliasRuleInput>) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** Formulario de una regla. La URL real y el alias visual van en campos separados. */
export function AliasRuleForm({ mode, draft, errors, dirty, createdAt, updatedAt, onChange, onSave, onCancel }: AliasRuleFormProps) {
  const m = useMessages();
  const t = m.aliasManager.form;
  const error = (field: keyof AliasRuleInput) => (errors[field] ? m.aliasManager.errors[errors[field]!] : null);

  return (
    <form
      className="alias-form"
      noValidate
      aria-label={mode === 'create' ? t.createTitle : t.editTitle}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <header className="alias-form__header">
        <h3>{mode === 'create' ? t.createTitle : t.editTitle}</h3>
        {dirty && <span className="unsaved-badge">{t.unsaved}</span>}
      </header>
      {(createdAt || updatedAt) && (
        <p className="alias-form__dates">
          {createdAt && m.aliasManager.createdOn(createdAt)}
          {updatedAt && ` · ${m.aliasManager.updatedOn(updatedAt)}`}
        </p>
      )}

      <Field label={t.name} error={error('name')}>
        {(props) => (
          <input {...props} className="input" value={draft.name} placeholder={t.namePlaceholder} maxLength={80} data-autofocus onChange={(e) => onChange({ name: e.target.value })} />
        )}
      </Field>

      <fieldset className="alias-form__group">
        <legend>{t.realSection}</legend>
        <p className="field-label" id="alias-match-label">
          {t.matchType}
        </p>
        <div className="segmented__options alias-form__match" role="radiogroup" aria-labelledby="alias-match-label">
          {ALIAS_MATCH_TYPES.map((type: AliasMatchType) => (
            <label key={type} className={`segmented__option${draft.matchType === type ? ' is-selected' : ''}`}>
              <input type="radio" name="alias-match-type" value={type} checked={draft.matchType === type} onChange={() => onChange({ matchType: type })} />
              <span>{t.matchTypes[type]}</span>
            </label>
          ))}
        </div>
        <Field label={t.pattern} hint={t.matchHints[draft.matchType]} error={error('pattern')}>
          {(props) => (
            <input
              {...props}
              className="input mono"
              value={draft.pattern}
              placeholder={t.patternPlaceholders[draft.matchType]}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => onChange({ pattern: e.target.value })}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="alias-form__group">
        <legend>{m.aliasManager.preview.alias}</legend>
        <Field label={t.displayName} hint={t.displayNameHint} error={error('displayName')}>
          {(props) => (
            <input {...props} className="input" value={draft.displayName} placeholder={t.displayNamePlaceholder} maxLength={80} onChange={(e) => onChange({ displayName: e.target.value })} />
          )}
        </Field>
        <Field label={t.alias} hint={t.aliasHint} error={error('alias')}>
          {(props) => (
            <input
              {...props}
              className="input mono"
              value={draft.alias}
              placeholder={t.aliasPlaceholder}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => onChange({ alias: e.target.value })}
            />
          )}
        </Field>
      </fieldset>

      <Field label={t.targetUrl} hint={t.targetHint} error={error('targetUrl')}>
        {(props) => (
          <div className="input-with-action">
            <input
              {...props}
              className="input mono"
              value={draft.targetUrl}
              placeholder={t.targetPlaceholder}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => onChange({ targetUrl: e.target.value })}
            />
            {draft.matchType !== 'host' && draft.pattern.trim() && draft.pattern !== draft.targetUrl && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ targetUrl: draft.pattern })}>
                {t.useTargetFromPattern}
              </button>
            )}
          </div>
        )}
      </Field>

      <Toggle label={t.enabled} checked={draft.enabled} onChange={(enabled) => onChange({ enabled })} />

      <AliasPreview draft={draft} />

      <div className="alias-form__actions">
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
