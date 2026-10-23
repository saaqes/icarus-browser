import { useMessages } from '../../i18n';

export function BlankPage() {
  const m = useMessages();
  return <section className="blank-page" aria-label={m.blankPage.label} />;
}
