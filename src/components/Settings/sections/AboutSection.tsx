import { useServices } from '../../../app/ServicesContext';
import { useMessages } from '../../../i18n';
import { IcarusMark } from '../../common/IcarusLogo';
import { SettingsCard } from '../SettingsPage';

export function AboutSection() {
  const m = useMessages();
  const t = m.settings.about;
  const { engine, native } = useServices();
  return (
    <>
      <section className="about-hero">
        <IcarusMark size={64} tile />
        <div>
          <p className="about-hero__name">{m.app.fullName}</p>
          <p className="about-hero__version">
            {t.version(native?.appVersion ?? __APP_VERSION__)} · {native ? m.app.preview : m.app.prototype}
          </p>
          <p className="about-hero__engine">{m.externalPage.engine(engine.info.name)}</p>
        </div>
      </section>
      <SettingsCard title={m.app.fullName}>
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
