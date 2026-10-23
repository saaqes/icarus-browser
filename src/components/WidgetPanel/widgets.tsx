/** Widgets locales: no muestran contenido remoto ni inventado. */

import { useMemo, useState } from 'react';
import { useServices } from '../../app/ServicesContext';
import { useNow } from '../../hooks/useNow';
import { useWidgetData } from '../../hooks/useStores';
import { useMessages } from '../../i18n';
import { addTask, clearCompletedTasks, NOTES_MAX, removeTask, setNotes, TASK_TEXT_MAX, toggleTask } from '../../services/widgets/widgets';
import { Icon } from '../common/Icon';

/** Pone en mayúscula solo la primera letra (en español los meses van en minúscula). */
export function capitalizeFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export function greetingFor(date: Date, greetings: { morning: string; afternoon: string; night: string }): string {
  const hour = date.getHours();
  if (hour >= 6 && hour < 13) return greetings.morning;
  if (hour >= 13 && hour < 20) return greetings.afternoon;
  return greetings.night;
}

export function ClockWidget() {
  const m = useMessages();
  const now = useNow();
  return (
    <div className="clock-widget">
      <p className="clock-widget__time">{now.toLocaleTimeString(m.locale, { hour: '2-digit', minute: '2-digit' })}</p>
      <p className="clock-widget__date">{capitalizeFirst(now.toLocaleDateString(m.locale, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
      <p className="clock-widget__greeting">{greetingFor(now, m.widgets.greeting)}</p>
    </div>
  );
}

export function CalendarWidget() {
  const m = useMessages();
  const now = useNow(60_000);
  const [offset, setOffset] = useState(0);
  const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();

  const { weeks, weekdays } = useMemo(() => {
    const startDay = (new Date(year, month, 1).getDay() + 6) % 7; // semana que empieza en lunes
    const days = new Date(year, month + 1, 0).getDate();
    const cells: Array<number | null> = [...Array(startDay).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: Array<Array<number | null>> = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    const monday = new Date(2024, 0, 1); // 1 de enero de 2024 fue lunes
    const names = Array.from({ length: 7 }, (_, i) =>
      new Date(monday.getFullYear(), 0, 1 + i).toLocaleDateString(m.locale, { weekday: 'narrow' }),
    );
    return { weeks: rows, weekdays: names };
  }, [year, month, m.locale]);

  const isCurrentMonth = offset === 0;
  return (
    <div className="calendar-widget">
      <div className="calendar-widget__header">
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => setOffset((o) => o - 1)} aria-label={m.widgets.calendar.previous}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <p className="calendar-widget__month">{capitalizeFirst(view.toLocaleDateString(m.locale, { month: 'long', year: 'numeric' }))}</p>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => setOffset((o) => o + 1)} aria-label={m.widgets.calendar.next}>
          <Icon name="chevronRight" size={16} />
        </button>
      </div>
      <table className="calendar-widget__grid">
        <thead>
          <tr>
            {weekdays.map((day, index) => (
              <th key={index} scope="col">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, row) => (
            <tr key={row}>
              {week.map((day, col) => (
                <td key={col} className={isCurrentMonth && day === now.getDate() ? 'is-today' : undefined} aria-current={isCurrentMonth && day === now.getDate() ? 'date' : undefined}>
                  {day ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!isCurrentMonth && (
        <button type="button" className="btn btn--ghost btn--sm calendar-widget__today" onClick={() => setOffset(0)}>
          {m.widgets.calendar.today}
        </button>
      )}
    </div>
  );
}

export function NotesWidget() {
  const m = useMessages();
  const [data, setData] = useWidgetData();
  return (
    <div className="notes-widget">
      <label className="visually-hidden" htmlFor="icarus-notes">
        {m.widgets.notes.label}
      </label>
      <textarea
        id="icarus-notes"
        className="notes-widget__input"
        value={data.notes}
        maxLength={NOTES_MAX}
        placeholder={m.widgets.notes.placeholder}
        onChange={(event) => setData((current) => setNotes(current, event.target.value))}
      />
      <p className="notes-widget__counter">{m.widgets.notes.counter(data.notes.length, NOTES_MAX)}</p>
    </div>
  );
}

export function TasksWidget() {
  const m = useMessages();
  const services = useServices();
  const [data, setData] = useWidgetData();
  const [text, setText] = useState('');
  const pending = data.tasks.filter((task) => !task.done).length;
  return (
    <div className="tasks-widget">
      <form
        className="tasks-widget__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          setData((current) => addTask(current, text, { id: services.createId(), now: services.now() }));
          setText('');
        }}
      >
        <input
          className="input input--sm"
          aria-label={m.widgets.tasks.label}
          placeholder={m.widgets.tasks.placeholder}
          value={text}
          maxLength={TASK_TEXT_MAX}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="icon-btn icon-btn--sm" aria-label={m.widgets.tasks.add}>
          <Icon name="plus" size={16} />
        </button>
      </form>
      {data.tasks.length === 0 ? (
        <p className="widget-empty">{m.widgets.tasks.empty}</p>
      ) : (
        <ul className="tasks-widget__list">
          {data.tasks.map((task) => (
            <li key={task.id} className={task.done ? 'is-done' : undefined}>
              <label>
                <input type="checkbox" checked={task.done} onChange={() => setData((current) => toggleTask(current, task.id))} />
                <span>{task.text}</span>
              </label>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label={m.widgets.tasks.remove(task.text)}
                onClick={() => setData((current) => removeTask(current, task.id))}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="tasks-widget__footer">
        <span>{m.widgets.tasks.pending(pending)}</span>
        {data.tasks.some((task) => task.done) && (
          <button type="button" className="link-btn" onClick={() => setData(clearCompletedTasks)}>
            {m.widgets.tasks.clearDone}
          </button>
        )}
      </div>
    </div>
  );
}

/** Espacio preparado para una fuente de contenido. No inventa noticias. */
export function SourcesWidget() {
  const m = useMessages();
  const t = m.widgets.sources;
  const [demo, setDemo] = useState(false);
  return (
    <div className="sources-widget">
      {demo ? (
        <>
          <p className="demo-badge">
            <Icon name="info" size={12} />
            {t.demoLabel}
          </p>
          <ul className="sources-widget__demo" aria-label={t.demoLabel}>
            {[1, 2, 3].map((n) => (
              <li key={n}>
                <span className="skeleton skeleton--thumb" aria-hidden="true" />
                <span>
                  <span className="sources-widget__title">{t.demoItem(n)}</span>
                  <span className="sources-widget__meta">{t.demoMeta}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="widget-empty widget-empty--block">
          <Icon name="feed" size={22} />
          <p className="widget-empty__title">{t.emptyTitle}</p>
          <p>{t.emptyBody}</p>
        </div>
      )}
      <button type="button" className="link-btn" onClick={() => setDemo((value) => !value)}>
        {demo ? t.hideDemo : t.showDemo}
      </button>
    </div>
  );
}
