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
 * - Sugerencias: acción principal, direcciones personalizadas, favoritos, accesos
 *   directos e historial, sin cambiar la página hasta confirmar.
 * - Editar la base: «Editar base» deja editar solo la dirección base (la
 *   personalizada o el origen) y conserva la ruta, la consulta y el fragmento de la
 *   página (`/#inicio`). Si la página tiene una dirección personalizada, al
 *   confirmar se elige entre guardar la base nueva en esa dirección (persistente) o
 *   ir a la nueva dirección. Escribir una dirección completa nunca hereda la ruta.
 * - A la derecha: zoom (si no es 100 %) y la estrella de favoritos.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useHistoryItems } from '../../hooks/useNative';
import { useBookmarks, useCustomAddresses, useSettings, useShortcuts } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { formatAddress, shortAddress } from '../../services/custom-addresses/display';
import { classifyAddressEdit, joinBase, splitAddress, type AddressSplit } from '../../services/custom-addresses/rebase';
import { renameCustomAddressBase } from '../../services/custom-addresses/store';
import { getSearchProvider } from '../../services/search/providers';
import type { CustomAddress } from '../../types/customAddress';
import { BookmarkStar } from '../Bookmarks/BookmarkStar';
import { Icon, type IconName } from '../common/Icon';
import { useOverlayLayer } from '../common/overlayLayer';
import { useToast } from '../common/Toast';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { ZoomIndicator } from '../BrowserShell/ZoomControls';
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

/** Base nueva confirmada en una página con dirección personalizada: guardar o ir. */
interface RebaseChoice {
  base: string;
  url: string;
  entry: CustomAddress;
}

export function AddressBar() {
  const m = useMessages();
  const { currentEntry, activeTab, describe, navigateInput, openUrl, registerAddressBar, webState, liveWebTabId } = useBrowser();
  const services = useServices();
  const desktop = Boolean(services.native);
  const notify = useToast();
  const [settings] = useSettings();
  const [customAddresses] = useCustomAddresses();
  const [shortcuts] = useShortcuts();
  const [bookmarks] = useBookmarks();
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

  // Base (dirección personalizada u origen) y sufijo (ruta, consulta y fragmento) de la página.
  const split = presentation.kind === 'web' && !certificateError ? splitAddress(addressUrl, presentation.customAddress) : null;

  const inputRef = useRef<HTMLInputElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [value, setValue] = useState(editable);
  const [highlight, setHighlight] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  /** Edición de la base: el sufijo queda fijo a la derecha del texto. */
  const [rebase, setRebase] = useState<AddressSplit | null>(null);
  const [choice, setChoice] = useState<RebaseChoice | null>(null);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [rebaseError, setRebaseError] = useState<string | null>(null);
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
    setRebase(null);
    setChoice(null);
    setRebaseError(null);
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
    editing && dirty && !rebase && !choice
      ? buildSuggestions(value, { providerId: provider.id, customAddresses, shortcuts, history, bookmarks: bookmarks.items })
      : [];
  const listOpen = suggestions.length > 0;
  const choiceOpen = editing && choice !== null;
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
    setRebase(null);
    setChoice(null);
    setRebaseError(null);
    selectAfterRender.current = true;
  };

  /** «Editar base»: solo la base queda en el campo, seleccionada; el sufijo se conserva aparte. */
  const startRebase = () => {
    if (!split) return;
    setRebase(split);
    setChoice(null);
    setRebaseError(null);
    setValue(split.base);
    setDirty(true);
    inputRef.current?.focus();
    selectAfterRender.current = true;
  };

  /** Quita el sufijo fijo: lo que hay en el campo se usará tal cual. */
  const dropSuffix = () => {
    setRebase(null);
    setRebaseError(null);
    inputRef.current?.focus();
  };

  const rebaseMessage = (code: string | undefined) => {
    const errors = m.addressBar.rebase.errors;
    return code && code in errors ? errors[code as keyof typeof errors] : errors.generic;
  };

  /** Confirma la base escrita con el sufijo conservado. */
  const submitRebase = (current: AddressSplit) => {
    const joined = joinBase(value, current.suffix);
    if (!joined.ok) {
      setRebaseError(rebaseMessage(joined.error));
      return;
    }
    if (current.entry) {
      setChoice({ base: value.trim(), url: joined.url, entry: current.entry });
      setChoiceIndex(0);
      return;
    }
    if (navigateInput(joined.url)) finish();
  };

  const applyChoice = (kind: 'save' | 'go', selected: RebaseChoice) => {
    if (kind === 'go') {
      if (navigateInput(selected.url)) finish();
      return;
    }
    // Guardar: cambia la base de la dirección personalizada (destino y estado intactos).
    const result = renameCustomAddressBase(services.customAddresses.getSnapshot(), selected.entry.id, selected.base, services.now());
    if (!result.ok) {
      setChoice(null);
      setRebaseError(rebaseMessage(result.errors.address ?? result.errors.target));
      return;
    }
    services.customAddresses.set(result.entries);
    notify('success', m.addressBar.rebase.saved(shortAddress(result.entry.address)));
    finish();
  };

  const run = (suggestion: Suggestion | undefined) => {
    let done = false;
    if (!suggestion || suggestion.kind === 'primary') {
      // Si solo se cambió la base de una página personalizada, se ofrece guardarla.
      const edit = split?.entry ? classifyAddressEdit(split, value) : null;
      if (split?.entry && edit?.kind === 'rebase') {
        setChoice({ base: edit.base, url: edit.url, entry: split.entry });
        setChoiceIndex(0);
        return;
      }
      done = navigateInput(value);
    } else if (suggestion.kind === 'shortcut') {
      openUrl(suggestion.shortcut.url);
      done = true;
    } else if (suggestion.kind === 'history') {
      openUrl(suggestion.item.url);
      done = true;
    } else if (suggestion.kind === 'bookmark') {
      openUrl(suggestion.bookmark.url);
      done = true;
    } else {
      openUrl(suggestion.entry.target);
      done = true;
    }
    if (done) finish();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (choiceOpen && choice) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setChoiceIndex((index) => (index + 1) % 2);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        applyChoice(choiceIndex === 0 ? 'save' : 'go', choice);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setChoice(null);
      }
      return;
    }
    if (rebase && event.key === 'Enter') {
      event.preventDefault();
      submitRebase(rebase);
      return;
    }
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
  const errorOpen = editing && rebaseError !== null;
  // «Editar base» aparece al editar una página web cuya dirección tiene algo que conservar.
  const canRebase = editing && !dirty && !rebase && split !== null && (split.suffix !== '' || split.entry !== null);
  const showPageActions = presentation.kind === 'web' && !(editing && dirty) && !rebase;
  useOverlayLayer(listOpen || infoOpen || choiceOpen || errorOpen);

  return (
    <div className={`omnibox${editing ? ' is-editing' : ''}${listOpen || choiceOpen || errorOpen ? ' is-open' : ''}${rebase ? ' is-rebasing' : ''}`}>
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
            aria-label={rebase ? m.addressBar.rebase.label : m.addressBar.label}
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
              setRebase(null);
              setChoice(null);
              setRebaseError(null);
              shownEditable.current = editable;
              setValue(editable);
            }}
            onChange={(event) => {
              selectOnMouseUp.current = false;
              setValue(event.target.value);
              setDirty(true);
              setHighlight(0);
              setChoice(null);
              setRebaseError(null);
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

        {rebase && rebase.suffix && (
          <span className="omnibox__suffix" title={m.addressBar.rebase.keep(rebase.suffix)} data-testid="rebase-suffix">
            <span className="omnibox__suffix-text">{rebase.suffix}</span>
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              aria-label={m.addressBar.rebase.drop}
              title={m.addressBar.rebase.drop}
              onMouseDown={(event) => event.preventDefault()}
              onClick={dropSuffix}
            >
              <Icon name="close" size={12} />
            </button>
          </span>
        )}

        {canRebase && split && (
          <button
            type="button"
            className="omnibox__rebase-btn"
            title={m.addressBar.rebase.buttonTitle(split.suffix || '/')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={startRebase}
          >
            <Icon name="edit" size={12} />
            {m.addressBar.rebase.button}
          </button>
        )}

        {showPageActions && desktop && <ZoomIndicator />}
        {showPageActions && <BookmarkStar url={presentation.realUrl} title={presentation.title} />}

        {editing && value && !rebase && (
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

      {choiceOpen && choice && (
        <div className="omnibox__dropdown">
          <ul role="listbox" aria-label={m.addressBar.rebase.choices} className="suggestions" data-testid="rebase-choices">
            {(['save', 'go'] as const).map((kind, index) => (
              <li
                key={kind}
                role="option"
                aria-selected={index === choiceIndex}
                className={`suggestion${index === choiceIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setChoiceIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyChoice(kind, choice)}
              >
                <span className="suggestion__icon">
                  <Icon name={kind === 'save' ? 'check' : 'globe'} size={16} />
                </span>
                <span className="suggestion__main">
                  {kind === 'save' ? m.addressBar.rebase.save(shortAddress(joinBaseLabel(choice.base))) : m.addressBar.rebase.go(shortAddress(choice.url))}
                </span>
                <span className="suggestion__detail">
                  {kind === 'save' ? m.addressBar.rebase.saveDetail(shortAddress(choice.entry.address)) : m.addressBar.rebase.goDetail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {errorOpen && !choiceOpen && (
        <div className="omnibox__dropdown">
          <p className="omnibox__hint suggestion__error" role="alert">
            <Icon name="warning" size={16} />
            {rebaseError}
          </p>
        </div>
      )}

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

/** Base escrita en forma canónica para mostrarla (`otrapagina.com/` → `https://otrapagina.com/`). */
function joinBaseLabel(base: string): string {
  const joined = joinBase(base, '');
  return joined.ok ? joined.url : base;
}
