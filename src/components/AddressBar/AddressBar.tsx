/**
 * Barra de direcciones (omnibox).
 *
 * - Sin foco: muestra la URL real con el host resaltado o, si hay una regla activa,
 *   el alias con la etiqueta «Alias» y el host real al lado.
 * - Con foco: siempre muestra la URL real para consultarla, copiarla o editarla.
 * - Al escribir: sugiere la acción (abrir URL, buscar, alias, página interna o
 *   bloqueo) para que el usuario sepa qué ocurrirá al pulsar Enter.
 */

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useAliasRules, useSettings, useShortcuts } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { getSearchProvider } from '../../services/search/providers';
import { splitUrlForDisplay } from '../../services/url-resolution/urlUtils';
import { Icon } from '../common/Icon';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { SiteInfoPopover } from './SiteInfoPopover';
import { SuggestionList } from './SuggestionList';
import { buildSuggestions, type Suggestion } from './suggestions';
import './AddressBar.css';

export function AddressBar() {
  const m = useMessages();
  const { currentEntry, activeTab, describe, navigateInput, openUrl, registerAddressBar } = useBrowser();
  const [settings] = useSettings();
  const [rules] = useAliasRules();
  const [shortcuts] = useShortcuts();
  const presentation = describe(currentEntry.page);
  const provider = getSearchProvider(settings.general.searchProvider);
  const editable = presentation.kind === 'newtab' ? '' : presentation.realUrl;

  const inputRef = useRef<HTMLInputElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [value, setValue] = useState(editable);
  const [highlight, setHighlight] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  // Evita que el mouseup posterior al foco con clic deshaga la selección del texto.
  const selectOnMouseUp = useRef(false);
  const listId = useId();

  useEffect(() => {
    if (!editing) setValue(editable);
  }, [editable, editing]);

  useEffect(() => {
    setInfoOpen(false);
  }, [activeTab.id, currentEntry.id]);

  // Al cambiar de pestaña (p. ej. con Ctrl+Tab mientras se edita) se descarta lo escrito.
  const editableRef = useRef(editable);
  editableRef.current = editable;
  useEffect(() => {
    setValue(editableRef.current);
    setDirty(false);
  }, [activeTab.id]);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    registerAddressBar(focusInput);
    return () => registerAddressBar(null);
  }, [focusInput, registerAddressBar]);

  const suggestions: Suggestion[] =
    editing && dirty ? buildSuggestions(value, { providerId: provider.id, rules, shortcuts }) : [];
  const listOpen = suggestions.length > 0;
  const activeIndex = Math.min(highlight, Math.max(0, suggestions.length - 1));

  const finish = () => {
    inputRef.current?.blur();
  };

  const run = (suggestion: Suggestion | undefined) => {
    let done = false;
    if (!suggestion || suggestion.kind === 'primary') done = navigateInput(value);
    else if (suggestion.kind === 'shortcut') {
      openUrl(suggestion.shortcut.url);
      done = true;
    } else {
      openUrl(suggestion.rule.targetUrl);
      done = true;
    }
    if (done) finish();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && listOpen) {
      event.preventDefault();
      setHighlight((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && listOpen) {
      event.preventDefault();
      setHighlight((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(listOpen ? suggestions[activeIndex] : undefined);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (listOpen) setDirty(false);
      else {
        setValue(editable);
        finish();
      }
    }
  };

  const display = splitUrlForDisplay(presentation.realUrl);
  const isExternal = presentation.kind === 'external';
  const showInfoButton = !editing && presentation.kind !== 'newtab';
  const infoIcon = presentation.alias ? 'tag' : presentation.protocol === 'http:' ? 'warning' : 'info';
  const hintVisible = editing && !dirty && Boolean(presentation.alias);

  return (
    <div className={`omnibox${editing ? ' is-editing' : ''}${listOpen || hintVisible ? ' is-open' : ''}`}>
      <div className="omnibox__field">
        {showInfoButton ? (
          <button
            ref={infoButtonRef}
            type="button"
            className={`omnibox__info${presentation.protocol === 'http:' ? ' is-insecure' : ''}${presentation.alias ? ' is-alias' : ''}`}
            aria-label={m.addressBar.siteInfo}
            title={m.addressBar.siteInfo}
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((open) => !open)}
          >
            <Icon name={isExternal ? infoIcon : 'sparkle'} size={16} />
          </button>
        ) : (
          <span className="omnibox__search-icon" aria-hidden="true">
            <Icon name="search" size={16} />
          </span>
        )}

        <div className="omnibox__input-wrap">
          <input
            ref={inputRef}
            className="omnibox__input"
            type="text"
            role="combobox"
            aria-label={m.addressBar.label}
            aria-expanded={listOpen}
            aria-controls={listOpen ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={listOpen ? `${listId}-${suggestions[activeIndex]?.id}` : undefined}
            placeholder={m.addressBar.placeholder(provider.name)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            value={value}
            onFocus={(event) => {
              setEditing(true);
              setInfoOpen(false);
              setValue(editable);
              event.currentTarget.select();
              selectOnMouseUp.current = true;
            }}
            onMouseUp={(event) => {
              if (selectOnMouseUp.current) event.preventDefault();
              selectOnMouseUp.current = false;
            }}
            onBlur={() => {
              setEditing(false);
              setDirty(false);
              setHighlight(0);
              setValue(editable);
            }}
            onChange={(event) => {
              selectOnMouseUp.current = false;
              setValue(event.target.value);
              setDirty(true);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
          />
          {!editing && presentation.kind !== 'newtab' && (
            <div className="omnibox__display" aria-hidden="true" onMouseDown={(event) => { event.preventDefault(); focusInput(); }}>
              {presentation.alias ? (
                <>
                  <span className="alias-chip">
                    <Icon name="tag" size={12} />
                    {m.addressBar.aliasBadge}
                  </span>
                  <span className="omnibox__alias">{presentation.alias.rule.alias}</span>
                  <span className="omnibox__real-host" title={m.addressBar.aliasRealHost(display.host)}>
                    {display.host}
                  </span>
                </>
              ) : isExternal ? (
                <>
                  {presentation.protocol === 'http:' && <span className="insecure-chip">HTTP</span>}
                  <span className="omnibox__url">
                    <span className="omnibox__dim">{display.prefix}</span>
                    <span className="omnibox__host">{display.host}</span>
                    <span className="omnibox__dim">{display.rest}</span>
                  </span>
                </>
              ) : (
                <span className="omnibox__internal">{presentation.realUrl}</span>
              )}
            </div>
          )}
        </div>

        {editing && value && (
          <button
            type="button"
            className="icon-btn icon-btn--sm omnibox__clear"
            aria-label={m.addressBar.clear}
            title={m.addressBar.clear}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setValue('');
              setDirty(true);
              inputRef.current?.focus();
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {hintVisible && presentation.alias && (
        <div className="omnibox__dropdown">
          <p className="omnibox__hint">
            <Icon name="tag" size={14} />
            {m.addressBar.editingAlias(presentation.alias.rule.alias)}
          </p>
        </div>
      )}

      {listOpen && (
        <SuggestionList
          id={listId}
          suggestions={suggestions}
          activeIndex={activeIndex}
          providerName={provider.name}
          onHover={setHighlight}
          onSelect={run}
        />
      )}

      {infoOpen && (
        <SiteInfoPopover
          presentation={presentation}
          anchorRef={infoButtonRef}
          onClose={() => setInfoOpen(false)}
          onEdit={() => {
            setInfoOpen(false);
            focusInput();
          }}
        />
      )}
    </div>
  );
}
