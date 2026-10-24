import { useMessages } from '../../i18n';
import { Icon } from '../common/Icon';

/** Aviso para funciones que solo existen en la aplicación de escritorio. */
export function DesktopOnlyNotice({ title }: { title: string }) {
  const m = useMessages();
  return (
    <section className="list-page">
      <header className="list-page__header">
        <h1>{title}</h1>
      </header>
      <p className="info-box">
        <Icon name="info" size={16} />
        {m.desktopOnly}
      </p>
    </section>
  );
}
