import { useDesktopPreferences, useNative } from '../../../hooks/useNative';
import { useMessages } from '../../../i18n';
import { Toggle } from '../../common/Controls';
import { Icon } from '../../common/Icon';
import { SettingsCard } from '../SettingsPage';

export function DownloadsSection() {
  const m = useMessages();
  const t = m.downloads.settings;
  const native = useNative();
  const [preferences, setPreferences] = useDesktopPreferences();
  if (!native || !preferences) return null;
  const { downloads } = preferences;

  return (
    <SettingsCard title={t.location}>
      <div className="discreet-row discreet-row--plain">
        <div>
          <p className="field-label">{t.folder}</p>
          <p className="discreet-row__meta mono">{downloads.directory ?? t.defaultFolder}</p>
        </div>
        <div className="manager-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              void native.downloads.chooseDirectory().then((directory) => {
                if (directory) void setPreferences({ ...preferences, downloads: { ...downloads, directory } });
              })
            }
          >
            <Icon name="folder" size={14} />
            {t.change}
          </button>
          {downloads.directory && (
            <button type="button" className="btn btn--subtle btn--sm" onClick={() => void setPreferences({ ...preferences, downloads: { ...downloads, directory: null } })}>
              {t.reset}
            </button>
          )}
        </div>
      </div>
      <Toggle
        label={t.ask}
        checked={downloads.askWhereToSave}
        onChange={(askWhereToSave) => void setPreferences({ ...preferences, downloads: { ...downloads, askWhereToSave } })}
      />
    </SettingsCard>
  );
}
