import { useServices } from '../../../app/ServicesContext';
import { useAppName } from '../../../hooks/useAppName';
import { useAppearance } from '../../../hooks/useAppearance';
import { useMessages } from '../../../i18n';
import { IcarusMark } from '../../common/IcarusLogo';
import { SettingsCard } from '../SettingsPage';
import { AboutUpdatesCard } from './UpdatesSection';

export function AboutSection() {
  const m = useMessages();
  const t = m.settings.about;
  const { engine, native } = useServices();
  const appName = useAppName();
  const { themeId } = useAppearance();
  return (
    <>
      <section className="about-hero">
        <IcarusMark size={64} tile variant={themeId} />
        <div>
          <p className="about-hero__name">{appName}</p>
          <p className="about-hero__version">
            {t.version(native?.appVersion ?? __APP_VERSION__)} · {native ? m.app.preview : m.app.prototype}
          </p>
          <p className="about-hero__engine">{m.externalPage.engine(engine.info.name)}</p>
        </div>
      </section>
      <AboutUpdatesCard />
      <SettingsCard title={appName}>
        <p>{native ? t.descriptionDesktop : t.description}</p>
        <p className="field-hint">{t.disclaimer}</p>
      </SettingsCard>
      <SettingsCard title={t.platforms}>
        <ul className="notes-list">
          {(native ? t.platformListDesktop : t.platformList).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </SettingsCard>
      <SettingsCard title={t.shortcutsTitle} description={native ? t.keyboardNoteDesktop : t.keyboardNote}>
        <table className="keyboard-table">
          <tbody>
            {(native ? [...t.keyboard, ...t.keyboardDesktop] : t.keyboard).map(([keys, action]) => (
              <tr key={keys}>
                <th scope="row">
                  <kbd>{keys}</kbd>
                </th>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsCard>
    </>
  );
}
