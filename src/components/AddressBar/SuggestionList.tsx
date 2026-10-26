import { useServices } from '../../app/ServicesContext';
import { useMessages } from '../../i18n';
import { shortAddress } from '../../services/custom-addresses/display';
import type { CustomAddress } from '../../types/customAddress';
import { Favicon } from '../common/Favicon';
import { Icon, type IconName } from '../common/Icon';
import { visibleAddress, type Suggestion } from './suggestions';

interface SuggestionListProps {
  id: string;
  suggestions: Suggestion[];
  activeIndex: number;
  providerName: string;
  customAddresses: CustomAddress[];
  onHover: (index: number) => void;
  onSelect: (suggestion: Suggestion) => void;
}

function describe(
  suggestion: Suggestion,
  providerName: string,
  customAddresses: CustomAddress[],
  m: ReturnType<typeof useMessages>,
  desktop: boolean,
) {
  const t = m.addressBar.suggestion;
  const shown = (url: string) => shortAddress(visibleAddress(url, customAddresses));
  if (suggestion.kind === 'shortcut') {
    return { icon: null, main: suggestion.shortcut.title, detail: `${t.shortcut} · ${shown(suggestion.shortcut.url)}`, warn: false };
  }
  if (suggestion.kind === 'bookmark') {
    return { icon: 'star' as IconName, main: suggestion.bookmark.title, detail: `${t.bookmark} · ${shown(suggestion.bookmark.url)}`, warn: false };
  }
  if (suggestion.kind === 'history') {
    return { icon: 'history' as IconName, main: suggestion.item.title || shown(suggestion.item.url), detail: `${t.history} · ${shown(suggestion.item.url)}`, warn: false };
  }
  if (suggestion.kind === 'address') {
    return { icon: 'globe' as IconName, main: shortAddress(suggestion.entry.address), detail: t.customAddress, warn: false };
  }
  const { resolution, text } = suggestion;
  switch (resolution.kind) {
    case 'url':
      return { icon: 'globe' as IconName, main: shown(resolution.url), detail: desktop ? t.urlDesktop : t.url, warn: false };
    case 'custom':
      return { icon: 'globe' as IconName, main: shortAddress(resolution.address), detail: desktop ? t.urlDesktop : t.url, warn: false };
    case 'search':
      return { icon: 'search' as IconName, main: text, detail: desktop ? t.searchDesktop(providerName) : t.search(providerName), warn: false };
    case 'internal':
      return { icon: 'sparkle' as IconName, main: text, detail: t.internal, warn: false };
    case 'internal-unknown':
      return { icon: 'warning' as IconName, main: text, detail: t.internalUnknown, warn: true };
    case 'blocked':
      return { icon: 'warning' as IconName, main: text, detail: t.blocked, warn: true };
    case 'empty':
      return { icon: 'search' as IconName, main: text, detail: '', warn: false };
  }
}

export function SuggestionList({ id, suggestions, activeIndex, providerName, customAddresses, onHover, onSelect }: SuggestionListProps) {
  const m = useMessages();
  const desktop = Boolean(useServices().native);
  return (
    <div className="omnibox__dropdown">
      <ul id={id} role="listbox" aria-label={m.addressBar.suggestions} className="suggestions">
        {suggestions.map((suggestion, index) => {
          const info = describe(suggestion, providerName, customAddresses, m, desktop);
          return (
            <li
              key={suggestion.id}
              id={`${id}-${suggestion.id}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`suggestion${index === activeIndex ? ' is-active' : ''}${info.warn ? ' is-warning' : ''}`}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(suggestion)}
            >
              <span className="suggestion__icon">
                {suggestion.kind === 'shortcut' ? (
                  <Favicon url={suggestion.shortcut.url} label={suggestion.shortcut.title} size={16} />
                ) : (
                  <Icon name={info.icon ?? 'search'} size={16} />
                )}
              </span>
              <span className="suggestion__main">{info.main}</span>
              {info.detail && <span className="suggestion__detail">{info.detail}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
