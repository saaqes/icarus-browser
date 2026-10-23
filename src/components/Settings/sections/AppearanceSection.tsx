import { useMessages } from '../../../i18n';
import {
  AccentControl,
  BackgroundControl,
  ColorModeControl,
  LayoutControl,
  ReduceMotionControl,
  ResetThemeControl,
  ThemePicker,
  VisibilityControl,
} from '../../Customize/AppearanceControls';
import { SettingsCard } from '../SettingsPage';

export function AppearanceSection() {
  const m = useMessages();
  return (
    <>
      <SettingsCard title={m.customize.style} description={m.settings.appearance.intro}>
        <ThemePicker />
        <ColorModeControl />
        <AccentControl />
      </SettingsCard>
      <SettingsCard title={m.customize.background}>
        <BackgroundControl />
      </SettingsCard>
      <SettingsCard title={m.customize.layout}>
        <LayoutControl />
        <VisibilityControl />
      </SettingsCard>
      <SettingsCard title={m.customize.reduceMotion}>
        <ReduceMotionControl />
        <ResetThemeControl />
      </SettingsCard>
    </>
  );
}
