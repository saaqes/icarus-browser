/** Historial de navegación persistente (solo páginas http/https de nivel superior). */

import { randomUUID } from 'node:crypto';
import type { ClearRange, HistoryItem } from '../../src/types/native';
import { JsonFile } from './jsonFile';
import { isRecord } from './validate';

export const MAX_HISTORY_ITEMS = 10_000;
/** Visitas repetidas a la misma URL en este intervalo se agrupan. */
const MERGE_WINDOW_MS = 30_000;

export function sanitizeHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is HistoryItem =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.url === 'string' &&
        /^https?:\/\//i.test(item.url) &&
        typeof item.title === 'string' &&
        typeof item.visitedAt === 'number',
    )
    .slice(0, MAX_HISTORY_ITEMS);
}

export const RANGE_MS: Record<ClearRange, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  all: Number.POSITIVE_INFINITY,
};

export class HistoryStore {
  private readonly file: JsonFile<HistoryItem[]>;

  constructor(
    path: string,
    private readonly onChange: () => void,
  ) {
    this.file = new JsonFile(path, { version: 1, defaults: () => [], sanitize: sanitizeHistory, delayMs: 1500 });
  }

  /** Lista de la más reciente a la más antigua. */
  list(): HistoryItem[] {
    return this.file.get();
  }

  add(url: string, title: string, now = Date.now()): void {
    if (!/^https?:\/\//i.test(url)) return;
    this.file.update((items) => {
      const latest = items[0];
      if (latest && latest.url === url && now - latest.visitedAt < MERGE_WINDOW_MS) {
        return [{ ...latest, title: title || latest.title, visitedAt: now }, ...items.slice(1)];
      }
      return [{ id: randomUUID(), url, title, visitedAt: now }, ...items].slice(0, MAX_HISTORY_ITEMS);
    });
    this.onChange();
  }

  updateTitle(url: string, title: string): void {
    if (!title) return;
    const items = this.file.get();
    const index = items.findIndex((item) => item.url === url);
    if (index < 0 || index > 5 || items[index]!.title === title) return;
    this.file.set(items.map((item, i) => (i === index ? { ...item, title } : item)));
    this.onChange();
  }

  remove(id: string): void {
    this.file.update((items) => items.filter((item) => item.id !== id));
    this.onChange();
  }

  clear(range: ClearRange, now = Date.now()): void {
    const limit = RANGE_MS[range];
    this.file.update((items) => (range === 'all' ? [] : items.filter((item) => now - item.visitedAt > limit)));
    this.onChange();
  }

  flush(): void {
    this.file.flush();
  }
}
