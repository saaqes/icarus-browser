/**
 * ICARUS Shield en el proceso principal: guarda la configuración y las listas,
 * las actualiza desde sus fuentes y filtra las solicitudes reales de las
 * pestañas mediante `session.webRequest.onBeforeRequest`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Session, WebContents } from 'electron';
import type { AddListResult, ShieldListError, ShieldListInfo, ShieldState } from '../../src/types/native';
import { BUILTIN_LIST_TEXT } from '../shield/builtinList';
import { getRegistrableDomain, hostMatchesDomain } from '../shield/domains';
import { FilterEngine } from '../shield/engine';
import { looksLikeHtml, parseFilterList, type NetworkFilter, type ResourceType } from '../shield/filters';
import { JsonFile } from './jsonFile';
import { parseNavigableUrl } from './urlPolicy';
import { isRecord } from './validate';

const MAX_LIST_BYTES = 15 * 1024 * 1024;
const MAX_CUSTOM_RULES_LENGTH = 200_000;
const UPDATE_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;
const BUILTIN_ID = 'icarus-basic';

interface ListConfig {
  id: string;
  name: string;
  url: string | null;
  enabled: boolean;
  builtIn: boolean;
}

interface ListMeta {
  ruleCount: number;
  ignoredCount: number;
  invalidCount: number;
  lastUpdated: number | null;
  error: ShieldListError | null;
}

interface ShieldConfig {
  enabled: boolean;
  lists: ListConfig[];
  customRules: string;
  exceptions: string[];
  totalBlocked: number;
  meta: Record<string, ListMeta>;
}

export const DEFAULT_LISTS: ListConfig[] = [
  { id: BUILTIN_ID, name: 'ICARUS básica', url: null, enabled: true, builtIn: true },
  { id: 'easylist', name: 'EasyList (anuncios)', url: 'https://easylist.to/easylist/easylist.txt', enabled: true, builtIn: true },
  { id: 'easyprivacy', name: 'EasyPrivacy (rastreadores)', url: 'https://easylist.to/easylist/easyprivacy.txt', enabled: true, builtIn: true },
  {
    id: 'peter-lowe',
    name: 'Peter Lowe (servidores de anuncios)',
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
    enabled: false,
    builtIn: true,
  },
];

function defaultConfig(): ShieldConfig {
  return { enabled: true, lists: DEFAULT_LISTS.map((list) => ({ ...list })), customRules: '', exceptions: [], totalBlocked: 0, meta: {} };
}

function sanitizeConfig(raw: unknown): ShieldConfig {
  const defaults = defaultConfig();
  if (!isRecord(raw)) return defaults;
  const lists: ListConfig[] = [];
  const stored = Array.isArray(raw.lists) ? raw.lists.filter(isRecord) : [];
  // Las listas predefinidas siempre existen; se conserva su estado activado.
  for (const builtIn of defaults.lists) {
    const match = stored.find((item) => item.id === builtIn.id);
    lists.push({ ...builtIn, enabled: typeof match?.enabled === 'boolean' ? match.enabled : builtIn.enabled });
  }
  for (const item of stored) {
    if (lists.some((list) => list.id === item.id)) continue;
    const url = typeof item.url === 'string' ? parseNavigableUrl(item.url) : null;
    if (typeof item.id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(item.id) || !url || url.protocol !== 'https:') continue;
    lists.push({
      id: item.id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.slice(0, 80) : url.hostname,
      url: url.href,
      enabled: item.enabled !== false,
      builtIn: false,
    });
  }
  const meta: Record<string, ListMeta> = {};
  if (isRecord(raw.meta)) {
    for (const [id, value] of Object.entries(raw.meta)) {
      if (!isRecord(value)) continue;
      meta[id] = {
        ruleCount: Number(value.ruleCount) || 0,
        ignoredCount: Number(value.ignoredCount) || 0,
        invalidCount: Number(value.invalidCount) || 0,
        lastUpdated: typeof value.lastUpdated === 'number' ? value.lastUpdated : null,
        error: typeof value.error === 'string' ? (value.error as ShieldListError) : null,
      };
    }
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    lists,
    customRules: typeof raw.customRules === 'string' ? raw.customRules.slice(0, MAX_CUSTOM_RULES_LENGTH) : '',
    exceptions: Array.isArray(raw.exceptions)
      ? raw.exceptions.filter((host): host is string => typeof host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(host)).slice(0, 2000)
      : [],
    totalBlocked: typeof raw.totalBlocked === 'number' && raw.totalBlocked >= 0 ? Math.floor(raw.totalBlocked) : 0,
    meta,
  };
}

const RESOURCE_MAP: Record<string, ResourceType> = {
  mainFrame: 'document',
  subFrame: 'subdocument',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'other',
  media: 'media',
  webSocket: 'websocket',
  other: 'other',
};

export type FetchText = (url: string) => Promise<{ ok: true; text: string } | { ok: false; error: ShieldListError }>;

export class ShieldService {
  private readonly file: JsonFile<ShieldConfig>;
  private readonly listsDir: string;
  private engine = new FilterEngine([]);
  private customStats = { ruleCount: 0, invalidCount: 0 };
  private readonly updating = new Set<string>();
  private readonly pageCounts = new Map<number, number>();
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(
    dir: string,
    private readonly fetchText: FetchText,
    private readonly emitState: (state: ShieldState) => void,
    private readonly onPageCountChanged: (webContentsId: number) => void,
  ) {
    this.listsDir = join(dir, 'lists');
    mkdirSync(this.listsDir, { recursive: true });
    this.file = new JsonFile(join(dir, 'shield.json'), { version: 1, defaults: defaultConfig, sanitize: sanitizeConfig, delayMs: 2000 });
    this.rebuild();
  }

  /** Conecta el filtrado a las solicitudes de la sesión de las pestañas. */
  attach(webSession: Session, resolvePageUrl: (contents: WebContents | null, webContentsId: number) => string | null): void {
    webSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        const config = this.file.get();
        const type = RESOURCE_MAP[details.resourceType] ?? 'other';
        if (!config.enabled || type === 'document' || details.webContentsId === undefined) return callback({});
        const pageUrl = resolvePageUrl(details.webContents ?? null, details.webContentsId);
        if (!pageUrl || this.isSiteAllowed(pageUrl)) return callback({});
        const result = this.engine.match({ url: details.url, type, pageUrl });
        if (!result.blocked) return callback({});
        this.countBlocked(details.webContentsId);
        callback({ cancel: true });
      },
    );
  }

  isSiteAllowed(pageUrl: string): boolean {
    const host = parseNavigableUrl(pageUrl)?.hostname.toLowerCase();
    if (!host) return false;
    return this.file.get().exceptions.some((domain) => hostMatchesDomain(host, domain));
  }

  pageBlockedCount(webContentsId: number): number {
    return this.pageCounts.get(webContentsId) ?? 0;
  }

  resetPage(webContentsId: number): void {
    this.pageCounts.delete(webContentsId);
  }

  forgetPage(webContentsId: number): void {
    this.pageCounts.delete(webContentsId);
  }

  state(): ShieldState {
    const config = this.file.get();
    const lists: ShieldListInfo[] = config.lists.map((list) => {
      const meta = config.meta[list.id];
      return {
        id: list.id,
        name: list.name,
        url: list.url,
        enabled: list.enabled,
        builtIn: list.builtIn,
        ruleCount: meta?.ruleCount ?? 0,
        ignoredCount: meta?.ignoredCount ?? 0,
        invalidCount: meta?.invalidCount ?? 0,
        lastUpdated: meta?.lastUpdated ?? null,
        error: meta?.error ?? null,
        updating: this.updating.has(list.id),
      };
    });
    return {
      enabled: config.enabled,
      lists,
      customRules: config.customRules,
      customRuleCount: this.customStats.ruleCount,
      customInvalidCount: this.customStats.invalidCount,
      exceptions: config.exceptions,
      totalBlocked: config.totalBlocked,
      activeRuleCount: this.engine.size,
    };
  }

  setEnabled(enabled: boolean): ShieldState {
    this.file.update((config) => ({ ...config, enabled }));
    return this.changed();
  }

  setListEnabled(id: string, enabled: boolean): ShieldState {
    this.file.update((config) => ({ ...config, lists: config.lists.map((list) => (list.id === id ? { ...list, enabled } : list)) }));
    this.rebuild();
    const list = this.file.get().lists.find((item) => item.id === id);
    if (enabled && list?.url && !this.hasCachedText(id)) void this.updateList(id);
    return this.changed();
  }

  async addList(name: string, url: string): Promise<AddListResult> {
    const parsed = parseNavigableUrl(url.trim());
    if (!parsed || parsed.protocol !== 'https:') return { ok: false, error: 'invalid-url' };
    if (this.file.get().lists.some((list) => list.url === parsed.href)) return { ok: false, error: 'duplicate' };
    const id = `custom-${randomUUID().slice(0, 8)}`;
    const result = await this.download(parsed.href);
    if (!result.ok) return { ok: false, error: result.error };
    this.file.update((config) => ({
      ...config,
      lists: [...config.lists, { id, name: name.trim().slice(0, 80) || parsed.hostname, url: parsed.href, enabled: true, builtIn: false }],
    }));
    this.storeList(id, result.text, result.stats);
    this.rebuild();
    return { ok: true, state: this.changed() };
  }

  removeList(id: string): ShieldState {
    const list = this.file.get().lists.find((item) => item.id === id);
    if (!list || list.builtIn) return this.state();
    this.file.update((config) => {
      const meta = { ...config.meta };
      delete meta[id];
      return { ...config, lists: config.lists.filter((item) => item.id !== id), meta };
    });
    rmSync(this.listPath(id), { force: true });
    this.rebuild();
    return this.changed();
  }

  setCustomRules(text: string): ShieldState {
    this.file.update((config) => ({ ...config, customRules: text.slice(0, MAX_CUSTOM_RULES_LENGTH) }));
    this.rebuild();
    return this.changed();
  }

  /** Activa o desactiva Shield para un sitio (se guarda su dominio registrable). */
  setSiteAllowed(hostname: string, allowed: boolean): ShieldState {
    const domain = getRegistrableDomain(hostname.toLowerCase());
    if (!/^[a-z0-9.-]{1,253}$/.test(domain)) return this.state();
    this.file.update((config) => {
      const exceptions = config.exceptions.filter((item) => item !== domain && !hostMatchesDomain(hostname.toLowerCase(), item));
      return { ...config, exceptions: allowed ? [...exceptions, domain].sort() : exceptions };
    });
    return this.changed();
  }

  /** Actualiza las listas activas (todas o solo las caducadas). */
  async updateLists(onlyStale: boolean): Promise<ShieldState> {
    const now = Date.now();
    const config = this.file.get();
    for (const list of config.lists) {
      if (!list.enabled || !list.url) continue;
      const meta = config.meta[list.id];
      const fresh = meta?.lastUpdated && now - meta.lastUpdated < UPDATE_INTERVAL_MS && this.hasCachedText(list.id);
      if (onlyStale && fresh) continue;
      await this.updateList(list.id);
    }
    return this.state();
  }

  flush(): void {
    this.file.flush();
  }

  private async updateList(id: string): Promise<void> {
    const list = this.file.get().lists.find((item) => item.id === id);
    if (!list?.url || this.updating.has(id)) return;
    this.updating.add(id);
    this.changed();
    try {
      const result = await this.download(list.url);
      if (result.ok) {
        this.storeList(id, result.text, result.stats);
        this.rebuild();
      } else {
        // Se conserva la versión anterior de la lista si existía.
        this.setMeta(id, { error: result.error });
      }
    } finally {
      this.updating.delete(id);
      this.changed();
    }
  }

  private async download(url: string): Promise<{ ok: true; text: string; stats: Omit<ListMeta, 'lastUpdated' | 'error'> } | { ok: false; error: ShieldListError }> {
    const response = await this.fetchText(url);
    if (!response.ok) return response;
    if (looksLikeHtml(response.text)) return { ok: false, error: 'not-a-list' };
    const parsed = parseFilterList(response.text);
    if (parsed.ruleCount === 0) return { ok: false, error: 'empty' };
    return {
      ok: true,
      text: response.text,
      stats: { ruleCount: parsed.ruleCount, ignoredCount: parsed.ignoredCount, invalidCount: parsed.invalidCount },
    };
  }

  private storeList(id: string, text: string, stats: Omit<ListMeta, 'lastUpdated' | 'error'>): void {
    const temp = `${this.listPath(id)}.tmp`;
    writeFileSync(temp, text, 'utf8');
    renameSync(temp, this.listPath(id));
    this.setMeta(id, { ...stats, lastUpdated: Date.now(), error: null });
  }

  private setMeta(id: string, patch: Partial<ListMeta>): void {
    this.file.update((config) => {
      const current = config.meta[id] ?? { ruleCount: 0, ignoredCount: 0, invalidCount: 0, lastUpdated: null, error: null };
      return { ...config, meta: { ...config.meta, [id]: { ...current, ...patch } } };
    });
  }

  private listPath(id: string): string {
    return join(this.listsDir, `${id}.txt`);
  }

  private hasCachedText(id: string): boolean {
    return id === BUILTIN_ID || existsSync(this.listPath(id));
  }

  private rebuild(): void {
    const config = this.file.get();
    const filters: NetworkFilter[] = [];
    for (const list of config.lists) {
      if (!list.enabled) continue;
      let text: string | null = null;
      if (list.id === BUILTIN_ID) text = BUILTIN_LIST_TEXT;
      else if (existsSync(this.listPath(list.id))) {
        try {
          text = readFileSync(this.listPath(list.id), 'utf8');
        } catch {
          text = null;
        }
      }
      if (text === null) continue;
      const parsed = parseFilterList(text);
      filters.push(...parsed.filters);
      if (list.id === BUILTIN_ID) {
        const meta = config.meta[BUILTIN_ID];
        if (!meta || meta.ruleCount !== parsed.ruleCount) {
          this.setMeta(BUILTIN_ID, { ruleCount: parsed.ruleCount, ignoredCount: parsed.ignoredCount, invalidCount: parsed.invalidCount, error: null });
        }
      }
    }
    const custom = parseFilterList(config.customRules);
    this.customStats = { ruleCount: custom.ruleCount, invalidCount: custom.invalidCount };
    filters.push(...custom.filters);
    this.engine = new FilterEngine(filters);
  }

  private countBlocked(webContentsId: number): void {
    this.pageCounts.set(webContentsId, (this.pageCounts.get(webContentsId) ?? 0) + 1);
    this.file.update((config) => ({ ...config, totalBlocked: config.totalBlocked + 1 }));
    this.onPageCountChanged(webContentsId);
    if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null;
        this.emitState(this.state());
      }, 500);
    }
  }

  private changed(): ShieldState {
    const state = this.state();
    this.emitState(state);
    return state;
  }
}

/** Descarga una lista con límites de tamaño y tiempo, usando la pila de red de Chromium. */
export function createListFetcher(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): FetchText {
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok) return { ok: false, error: 'http' };
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > MAX_LIST_BYTES) return { ok: false, error: 'too-large' };
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_LIST_BYTES) return { ok: false, error: 'too-large' };
      return { ok: true, text: buffer.toString('utf8') };
    } catch {
      return { ok: false, error: 'network' };
    } finally {
      clearTimeout(timer);
    }
  };
}
