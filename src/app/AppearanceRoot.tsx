import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { OverlayRootContext } from '../components/common/OverlayRoot';
import { useAppearance } from '../hooks/useAppearance';
import { useServices } from './ServicesContext';

/**
 * Raíz temática: expone estilo, modo y acento como atributos y variables CSS.
 * Los temas (themes/*) definen sus tokens con selectores sobre estos atributos,
 * así que cambiar de estilo es inmediato y no recarga la aplicación.
 */
export function AppearanceRoot({ children }: { children: ReactNode }) {
  const appearance = useAppearance();
  const { native } = useServices();
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const styles = rootRef.current ? getComputedStyle(rootRef.current) : null;
    const color = styles?.getPropertyValue('--tabstrip-bg').trim() ?? '';
    if (meta && color) meta.setAttribute('content', color);
    document.documentElement.style.colorScheme = appearance.mode;
    // En escritorio, los botones nativos de la ventana adoptan los colores del estilo.
    const symbolColor = styles?.getPropertyValue('--tab-fg-active').trim() ?? '';
    if (native && /^#[0-9a-f]{6}$/i.test(color) && /^#[0-9a-f]{6}$/i.test(symbolColor)) {
      native.window.setTitleBarColors({ color, symbolColor });
    }
  }, [appearance.mode, appearance.themeId, native]);

  const style = {
    '--accent': appearance.accent,
    '--accent-contrast': appearance.accentContrast,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className="icarus-root"
      data-theme={appearance.themeId}
      data-mode={appearance.mode}
      data-reduce-motion={appearance.reduceMotion ? 'true' : undefined}
      style={style}
    >
      <OverlayRootContext.Provider value={overlayRoot}>{children}</OverlayRootContext.Provider>
      <div ref={setOverlayRoot} className="overlay-root" />
    </div>
  );
}
