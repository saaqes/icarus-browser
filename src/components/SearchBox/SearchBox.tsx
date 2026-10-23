import { useId, useState } from 'react';
import { useSettings } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { getSearchProvider, SEARCH_PROVIDERS } from '../../services/search/providers';
import { updateGeneral } from '../../services/settings/settings';
import type { SearchProviderId } from '../../types/settings';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon } from '../common/Icon';
import './SearchBox.css';

export type SearchBoxVariant = 'pill' | 'panel' | 'glass';

/** Buscador de la página de inicio. Acepta búsquedas y direcciones, igual que la barra superior. */
export function SearchBox({ variant }: { variant: SearchBoxVariant }) {
  const m = useMessages();
  const [settings, updateSettings] = useSettings();
  const { navigateInput } = useBrowser();
  const [value, setValue] = useState('');
  const provider = getSearchProvider(settings.general.searchProvider);
  const noteId = useId();

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
        <Icon name="search" size={20} className="searchbox__icon" />
        <input
          className="searchbox__input"
          type="text"
          aria-label={m.search.label}
          aria-describedby={noteId}
          placeholder={m.search.placeholder(provider.name)}
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
        <label className="searchbox__provider">
          <span className="visually-hidden">{m.search.provider}</span>
          <select
            value={provider.id}
            onChange={(event) =>
              updateSettings((current) => updateGeneral(current, { searchProvider: event.target.value as SearchProviderId }))
            }
          >
            {Object.values(SEARCH_PROVIDERS).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
        {variant === 'panel' && (
          <button type="submit" className="searchbox__submit" aria-label={m.search.submit}>
            <Icon name="search" size={18} />
          </button>
        )}
      </form>
      <p id={noteId} className="searchbox__note">
        <Icon name="external" size={12} />
        {m.search.externalNote}
      </p>
    </div>
  );
}
