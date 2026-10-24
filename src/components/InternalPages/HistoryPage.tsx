/** Página icarus://historial: historial persistente con búsqueda y borrado. */

import { useMemo, useState } from 'react';
import { useHistoryItems, useNative } from '../../hooks/useNative';
import { useMessages } from '../../i18n';
import { hostnameOf } from '../../services/format';
import type { ClearRange } from '../../types/native';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';
import { useToast } from '../common/Toast';
import { DesktopOnlyNotice } from './DesktopOnlyNotice';
import './InternalPages.css';

export function HistoryPage() {
  const m = useMessages();
  const t = m.history;
  const native = useNative();
  const notify = useToast();
  const { openUrl } = useBrowser();
  const { items, loading } = useHistoryItems();
  const [query, setQuery] = useState('');
  const [clearRange, setClearRange] = useState<ClearRange | null>(null);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? items.filter((item) => item.title.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle))
      : items;
    const byDay = new Map<string, typeof filtered>();
    for (const item of filtered.slice(0, 1000)) {
      const day = new Date(item.visitedAt).toLocaleDateString(m.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const list = byDay.get(day);
      if (list) list.push(item);
      else byDay.set(day, [item]);
    }
    return [...byDay.entries()];
  }, [items, m.locale, query]);

  if (!native) return <DesktopOnlyNotice title={t.title} />;

  return (
    <section className="list-page" aria-labelledby="history-title">
      <header className="list-page__header">
        <h1 id="history-title">
          <Icon name="history" size={22} />
          {t.title}
        </h1>
        <label className="list-page__search">
          <Icon name="search" size={16} />
          <span className="visually-hidden">{t.search}</span>
          <input type="search" className="input" placeholder={t.search} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <select
          className="select list-page__clear"
          aria-label={t.clear}
          value=""
          onChange={(event) => setClearRange((event.target.value as ClearRange) || null)}
        >
          <option value="">{t.clear}</option>
          <option value="hour">{m.privacy.ranges.hour}</option>
          <option value="day">{m.privacy.ranges.day}</option>
          <option value="week">{m.privacy.ranges.week}</option>
          <option value="all">{m.privacy.ranges.all}</option>
        </select>
      </header>

      {loading ? null : groups.length === 0 ? (
        <p className="list-page__empty">{query ? t.noResults : t.empty}</p>
      ) : (
        groups.map(([day, list]) => (
          <div key={day} className="history-group">
            <h2 className="history-group__day">{day}</h2>
            <ul className="history-list">
              {list.map((item) => (
                <li key={item.id} className="history-row">
                  <time className="history-row__time">
                    {new Date(item.visitedAt).toLocaleTimeString(m.locale, { hour: '2-digit', minute: '2-digit' })}
                  </time>
                  <Favicon url={item.url} label={item.title} size={16} />
                  <button type="button" className="history-row__open" onClick={() => openUrl(item.url)} title={item.url}>
                    <span className="history-row__title">{item.title || item.url}</span>
                    <span className="history-row__host">{hostnameOf(item.url)}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={t.remove(item.title || item.url)}
                    onClick={() => void native.history.remove(item.id)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <ConfirmDialog
        open={clearRange !== null}
        title={t.clearTitle}
        message={clearRange ? t.clearBody(m.privacy.ranges[clearRange]) : ''}
        confirmLabel={t.clearConfirm}
        danger
        onCancel={() => setClearRange(null)}
        onConfirm={() => {
          const range = clearRange;
          setClearRange(null);
          if (!range) return;
          void native.privacy
            .clearData({ range, history: true, cookies: false, cache: false, downloads: false })
            .then(() => notify('success', t.cleared));
        }}
      />
    </section>
  );
}
