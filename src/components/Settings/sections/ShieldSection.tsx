import { useEffect, useState } from 'react';
import { useNative, useShieldState } from '../../../hooks/useNative';
import { useMessages } from '../../../i18n';
import { Field, Toggle } from '../../common/Controls';
import { Icon } from '../../common/Icon';
import { useToast } from '../../common/Toast';
import { SettingsCard } from '../SettingsPage';

export function ShieldSection() {
  const m = useMessages();
  const t = m.shield.settings;
  const native = useNative();
  const notify = useToast();
  const [state, setState] = useShieldState();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [rules, setRules] = useState('');
  const [rulesDirty, setRulesDirty] = useState(false);

  useEffect(() => {
    if (state && !rulesDirty) setRules(state.customRules);
  }, [state, rulesDirty]);

  if (!native || !state) return null;
  const updating = state.lists.some((list) => list.updating);
  const formatDate = (time: number) => new Date(time).toLocaleString(m.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <SettingsCard title={m.shield.name} description={t.intro}>
        <Toggle label={t.enabled} checked={state.enabled} onChange={(enabled) => void native.shield.setEnabled(enabled).then(setState)} />
        <p className="field-hint" data-testid="shield-stats">
          {t.stats(state.activeRuleCount, state.totalBlocked)}
        </p>
      </SettingsCard>

      <SettingsCard title={t.lists} description={t.listsHint}>
        <ul className="manager-list" aria-label={t.lists}>
          {state.lists.map((list) => (
            <li key={list.id} className="manager-row">
              <span className="manager-row__text">
                <span className="manager-row__title">{list.name}</span>
                <span className="manager-row__detail">
                  {list.url ? list.url : t.builtIn}
                </span>
                <span className="manager-row__detail">
                  {list.ruleCount > 0 ? t.rules(list.ruleCount) : ''}
                  {list.url && (list.lastUpdated ? ` · ${t.lastUpdated(formatDate(list.lastUpdated))}` : ` · ${t.neverUpdated}`)}
                  {list.updating && ` · ${t.updating}`}
                </span>
                {list.error && (
                  <span className="field-error">
                    <Icon name="warning" size={14} />
                    {t.errors[list.error]}
                  </span>
                )}
              </span>
              <span className="manager-row__actions">
                <Toggle label={t.toggle(list.name)} hideLabel checked={list.enabled} onChange={(enabled) => void native.shield.setListEnabled(list.id, enabled).then(setState)} />
                {!list.builtIn && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm icon-btn--danger"
                    aria-label={t.remove(list.name)}
                    onClick={() => void native.shield.removeList(list.id).then(setState)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={updating}
            onClick={() =>
              void native.shield.updateLists().then((next) => {
                setState(next);
                notify(next.lists.some((list) => list.enabled && list.error) ? 'info' : 'success', t.updated);
              })
            }
          >
            <Icon name="reload" size={14} />
            {updating ? t.updating : t.update}
          </button>
        </div>
        <form
          className="shield-add"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setAdding(true);
            setAddError(null);
            void native.shield
              .addList(name, url)
              .then((result) => {
                if (result.ok) {
                  setState(result.state);
                  setName('');
                  setUrl('');
                  notify('success', t.added);
                } else setAddError(t.errors[result.error]);
              })
              .finally(() => setAdding(false));
          }}
        >
          <p className="field-label">{t.addTitle}</p>
          <Field label={t.addName}>{(props) => <input {...props} className="input" value={name} onChange={(event) => setName(event.target.value)} />}</Field>
          <Field label={t.addUrl} error={addError}>
            {(props) => (
              <input {...props} className="input mono" value={url} placeholder="https://" onChange={(event) => setUrl(event.target.value)} />
            )}
          </Field>
          <div>
            <button type="submit" className="btn btn--primary btn--sm" disabled={adding || !url.trim()}>
              <Icon name="plus" size={14} />
              {t.addButton}
            </button>
          </div>
        </form>
      </SettingsCard>

      <SettingsCard title={t.custom} description={t.customHint}>
        <label className="visually-hidden" htmlFor="shield-custom-rules">
          {t.custom}
        </label>
        <textarea
          id="shield-custom-rules"
          className="input code-area mono"
          rows={6}
          spellCheck={false}
          value={rules}
          onChange={(event) => {
            setRules(event.target.value);
            setRulesDirty(true);
          }}
        />
        <div className="manager-actions">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!rulesDirty}
            onClick={() =>
              void native.shield.setCustomRules(rules).then((next) => {
                setState(next);
                setRulesDirty(false);
                notify('success', t.customSaved);
              })
            }
          >
            {t.customSave}
          </button>
          <span className="field-hint">{t.customStats(state.customRuleCount, state.customInvalidCount)}</span>
        </div>
      </SettingsCard>

      <SettingsCard title={t.exceptions} description={t.exceptionsHint}>
        {state.exceptions.length === 0 ? (
          <p className="widget-empty">{t.noExceptions}</p>
        ) : (
          <ul className="manager-list">
            {state.exceptions.map((host) => (
              <li key={host} className="manager-row">
                <span className="manager-row__text">
                  <span className="manager-row__title">{host}</span>
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void native.shield.setSiteAllowed(host, false).then(setState)}
                  aria-label={t.removeException(host)}
                >
                  <Icon name="shield" size={14} />
                  {t.removeException(host)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard title={t.limits}>
        <ul className="notes-list">
          {t.limitList.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </SettingsCard>
    </>
  );
}
