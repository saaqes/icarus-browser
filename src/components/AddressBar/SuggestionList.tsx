import { useServices } from '../../app/ServicesContext';
import { useMessages } from '../../i18n';
import { Favicon } from '../common/Favicon';
import { Icon, type IconName } from '../common/Icon';
import type { Suggestion } from './suggestions';

interface SuggestionListProps {
  id: string;
  suggestions: Suggestion[];
  activeIndex: number;
  providerName: string;
  onHover: (index: number) => void;
  onSelect: (suggestion: Suggestion) => void;
}

function describe(suggestion: Suggestion, providerName: string, m: ReturnType<typeof useMessages>, desktop: boolean) {
  const t = m.addressBar.suggestion;
  if (suggestion.kind === 'shortcut') {
    return { icon: null, main: suggestion.shortcut.title, detail: `${t.shortcut} · ${suggestion.shortcut.url}`, warn: false };
  }
  if (suggestion.kind === 'history') {
    return { icon: 'history' as IconName, main: suggestion.item.title || suggestion.item.url, detail: `${t.history} · ${suggestion.item.url}`, warn: false };
  }
  if (suggestion.kind === 'alias') {
    const { rule } = suggestion;
    return { icon: 'tag' as IconName, main: rule.alias, detail: `${t.aliasRule} · ${rule.displayName} → ${rule.targetUrl}`, warn: false };
  }
  const { resolution, text } = suggestion;
  switch (resolution.kind) {
    case 'url':
      return { icon: 'globe' as IconName, main: resolution.url, detail: desktop ? t.urlDesktop : t.url, warn: false };
    case 'search':
      return { icon: 'search' as IconName, main: text, detail: desktop ? t.searchDesktop(providerName) : t.search(providerName), warn: false };
    case 'alias':
      return { icon: 'tag' as IconName, main: resolution.rule.alias, detail: t.alias(resolution.url), warn: false };
    case 'alias-unresolved':
      return { icon: 'warning' as IconName, main: resolution.alias, detail: t.aliasUnresolved, warn: true };
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

export function SuggestionList({ id, suggestions, activeIndex, providerName, onHover, onSelect }: SuggestionListProps) {
  const m = useMessages();
  const desktop = Boolean(useServices().native);
  return (
    <div className="omnibox__dropdown">
      <ul id={id} role="listbox" aria-label={m.addressBar.suggestions} className="suggestions">
        {suggestions.map((suggestion, index) => {
          const info = describe(suggestion, providerName, m, desktop);
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
