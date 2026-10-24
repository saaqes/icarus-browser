/** Barra «Buscar en la página» (Ctrl+F) bajo la barra de herramientas. */

import { useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useMessages } from '../../i18n';
import type { FindResult } from '../../types/native';
import { Icon } from '../common/Icon';
import { useBrowser } from './BrowserContext';

function FindBarFor({ tabId, token }: { tabId: string; token: number }) {
  const m = useMessages();
  const t = m.find;
  const { native } = useServices();
  const { closeFind } = useBrowser();
  const [text, setText] = useState('');
  const [result, setResult] = useState<FindResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cada Ctrl+F vuelve a poner el foco en el campo y selecciona su texto.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [token]);

  useEffect(
    () =>
      native?.onEvent((event) => {
        if (event.type === 'find-result' && event.result.tabId === tabId) setResult(event.result);
      }),
    [native, tabId],
  );

  /** `next`: continuar con el mismo texto (siguiente o anterior coincidencia). */
  const search = (value: string, forward: boolean, next: boolean) => {
    if (!value) setResult(null);
    native?.tabs.find(tabId, value, { forward, next });
  };

  return (
    <div className="findbar" role="search" aria-label={t.label}>
      <Icon name="search" size={16} />
      <input
        ref={inputRef}
        className="findbar__input"
        type="text"
        aria-label={t.input}
        placeholder={t.placeholder}
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          search(event.target.value, true, false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (text) search(text, !event.shiftKey, true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            closeFind();
          }
        }}
      />
      <span className={`findbar__count${result && result.matches === 0 ? ' is-empty' : ''}`} role="status">
        {text && result ? (result.matches > 0 ? t.count(result.activeMatch, result.matches) : t.none) : ''}
      </span>
      <button type="button" className="icon-btn icon-btn--sm" aria-label={t.previous} title={t.previous} disabled={!result?.matches} onClick={() => search(text, false, true)}>
        <Icon name="chevronUp" size={16} />
      </button>
      <button type="button" className="icon-btn icon-btn--sm" aria-label={t.next} title={t.next} disabled={!result?.matches} onClick={() => search(text, true, true)}>
        <Icon name="chevronDown" size={16} />
      </button>
      <button type="button" className="icon-btn icon-btn--sm" aria-label={t.close} title={t.close} onClick={closeFind}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function FindBar() {
  const { find, activeTab } = useBrowser();
  if (!find || find.tabId !== activeTab.id) return null;
  // La clave reinicia el texto y los resultados al buscar en otra pestaña.
  return <FindBarFor key={find.tabId} tabId={find.tabId} token={find.token} />;
}
