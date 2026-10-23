import { useSettings } from '../../../hooks/useStores';
import { useMessages } from '../../../i18n';
import { updateNavigation } from '../../../services/settings/settings';
import type { ExternalOpeningMode, NewTabPage, ShortcutOpenTarget } from '../../../types/settings';
import { RadioList, Toggle } from '../../common/Controls';
import { Icon } from '../../common/Icon';
import { ShortcutManager } from '../../ShortcutGrid/ShortcutManager';
import { SettingsCard } from '../SettingsPage';

export function NavigationSection() {
  const m = useMessages();
  const t = m.settings.navigation;
  const [settings, updateSettings] = useSettings();
  const navigation = settings.navigation;
  return (
    <>
      <SettingsCard title={t.newTab}>
        <RadioList<NewTabPage>
          label={t.newTab}
          hideLabel
          value={navigation.newTabPage}
          onChange={(newTabPage) => updateSettings((current) => updateNavigation(current, { newTabPage }))}
          options={[
            { value: 'home', label: t.newTabOptions.home },
            { value: 'blank', label: t.newTabOptions.blank },
          ]}
        />
      </SettingsCard>

      <SettingsCard title={t.opening}>
        <p className="info-box">
          <Icon name="info" size={16} />
          {t.openingHint}
        </p>
        <RadioList<ExternalOpeningMode>
          label={t.opening}
          hideLabel
          value={navigation.externalOpening}
          onChange={(externalOpening) => updateSettings((current) => updateNavigation(current, { externalOpening }))}
          options={[
            { value: 'automatic', label: t.openingOptions.automatic },
            { value: 'confirm', label: t.openingOptions.confirm },
          ]}
        />
      </SettingsCard>

      <SettingsCard title={t.shortcuts} description={t.shortcutsHint}>
        <RadioList<ShortcutOpenTarget>
          label={t.shortcutTarget}
          value={navigation.shortcutOpenTarget}
          onChange={(shortcutOpenTarget) => updateSettings((current) => updateNavigation(current, { shortcutOpenTarget }))}
          options={[
            { value: 'current-tab', label: t.shortcutTargetOptions['current-tab'] },
            { value: 'new-tab', label: t.shortcutTargetOptions['new-tab'] },
          ]}
        />
        <Toggle
          label={t.favicons}
          description={t.faviconsHint}
          checked={navigation.loadFavicons}
          onChange={(loadFavicons) => updateSettings((current) => updateNavigation(current, { loadFavicons }))}
        />
        <ShortcutManager />
      </SettingsCard>
    </>
  );
}
