import type { ReactNode } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useMessages } from '../../i18n';
import { DESKTOP_ONLY_SECTIONS, SETTINGS_SECTIONS, type SettingsSection } from '../../types/tabs';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon, type IconName } from '../common/Icon';
import { AboutSection } from './sections/AboutSection';
import { AdvancedSection } from './sections/AdvancedSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { DownloadsSection } from './sections/DownloadsSection';
import { GeneralSection } from './sections/GeneralSection';
import { NavigationSection } from './sections/NavigationSection';
import { PrivacySection } from './sections/PrivacySection';
import { ShieldSection } from './sections/ShieldSection';
import { UpdatesSection } from './sections/UpdatesSection';
import './Settings.css';

const SECTION_ICONS: Record<SettingsSection, IconName> = {
  general: 'settings',
  appearance: 'brush',
  navigation: 'globe',
  privacy: 'lock',
  shield: 'shield',
  downloads: 'download',
  advanced: 'sliders',
  updates: 'upgrade',
  about: 'info',
};

const SECTION_CONTENT: Record<SettingsSection, () => ReactNode> = {
  general: () => <GeneralSection />,
  appearance: () => <AppearanceSection />,
  navigation: () => <NavigationSection />,
  privacy: () => <PrivacySection />,
  shield: () => <ShieldSection />,
  downloads: () => <DownloadsSection />,
  advanced: () => <AdvancedSection />,
  updates: () => <UpdatesSection />,
  about: () => <AboutSection />,
};

/** Página interna icarus://configuracion, organizada por secciones. */
export function SettingsPage({ section }: { section: SettingsSection }) {
  const m = useMessages();
  const { setSettingsSection } = useBrowser();
  const { native } = useServices();
  // Privacidad, Shield, Descargas y Actualizaciones solo existen en la aplicación de escritorio.
  const sections = SETTINGS_SECTIONS.filter((id) => native || !DESKTOP_ONLY_SECTIONS.includes(id));
  const current = sections.includes(section) ? section : 'general';
  return (
    <div className="settings">
      <nav className="settings__nav" aria-label={m.settings.navLabel}>
        <h1 className="settings__title">{m.settings.title}</h1>
        <ul>
          {sections.map((id) => (
            <li key={id}>
              <button
                type="button"
                className={`settings__nav-item${id === current ? ' is-active' : ''}`}
                aria-current={id === current ? 'page' : undefined}
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
        <h2 className="settings__section-title">{m.settings.sections[current]}</h2>
        {SECTION_CONTENT[current]()}
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
