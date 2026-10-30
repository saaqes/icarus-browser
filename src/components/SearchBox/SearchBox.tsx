import { useId, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useMessages } from '../../i18n';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon } from '../common/Icon';
import './SearchBox.css';

export type SearchBoxVariant = 'pill' | 'panel' | 'glass';

/**
 * Barra de direcciones de la página de inicio. ICARUS no tiene un buscador general:
 * acepta direcciones web y alias, igual que la barra superior, y nunca convierte el
 * texto en una búsqueda.
 */
export function SearchBox({ variant }: { variant: SearchBoxVariant }) {
  const m = useMessages();
  const { navigateInput } = useBrowser();
  const [value, setValue] = useState('');
  const noteId = useId();
  const { native } = useServices();

  return (
    <div className={`searchbox searchbox--${variant}`}>
      <form
        role="search"
        className="searchbox__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (navigateInput(value)) setValue('');
        }}
      >
        <Icon name="globe" size={20} className="searchbox__icon" />
        <input
          className="searchbox__input"
          type="text"
          aria-label={m.search.label}
          aria-describedby={noteId}
          placeholder={m.search.placeholder}
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
        />
        {value && (
          <button type="button" className="icon-btn icon-btn--sm" aria-label={m.addressBar.clear} onClick={() => setValue('')}>
            <Icon name="close" size={14} />
          </button>
        )}
        {variant === 'panel' && (
          <button type="submit" className="searchbox__submit" aria-label={m.search.submit}>
            <Icon name="chevronRight" size={18} />
          </button>
        )}
      </form>
      <p id={noteId} className="searchbox__note">
        <Icon name={native ? 'globe' : 'external'} size={12} />
        {native ? m.search.desktopNote : m.search.externalNote}
      </p>
    </div>
  );
}
