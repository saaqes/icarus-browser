/**
 * Página de nueva pestaña. Delega la distribución en el estilo activo
 * (themes/*): cada estilo coloca de forma distinta los mismos componentes
 * compartidos (buscador, accesos directos, widgets).
 */

import type { CSSProperties } from 'react';
import { useAppearance } from '../../hooks/useAppearance';
import { useMessages } from '../../i18n';
import { THEMES } from '../../themes/registry';
import './NewTabPage.css';

export function NewTabPage() {
  const m = useMessages();
  const appearance = useAppearance();
  const { HomeLayout } = THEMES[appearance.themeId];
  const { layout } = appearance.config;
  const { background } = appearance;

  const surface = background.kind === 'image' ? 'image' : background.kind === 'color' ? `color-${background.tone}` : 'theme';
  const style: CSSProperties & Record<string, string> = {};
  if (background.kind === 'image') style['--home-bg-image'] = `url("${background.url}")`;
  if (background.kind === 'color') style['--home-bg-color'] = background.color;

  return (
    <section
      className="home"
      aria-label={m.pages.newTab}
      data-surface={surface}
      data-density={layout.density}
      data-search={layout.searchPosition}
      data-placement={layout.widgetPlacement}
      style={style}
    >
      <div className="home__backdrop" aria-hidden="true" />
      <HomeLayout layout={layout} />
    </section>
  );
}
