import type { ComponentType } from 'react';
import type { HomeLayout, ThemeId } from '../types/settings';

export interface HomeLayoutProps {
  layout: HomeLayout;
}

/**
 * Definición de un estilo. Los colores y el aspecto de la ventana se definen en
 * el CSS del estilo (selectores `[data-theme="…"]`); la distribución de la página
 * de inicio, en `HomeLayout`, que reutiliza los componentes compartidos.
 */
export interface ThemeDefinition {
  id: ThemeId;
  HomeLayout: ComponentType<HomeLayoutProps>;
}
