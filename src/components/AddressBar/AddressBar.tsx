/**
 * Barra de direcciones (omnibox), con el comportamiento de Chrome y Edge.
 *
 * - Una sola dirección: la personalizada si la página está dentro de su destino;
 *   si no, la real. Sin foco se muestra en forma corta (sin `https://` ni `www.`).
 * - A la izquierda, el estado real de la conexión: icono de información del sitio
 *   en HTTPS, «No seguro» en HTTP y «No seguro» en rojo con `https` tachado si el
 *   certificado no es válido. Con un error de certificado se muestra la dirección
 *   real que falló: el aviso siempre se refiere al sitio que respondió.
 * - Al hacer clic se muestra la dirección completa seleccionada; Enter navega,
 *   Escape la restaura y, mientras se escribe, nada sustituye el texto.
 * - Sugerencias: acción principal, direcciones personalizadas, accesos directos e
 *   historial, sin cambiar la página hasta confirmar.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useHistoryItems } from '../../hooks/useNative';
import { useCustomAddresses, useSettings, useShortcuts } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { formatAddress } from '../../services/custom-addresses/display';
import { getSearchProvider } from '../../services/search/providers';
import { Icon, type IconName } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { SiteInfoPopover, type SecurityState } from './SiteInfoPopover';
import { SuggestionList } from './SuggestionList';
import { buildSuggestions, type Suggestion } from './suggestions';
import './AddressBar.css';

const SECURITY_ICONS: Record<SecurityState, IconName> = {
  secure: 'sliders',
  unverified: 'info',
  insecure: 'warning',
  dangerous: 'warning',
  internal: 'sparkle',
};

export function AddressBar() {
  const m = useMessages();
  const { currentEntry, activeTab, describe, navigateInput, openUrl, registerAddressBar, webState, liveWebTabId } = useBrowser();
  const desktop = Boolean(useServices().native);
  const [settings] = useSettings();
  const [customAddresses] = useCustomAddresses();
  const [shortcuts] = useShortcuts();
  const { items: history } = useHistoryItems();
  const presentation = describe(currentEntry.page);
  const provider = getSearchProvider(settings.general.searchProvider);

  // Error de certificado en la página que se muestra: se enseña la dirección real que falló.
  const error = liveWebTabId === activeTab.id ? webState[activeTab.id]?.error ?? null : null;
  const certificateError = error?.kind === 'certificate' ? error : null;
  const addressUrl = certificateError ? certificateError.url : presentation.addressUrl;
  const editable = presentation.kind === 'newtab' ? '' : addressUrl;
  const security: SecurityState =
    presentation.kind !== 'web'
      ? 'internal'
      : certificateError
        ? 'dangerous'
        : presentation.protocol === 'http:'
          ? 'insecure'
          : desktop
            ? 'secure'
            : 'unverified';

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

  // Seleccionar todo después de que React escriba el valor (si no, el cursor queda al final).
  const selectAfterRender = useRef(false);
  useLayoutEffect(() => {
    if (!selectAfterRender.current) return;
    selectAfterRender.current = false;
    if (document.activeElement === inputRef.current) inputRef.current?.select();
  });

  // La dirección se actualiza con la navegación salvo si el usuario está escribiendo.
  const shownEditable = useRef(editable);
  useEffect(() => {
    if (dirty || shownEditable.current === editable) return;
    shownEditable.current = editable;
    setValue(editable);
    if (editing) selectAfterRender.current = true;
  }, [dirty, editable, editing]);

  useEffect(() => {
    setInfoOpen(false);
  }, [activeTab.id, currentEntry.id]);

  // Al cambiar de pestaña (p. ej. con Ctrl+Tab mientras se edita) se descarta lo escrito.
  const editableRef = useRef(editable);
  editableRef.current = editable;
  useEffect(() => {
    shownEditable.current = editableRef.current;
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
    editing && dirty ? buildSuggestions(value, { providerId: provider.id, customAddresses, shortcuts, history }) : [];
  const listOpen = suggestions.length > 0;
  const activeIndex = Math.min(highlight, Math.max(0, suggestions.length - 1));

  const finish = () => {
    inputRef.current?.blur();
  };

  /** Vuelve a la dirección de la página actual, como Escape en Chrome. */
  const revert = () => {
    shownEditable.current = editable;
    setValue(editable);
    setDirty(false);
    setHighlight(0);
    selectAfterRender.current = true;
  };

  const run = (suggestion: Suggestion | undefined) => {
    let done = false;
    if (!suggestion || suggestion.kind === 'primary') done = navigateInput(value);
    else if (suggestion.kind === 'shortcut') {
      openUrl(suggestion.shortcut.url);
      done = true;
    } else if (suggestion.kind === 'history') {
      openUrl(suggestion.item.url);
      done = true;
    } else {
      openUrl(suggestion.entry.target);
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
      if (dirty || value !== editable) revert();
      else finish();
    }
  };

  // Con un certificado no válido se muestra el protocolo tachado, como en Chrome.
  const parts = formatAddress(addressUrl, settings.navigation.showFullUrls || security === 'dangerous');
  // Como en Chrome: el icono del sitio sigue visible al hacer clic y cambia a la lupa al escribir.
  const showInfoButton = presentation.kind !== 'newtab' && !(editing && dirty);
  const notSecure = security === 'insecure' || security === 'dangerous' ? m.addressBar.notSecure : null;
  const securityLabel = editing ? null : notSecure;
  useOverlayLayer(listOpen || infoOpen);

  return (
    <div className={`omnibox${editing ? ' is-editing' : ''}${listOpen ? ' is-open' : ''}`}>
      <div className="omnibox__field">
        {showInfoButton ? (
          <button
            ref={infoButtonRef}
            type="button"
            className={`omnibox__info is-${security}${securityLabel ? ' has-label' : ''}`}
            aria-label={notSecure ? `${notSecure} · ${m.addressBar.siteInfo}` : m.addressBar.siteInfo}
            title={m.addressBar.siteInfo}
            aria-expanded={infoOpen}
            onMouseDown={(event) => {
              // Mientras se edita, el clic no quita el foco ni lo escrito antes de abrir el panel.
              if (editing) event.preventDefault();
            }}
            onClick={() => {
              if (editing) finish();
              setInfoOpen((open) => !open);
            }}
            data-security={security}
          >
            <Icon name={SECURITY_ICONS[security]} size={16} />
            {securityLabel && <span className="omnibox__security-label">{securityLabel}</span>}
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
              shownEditable.current = editable;
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
            <div className="omnibox__display" aria-hidden="true">
              {presentation.kind === 'web' ? (
                <span className="omnibox__url">
                  {parts.prefix && <span className={security === 'dangerous' ? 'omnibox__scheme is-struck' : 'omnibox__dim'}>{parts.prefix}</span>}
                  <span className="omnibox__host">{parts.host}</span>
                  <span className="omnibox__dim">{parts.rest}</span>
                </span>
              ) : (
                <span className="omnibox__internal">{addressUrl}</span>
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

      {listOpen && (
        <SuggestionList
          id={listId}
          suggestions={suggestions}
          activeIndex={activeIndex}
          providerName={provider.name}
          customAddresses={customAddresses}
          onHover={setHighlight}
          onSelect={run}
        />
      )}

      {infoOpen && (
        <SiteInfoPopover
          presentation={presentation}
          security={security}
          addressUrl={addressUrl}
          anchorRef={infoButtonRef}
          onClose={() => setInfoOpen(false)}
        />
      )}
    </div>
  );
}
