/**
 * Modo lectura (como el lector inmersivo de Edge): muestra solo el texto principal
 * de la página con una tipografía cómoda. El texto llega del proceso principal y se
 * pinta como texto, nunca como HTML. La página original sigue abierta debajo.
 */

import { useEffect, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useMessages } from '../../i18n';
import { hostnameOf } from '../../services/format';
import type { ReaderContent } from '../../types/native';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import './Reader.css';

const FONT_SIZES = [16, 18, 20, 22, 25] as const;

type ReaderState = { status: 'loading' } | { status: 'ready'; content: ReaderContent } | { status: 'failed' };

export function ReaderView({ tabId, url }: { tabId: string; url: string }) {
  const m = useMessages();
  const t = m.reader;
  const { native } = useServices();
  const { closeReader } = useBrowser();
  const [state, setState] = useState<ReaderState>({ status: 'loading' });
  const [sizeIndex, setSizeIndex] = useState(1);
  // Oculta la vista nativa de la página mientras se lee (queda cargada debajo).
  useOverlayLayer(true);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    void (native?.tabs.readerContent(tabId) ?? Promise.resolve(null))
      .catch(() => null)
      .then((content) => active && setState(content ? { status: 'ready', content } : { status: 'failed' }));
    return () => {
      active = false;
    };
  }, [native, tabId, url]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeReader();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeReader]);

  const content = state.status === 'ready' ? state.content : null;
  const site = content?.siteName || hostnameOf(url);

  return (
    <section className="reader" role="region" aria-label={t.label} data-testid="reader-view">
      <div className="reader__bar">
        <span className="reader__badge">
          <Icon name="reader" size={16} />
          {t.label}
        </span>
        <div className="reader__tools">
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label={t.smaller}
            title={t.smaller}
            disabled={sizeIndex === 0}
            onClick={() => setSizeIndex((index) => Math.max(0, index - 1))}
          >
            <Icon name="minus" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label={t.larger}
            title={t.larger}
            disabled={sizeIndex === FONT_SIZES.length - 1}
            onClick={() => setSizeIndex((index) => Math.min(FONT_SIZES.length - 1, index + 1))}
          >
            <Icon name="plus" size={16} />
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={closeReader}>
            <Icon name="close" size={14} />
            {t.close}
          </button>
        </div>
      </div>
      <div className="reader__scroll">
        <article className="reader__page" style={{ fontSize: FONT_SIZES[sizeIndex] }} aria-busy={state.status === 'loading'}>
          {state.status === 'loading' && <p className="reader__status">{t.loading}</p>}
          {state.status === 'failed' && <p className="reader__status">{t.failed}</p>}
          {content && (
            <>
              {site && <p className="reader__site">{site}</p>}
              {content.title && <h1 className="reader__title">{content.title}</h1>}
              {content.byline && <p className="reader__byline">{content.byline}</p>}
              {content.blocks.length === 0 ? (
                <p className="reader__status">{t.empty}</p>
              ) : (
                content.blocks.map((block, index) => <ReaderBlock key={index} block={block} skipTitle={index === 0 && block.text === content.title} />)
              )}
              <p className="reader__note">{t.note}</p>
            </>
          )}
        </article>
      </div>
    </section>
  );
}

function ReaderBlock({ block, skipTitle }: { block: ReaderContent['blocks'][number]; skipTitle: boolean }) {
  if (skipTitle) return null;
  switch (block.type) {
    case 'heading': {
      // El título de la página es el h1; los encabezados del texto van de h2 a h4.
      const level = Math.min(4, Math.max(2, block.level));
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4';
      return <Tag className="reader__heading">{block.text}</Tag>;
    }
    case 'item':
      return <p className="reader__item">{block.text}</p>;
    case 'quote':
      return <blockquote className="reader__quote">{block.text}</blockquote>;
    case 'code':
      return <pre className="reader__code">{block.text}</pre>;
    default:
      return <p className="reader__paragraph">{block.text}</p>;
  }
}
