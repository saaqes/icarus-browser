/**
 * Controles de apariencia compartidos por el panel «Personalizar» y por
 * Configuración → Apariencia. Todos modifican solo la configuración del estilo
 * activo (o la lista global de widgets) y se guardan al instante.
 */

import { useRef, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useAppearance } from '../../hooks/useAppearance';
import { useBackgroundImage, useSettings } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { PrepareImageFailure, prepareBackgroundImage, ACCEPTED_IMAGE_TYPES } from '../../services/background/backgroundImage';
import {
  resetBackground,
  resetThemeConfig,
  setTheme,
  setWidgetEnabled,
  updateLayout,
  updateThemeConfig,
} from '../../services/settings/settings';
import { ACCENT_COLORS, THEME_ACCENTS } from '../../themes/accents';
import { BACKGROUND_PRESETS } from '../../themes/backgrounds';
import { BACKGROUND_SWATCHES } from '../../themes/color';
import {
  ACCENT_IDS,
  BACKGROUND_PRESET_IDS,
  SHORTCUT_COLUMNS,
  THEME_IDS,
  WIDGET_IDS,
  type ColorMode,
  type HomeLayout,
  type ThemeConfig,
  type ThemeId,
} from '../../types/settings';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Segmented, Toggle } from '../common/Controls';
import { Icon } from '../common/Icon';
import { useToast } from '../common/Toast';
import './AppearanceControls.css';

function useThemeUpdaters() {
  const [settings, updateSettings] = useSettings();
  const themeId = settings.appearance.theme;
  return {
    settings,
    themeId,
    config: settings.appearance.themes[themeId],
    updateConfig: (patch: Partial<ThemeConfig>) => updateSettings((current) => updateThemeConfig(current, themeId, patch)),
    updateLayout: (patch: Partial<HomeLayout>) => updateSettings((current) => updateLayout(current, themeId, patch)),
    updateSettings,
  };
}

export function ThemePicker() {
  const m = useMessages();
  const { themeId, updateSettings } = useThemeUpdaters();
  return (
    <fieldset className="theme-picker">
      <legend className="field-label">{m.customize.style}</legend>
      <div className="theme-picker__options">
        {THEME_IDS.map((id) => {
          const info = m.themes[id];
          return (
            <label key={id} className={`theme-card${id === themeId ? ' is-selected' : ''}`}>
              <input type="radio" name="icarus-theme" value={id} checked={id === themeId} onChange={() => updateSettings((current) => setTheme(current, id))} />
              <ThemePreview themeId={id} />
              <span className="theme-card__name">{info.name}</span>
              <span className="theme-card__inspired">{info.inspiredBy}</span>
            </label>
          );
        })}
      </div>
      <p className="field-hint">{m.themes[themeId].description}</p>
    </fieldset>
  );
}

/** Miniatura esquemática que refleja la distribución de cada estilo. */
function ThemePreview({ themeId }: { themeId: ThemeId }) {
  return (
    <span className={`theme-preview theme-preview--${themeId}`} aria-hidden="true">
      <span className="theme-preview__bar" />
      <span className="theme-preview__search" />
      <span className="theme-preview__dots">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="theme-preview__cards">
        <i />
        <i />
      </span>
    </span>
  );
}

export function ColorModeControl() {
  const m = useMessages();
  const appearance = useAppearance();
  const { config, updateConfig } = useThemeUpdaters();
  return (
    <div>
      <Segmented<ColorMode>
        label={m.customize.colorMode}
        value={config.colorMode}
        onChange={(colorMode) => updateConfig({ colorMode })}
        options={[
          { value: 'light', label: m.customize.modes.light, icon: 'sun' },
          { value: 'dark', label: m.customize.modes.dark, icon: 'moon' },
          { value: 'system', label: m.customize.modes.system, icon: 'monitor' },
        ]}
      />
      {config.colorMode === 'system' && (
        <p className="field-hint">
          {appearance.systemSupported
            ? m.customize.systemHint(m.customize.modes[appearance.systemMode].toLowerCase())
            : m.customize.systemUnsupported}
        </p>
      )}
    </div>
  );
}

export function AccentControl() {
  const m = useMessages();
  const appearance = useAppearance();
  const { themeId, config, updateConfig } = useThemeUpdaters();
  return (
    <fieldset className="swatches">
      <legend className="field-label">{m.customize.accent}</legend>
      <div className="swatches__row">
        {ACCENT_IDS.map((id) => {
          const pair = id === 'default' ? THEME_ACCENTS[themeId] : ACCENT_COLORS[id];
          return (
            <label key={id} className={`swatch${config.accent === id ? ' is-selected' : ''}`} title={m.customize.accents[id]}>
              <input type="radio" name="icarus-accent" value={id} checked={config.accent === id} onChange={() => updateConfig({ accent: id })} />
              <span className={`swatch__color${id === 'default' ? ' swatch__color--default' : ''}`} style={{ background: pair[appearance.mode] }} />
              <span className="visually-hidden">{m.customize.accents[id]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function BackgroundControl() {
  const m = useMessages();
  const services = useServices();
  const notify = useToast();
  const { themeId, config, updateConfig, updateSettings } = useThemeUpdaters();
  const [uploaded, setUploaded] = useBackgroundImage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const bg = config.background;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const image = await prepareBackgroundImage(file);
      const result = setUploaded(image);
      if (!result.ok) {
        // No cabe: se descarta para no perder la imagen al recargar sin avisar.
        services.backgroundImage.set(uploaded);
        notify('error', m.customize.uploadErrors.quota);
        return;
      }
      updateConfig({ background: { kind: 'upload' } });
      notify('success', m.customize.uploadSaved);
    } catch (error) {
      const reason = error instanceof PrepareImageFailure ? error.reason : 'decode';
      notify('error', m.customize.uploadErrors[reason]);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <fieldset className="background-control">
      <legend className="field-label">{m.customize.background}</legend>

      <div className="background-control__group">
        <label className={`bg-option bg-option--theme${bg.kind === 'theme' ? ' is-selected' : ''}`}>
          <input type="radio" name="icarus-bg" checked={bg.kind === 'theme'} onChange={() => updateConfig({ background: { kind: 'theme' } })} />
          <span className="bg-option__preview" />
          <span className="bg-option__label">{m.customize.backgroundTheme}</span>
        </label>
      </div>

      <p className="field-sublabel">{m.customize.backgroundColors}</p>
      <div className="swatches__row">
        {BACKGROUND_SWATCHES.map((color) => (
          <label key={color} className={`swatch swatch--square${bg.kind === 'color' && bg.color === color ? ' is-selected' : ''}`} title={color}>
            <input type="radio" name="icarus-bg" checked={bg.kind === 'color' && bg.color === color} onChange={() => updateConfig({ background: { kind: 'color', color } })} />
            <span className="swatch__color" style={{ background: color }} />
            <span className="visually-hidden">{color}</span>
          </label>
        ))}
        <label className={`swatch swatch--square swatch--custom${bg.kind === 'color' && !(BACKGROUND_SWATCHES as readonly string[]).includes(bg.color) ? ' is-selected' : ''}`} title={m.customize.customColor}>
          <span className="visually-hidden">{m.customize.customColor}</span>
          <input
            type="color"
            value={bg.kind === 'color' ? bg.color : '#2a2440'}
            onChange={(event) => updateConfig({ background: { kind: 'color', color: event.target.value.toLowerCase() } })}
          />
        </label>
      </div>

      <p className="field-sublabel">{m.customize.backgroundImages}</p>
      <div className="bg-images">
        {BACKGROUND_PRESET_IDS.map((presetId) => (
          <label key={presetId} className={`bg-option${bg.kind === 'preset' && bg.presetId === presetId ? ' is-selected' : ''}`}>
            <input type="radio" name="icarus-bg" checked={bg.kind === 'preset' && bg.presetId === presetId} onChange={() => updateConfig({ background: { kind: 'preset', presetId } })} />
            <span className="bg-option__preview" style={{ backgroundImage: `url("${BACKGROUND_PRESETS[presetId]}")` }} />
            <span className="bg-option__label">{m.customize.presets[presetId]}</span>
          </label>
        ))}
        {uploaded && (
          <label className={`bg-option${bg.kind === 'upload' ? ' is-selected' : ''}`}>
            <input type="radio" name="icarus-bg" checked={bg.kind === 'upload'} onChange={() => updateConfig({ background: { kind: 'upload' } })} />
            <span className="bg-option__preview" style={{ backgroundImage: `url("${uploaded.dataUrl}")` }} />
            <span className="bg-option__label">{m.customize.uploaded}</span>
          </label>
        )}
      </div>

      <div className="background-control__actions">
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} />
          {m.customize.upload}
        </button>
        <input ref={fileRef} type="file" hidden accept={ACCEPTED_IMAGE_TYPES.join(',')} onChange={(event) => onFile(event.target.files?.[0])} />
        {uploaded && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setUploaded(null);
              updateSettings((current) => {
                let next = current;
                for (const id of THEME_IDS) {
                  if (next.appearance.themes[id].background.kind === 'upload') next = resetBackground(next, id);
                }
                return next;
              });
            }}
          >
            <Icon name="trash" size={14} />
            {m.customize.removeUpload}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => updateSettings((current) => resetBackground(current, themeId))}>
          <Icon name="restore" size={14} />
          {m.customize.restoreBackground}
        </button>
      </div>
    </fieldset>
  );
}

export function LayoutControl() {
  const m = useMessages();
  const { config, updateLayout: patch } = useThemeUpdaters();
  const layout = config.layout;
  return (
    <div className="layout-control">
      <p className="field-label">{m.customize.layout}</p>
      <Segmented
        label={m.customize.searchPosition}
        value={layout.searchPosition}
        onChange={(searchPosition) => patch({ searchPosition })}
        options={[
          { value: 'center', label: m.customize.positions.center },
          { value: 'top', label: m.customize.positions.top },
        ]}
      />
      <Segmented
        label={m.customize.shortcutStyle}
        value={layout.shortcutStyle}
        onChange={(shortcutStyle) => patch({ shortcutStyle })}
        options={[
          { value: 'circle', label: m.customize.shortcutStyles.circle },
          { value: 'tile', label: m.customize.shortcutStyles.tile },
          { value: 'dock', label: m.customize.shortcutStyles.dock },
        ]}
      />
      <Segmented
        label={m.customize.columns}
        value={layout.shortcutColumns}
        onChange={(shortcutColumns) => patch({ shortcutColumns })}
        options={SHORTCUT_COLUMNS.map((value) => ({ value, label: String(value) }))}
      />
      <Segmented
        label={m.customize.density}
        value={layout.density}
        onChange={(density) => patch({ density })}
        options={[
          { value: 'comfortable', label: m.customize.densities.comfortable },
          { value: 'compact', label: m.customize.densities.compact },
        ]}
      />
      <Segmented
        label={m.customize.widgetPlacement}
        value={layout.widgetPlacement}
        onChange={(widgetPlacement) => patch({ widgetPlacement })}
        options={[
          { value: 'below', label: m.customize.placements.below },
          { value: 'side', label: m.customize.placements.side },
        ]}
      />
    </div>
  );
}

export function VisibilityControl() {
  const m = useMessages();
  const { settings, config, updateLayout: patch, updateSettings } = useThemeUpdaters();
  return (
    <div className="visibility-control">
      <p className="field-label">{m.customize.visibility}</p>
      <Toggle label={m.customize.showShortcuts} checked={config.layout.showShortcuts} onChange={(showShortcuts) => patch({ showShortcuts })} />
      <Toggle label={m.customize.showWidgets} checked={config.layout.showWidgets} onChange={(showWidgets) => patch({ showWidgets })} />
      <fieldset className="widget-checklist" disabled={!config.layout.showWidgets}>
        <legend className="field-sublabel">{m.customize.widgetsList}</legend>
        {WIDGET_IDS.map((id) => (
          <label key={id} className="checkbox">
            <input
              type="checkbox"
              checked={settings.appearance.widgets[id]}
              onChange={(event) => updateSettings((current) => setWidgetEnabled(current, id, event.target.checked))}
            />
            <span>
              <span className="checkbox__label">{m.widgets.names[id]}</span>
              <span className="checkbox__description">{m.widgets.descriptions[id]}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function ResetThemeControl() {
  const m = useMessages();
  const notify = useToast();
  const { themeId, updateSettings } = useThemeUpdaters();
  const [confirming, setConfirming] = useState(false);
  const name = m.themes[themeId].name;
  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(true)}>
        <Icon name="restore" size={14} />
        {m.customize.resetTheme(name)}
      </button>
      <ConfirmDialog
        open={confirming}
        title={m.customize.resetThemeTitle}
        message={m.customize.resetThemeBody(name)}
        confirmLabel={m.common.restore}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          updateSettings((current) => resetThemeConfig(current, themeId));
          setConfirming(false);
          notify('success', m.customize.resetThemeDone(name));
        }}
      />
    </>
  );
}

export function ReduceMotionControl() {
  const m = useMessages();
  const [settings, updateSettings] = useSettings();
  return (
    <Toggle
      label={m.customize.reduceMotion}
      description={m.customize.reduceMotionHint}
      checked={settings.appearance.reduceMotion}
      onChange={(reduceMotion) => updateSettings((current) => ({ ...current, appearance: { ...current.appearance, reduceMotion } }))}
    />
  );
}
