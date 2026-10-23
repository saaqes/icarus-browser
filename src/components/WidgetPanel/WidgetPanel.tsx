import type { ComponentType } from 'react';
import { useSettings } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { setWidgetEnabled } from '../../services/settings/settings';
import { WIDGET_IDS, type WidgetId, type WidgetPlacement } from '../../types/settings';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon, type IconName } from '../common/Icon';
import { CalendarWidget, ClockWidget, NotesWidget, SourcesWidget, TasksWidget } from './widgets';
import './WidgetPanel.css';

const WIDGETS: Record<WidgetId, { icon: IconName; Component: ComponentType }> = {
  clock: { icon: 'clock', Component: ClockWidget },
  calendar: { icon: 'calendar', Component: CalendarWidget },
  notes: { icon: 'note', Component: NotesWidget },
  tasks: { icon: 'tasks', Component: TasksWidget },
  sources: { icon: 'feed', Component: SourcesWidget },
};

interface WidgetPanelProps {
  placement: WidgetPlacement;
  /** Widgets que el estilo ya muestra por su cuenta (p. ej. el reloj de ICARUS). */
  exclude?: WidgetId[];
}

/** Tarjetas configurables. Cada una se puede ocultar y volver a mostrar desde Personalizar. */
export function WidgetPanel({ placement, exclude = [] }: WidgetPanelProps) {
  const m = useMessages();
  const [settings, updateSettings] = useSettings();
  const { setCustomizeOpen } = useBrowser();
  const visible = WIDGET_IDS.filter((id) => settings.appearance.widgets[id] && !exclude.includes(id));

  if (visible.length === 0) {
    return (
      <section className={`widgets widgets--${placement} widgets--empty`} aria-label={m.widgets.region}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCustomizeOpen(true)}>
          <Icon name="layout" size={16} />
          {m.widgets.manage}
        </button>
      </section>
    );
  }

  return (
    <section className={`widgets widgets--${placement}`} aria-label={m.widgets.region}>
      {visible.map((id) => {
        const { icon, Component } = WIDGETS[id];
        const name = m.widgets.names[id];
        return (
          <article key={id} className={`widget widget--${id}`} aria-label={name}>
            <header className="widget__header">
              <Icon name={icon} size={16} />
              <h2 className="widget__title">{name}</h2>
              <button
                type="button"
                className="icon-btn icon-btn--sm widget__hide"
                aria-label={m.widgets.hide(name)}
                title={m.widgets.hide(name)}
                onClick={() => updateSettings((current) => setWidgetEnabled(current, id, false))}
              >
                <Icon name="close" size={14} />
              </button>
            </header>
            <div className="widget__body">
              <Component />
            </div>
          </article>
        );
      })}
    </section>
  );
}
