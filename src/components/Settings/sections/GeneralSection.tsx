import { useState } from 'react';
import { useServices } from '../../../app/ServicesContext';
import { useSettings } from '../../../hooks/useStores';
import { useMessages } from '../../../i18n';
import { SEARCH_PROVIDERS } from '../../../services/search/providers';
import { setTheme, updateGeneral } from '../../../services/settings/settings';
import { normalizeUserUrl } from '../../../services/url-resolution/urlUtils';
import { LANGUAGE_CODES, THEME_IDS, type LanguageCode, type SearchProviderId, type StartupBehavior, type ThemeId } from '../../../types/settings';
import { useBrowser } from '../../BrowserShell/BrowserContext';
import { Field, RadioList, Toggle } from '../../common/Controls';
import { Icon } from '../../common/Icon';
import { Modal } from '../../common/Modal';
import { useToast } from '../../common/Toast';
import { SettingsCard } from '../SettingsPage';

export function GeneralSection() {
  const m = useMessages();
  const t = m.settings.general;
  const notify = useToast();
  const [settings, updateSettings] = useSettings();
  const { setSettingsSection } = useBrowser();
  const { native } = useServices();
  const general = settings.general;
  const [homeUrl, setHomeUrl] = useState(general.homePage.kind === 'url' ? general.homePage.url : '');
  const [homeMode, setHomeMode] = useState<'new-tab' | 'url'>(general.homePage.kind);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const saveHomeUrl = () => {
    const result = normalizeUserUrl(homeUrl);
    if (!result.ok) {
      setHomeError(m.shortcuts.errors[result.reason === 'empty' ? 'required' : result.reason === 'alias' ? 'alias-url' : result.reason === 'invalid' ? 'invalid-url' : 'unsafe-protocol']);
      return;
    }
    setHomeError(null);
    setHomeUrl(result.url);
    updateSettings((current) => updateGeneral(current, { homePage: { kind: 'url', url: result.url } }));
    notify('success', t.homeUrlSaved);
  };

  return (
    <>
      <SettingsCard title={t.searchEngine} description={t.searchEngineHint}>
        <label className="select-row">
          <span className="visually-hidden">{t.searchEngine}</span>
          <select
            className="select"
            value={general.searchProvider}
            onChange={(event) => updateSettings((current) => updateGeneral(current, { searchProvider: event.target.value as SearchProviderId }))}
          >
            {Object.values(SEARCH_PROVIDERS).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
      </SettingsCard>

      <SettingsCard title={t.startup} description={native ? t.startupHintDesktop : t.startupHint}>
        <RadioList<StartupBehavior>
          label={t.startup}
          hideLabel
          value={general.startup}
          onChange={(startup) => updateSettings((current) => updateGeneral(current, { startup }))}
          options={[
            { value: 'new-tab', label: t.startupOptions['new-tab'] },
            { value: 'restore-session', label: t.startupOptions['restore-session'] },
          ]}
        />
      </SettingsCard>

      <SettingsCard title={t.homePage}>
        <RadioList<'new-tab' | 'url'>
          label={t.homePage}
          hideLabel
          value={homeMode}
          onChange={(mode) => {
            setHomeMode(mode);
            if (mode === 'new-tab') updateSettings((current) => updateGeneral(current, { homePage: { kind: 'new-tab' } }));
          }}
          options={[
            { value: 'new-tab', label: t.homeNewTab },
            { value: 'url', label: t.homeUrl },
          ]}
        />
        {homeMode === 'url' && (
          <form
            className="inline-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              saveHomeUrl();
            }}
          >
            <Field label={t.homeUrlLabel} error={homeError}>
              {(props) => (
                <input {...props} className="input mono" value={homeUrl} placeholder="https://ejemplo.com" onChange={(event) => setHomeUrl(event.target.value)} />
              )}
            </Field>
            <button type="submit" className="btn btn--primary btn--sm">
              {m.common.save}
            </button>
          </form>
        )}
        <Toggle
          label={t.showHomeButton}
          checked={general.showHomeButton}
          onChange={(showHomeButton) => updateSettings((current) => updateGeneral(current, { showHomeButton }))}
        />
      </SettingsCard>

      <SettingsCard title={t.appearance}>
        <label className="select-row">
          <span className="field-label">{t.currentStyle}</span>
          <select
            className="select"
            value={settings.appearance.theme}
            onChange={(event) => updateSettings((current) => setTheme(current, event.target.value as ThemeId))}
          >
            {THEME_IDS.map((id) => (
              <option key={id} value={id}>
                {m.themes[id].name} · {m.themes[id].inspiredBy}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSettingsSection('appearance')}>
          <Icon name="brush" size={14} />
          {t.openAppearance}
        </button>
      </SettingsCard>

      <SettingsCard title={t.language} description={t.languageHint}>
        <label className="select-row">
          <span className="visually-hidden">{t.language}</span>
          <select
            className="select"
            value={general.language}
            onChange={(event) => updateSettings((current) => updateGeneral(current, { language: event.target.value as LanguageCode }))}
          >
            {LANGUAGE_CODES.map((code) => (
              <option key={code} value={code}>
                {t.languages[code]}
              </option>
            ))}
          </select>
        </label>
      </SettingsCard>

      <SettingsCard title={t.restore} description={t.restoreHint}>
        <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => setRestoreOpen(true)}>
          <Icon name="restore" size={14} />
          {t.restoreButton}
        </button>
      </SettingsCard>

      {restoreOpen && <RestoreDialog onClose={() => setRestoreOpen(false)} />}
    </>
  );
}

type RestoreTarget = 'settings' | 'shortcuts' | 'aliasRules' | 'widgets';

function RestoreDialog({ onClose }: { onClose: () => void }) {
  const m = useMessages();
  const t = m.settings.general;
  const services = useServices();
  const notify = useToast();
  const [selected, setSelected] = useState<Record<RestoreTarget, boolean>>({
    settings: true,
    shortcuts: false,
    aliasRules: false,
    widgets: false,
  });
  const targets: RestoreTarget[] = ['settings', 'shortcuts', 'aliasRules', 'widgets'];

  return (
    <Modal
      open
      title={t.restoreDialogTitle}
      onClose={onClose}
      size="sm"
      role="alertdialog"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {m.common.cancel}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={!targets.some((target) => selected[target])}
            onClick={() => {
              targets.filter((target) => selected[target]).forEach((target) => services[target].reset());
              notify('success', t.restoreDone);
              onClose();
            }}
          >
            {t.restoreConfirm}
          </button>
        </>
      }
    >
      <fieldset className="checklist">
        <legend className="visually-hidden">{t.restoreHint}</legend>
        {targets.map((target) => (
          <label key={target} className="checkbox">
            <input
              type="checkbox"
              checked={selected[target]}
              onChange={(event) => setSelected((current) => ({ ...current, [target]: event.target.checked }))}
            />
            <span className="checkbox__label">{t.restoreOptions[target]}</span>
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}
