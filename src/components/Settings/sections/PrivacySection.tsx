import { useState } from 'react';
import { useDesktopPreferences, useNative } from '../../../hooks/useNative';
import { useMessages } from '../../../i18n';
import type { ClearRange } from '../../../types/native';
import { Toggle } from '../../common/Controls';
import { Icon } from '../../common/Icon';
import { useToast } from '../../common/Toast';
import { SettingsCard } from '../SettingsPage';

type ClearItem = 'history' | 'cookies' | 'cache' | 'downloads';

export function PrivacySection() {
  const m = useMessages();
  const t = m.privacy;
  const native = useNative();
  const notify = useToast();
  const [preferences, setPreferences] = useDesktopPreferences();
  const [range, setRange] = useState<ClearRange>('hour');
  const [items, setItems] = useState<Record<ClearItem, boolean>>({ history: true, cookies: false, cache: true, downloads: false });
  const [busy, setBusy] = useState(false);
  if (!native) return null;

  const clear = async () => {
    setBusy(true);
    try {
      await native.privacy.clearData({ range, ...items });
      notify('success', t.cleared);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsCard title={t.clearTitle} description={t.clearHint}>
        <label className="select-row">
          <span className="field-label">{t.range}</span>
          <select className="select" value={range} onChange={(event) => setRange(event.target.value as ClearRange)}>
            {(['hour', 'day', 'week', 'all'] as const).map((value) => (
              <option key={value} value={value}>
                {t.ranges[value]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="checklist">
          <legend className="visually-hidden">{t.clearTitle}</legend>
          {(['history', 'cookies', 'cache', 'downloads'] as const).map((item) => (
            <label key={item} className="checkbox">
              <input type="checkbox" checked={items[item]} onChange={(event) => setItems((current) => ({ ...current, [item]: event.target.checked }))} />
              <span className="checkbox__label">{t.items[item]}</span>
            </label>
          ))}
        </fieldset>
        <div>
          <button type="button" className="btn btn--danger-ghost btn--sm" disabled={busy || !Object.values(items).some(Boolean)} onClick={() => void clear()}>
            <Icon name="trash" size={14} />
            {t.clearButton}
          </button>
        </div>
      </SettingsCard>

      {preferences && (
        <SettingsCard title={t.onExit}>
          {(['history', 'cookies', 'cache'] as const).map((item) => (
            <Toggle
              key={item}
              label={t.onExitItems[item]}
              checked={preferences.privacy.clearOnExit[item]}
              onChange={(checked) =>
                void setPreferences({
                  ...preferences,
                  privacy: { clearOnExit: { ...preferences.privacy.clearOnExit, [item]: checked } },
                })
              }
            />
          ))}
        </SettingsCard>
      )}

      <SettingsCard title={t.permissions}>
        <p className="info-box">
          <Icon name="lock" size={16} />
          {t.permissionsHint}
        </p>
      </SettingsCard>

      <SettingsCard title={t.profile}>
        <p className="info-box">
          <Icon name="info" size={16} />
          {t.profileHint}
        </p>
      </SettingsCard>

      <SettingsCard title={t.security}>
        <ul className="notes-list">
          {t.securityList.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </SettingsCard>
    </>
  );
}
