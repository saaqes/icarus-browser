import type { ReactNode } from 'react';
import { useMessages } from '../../i18n';
import { SETTINGS_SECTIONS, type SettingsSection } from '../../types/tabs';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon, type IconName } from '../common/Icon';
import { AboutSection } from './sections/AboutSection';
import { AdvancedSection } from './sections/AdvancedSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { GeneralSection } from './sections/GeneralSection';
import { NavigationSection } from './sections/NavigationSection';
import './Settings.css';

const SECTION_ICONS: Record<SettingsSection, IconName> = {
  general: 'settings',
  appearance: 'brush',
  navigation: 'globe',
  advanced: 'sliders',
  about: 'info',
};

const SECTION_CONTENT: Record<SettingsSection, () => ReactNode> = {
  general: () => <GeneralSection />,
  appearance: () => <AppearanceSection />,
  navigation: () => <NavigationSection />,
  advanced: () => <AdvancedSection />,
  about: () => <AboutSection />,
};

/** Página interna icarus://configuracion, organizada por secciones. */
export function SettingsPage({ section }: { section: SettingsSection }) {
  const m = useMessages();
  const { setSettingsSection } = useBrowser();
  return (
    <div className="settings">
      <nav className="settings__nav" aria-label={m.settings.navLabel}>
        <h1 className="settings__title">{m.settings.title}</h1>
        <ul>
          {SETTINGS_SECTIONS.map((id) => (
            <li key={id}>
              <button
                type="button"
                className={`settings__nav-item${id === section ? ' is-active' : ''}`}
                aria-current={id === section ? 'page' : undefined}
                onClick={() => setSettingsSection(id)}
              >
                <Icon name={SECTION_ICONS[id]} size={18} />
                {m.settings.sections[id]}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings__content">
        <h2 className="settings__section-title">{m.settings.sections[section]}</h2>
        {SECTION_CONTENT[section]()}
      </div>
    </div>
  );
}

/** Tarjeta de la página de configuración. */
export function SettingsCard({ title, children, description }: { title: string; children: ReactNode; description?: string }) {
  return (
    <section className="settings-card">
      <h3 className="settings-card__title">{title}</h3>
      {description && <p className="settings-card__description">{description}</p>}
      <div className="settings-card__body">{children}</div>
    </section>
  );
}
