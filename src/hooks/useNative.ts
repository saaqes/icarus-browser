/** Datos de la aplicación de escritorio (proceso principal), con actualización por eventos. */

import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../app/ServicesContext';
import type { DesktopPreferences, DownloadItemInfo, HistoryItem, ShieldState } from '../types/native';

export function useNative() {
  return useServices().native;
}

export function useDownloads(): DownloadItemInfo[] {
  const native = useNative();
  const [downloads, setDownloads] = useState<DownloadItemInfo[]>([]);
  useEffect(() => {
    if (!native) return undefined;
    let active = true;
    void native.downloads.list().then((list) => active && setDownloads(list));
    const off = native.onEvent((event) => {
      if (event.type === 'downloads') setDownloads(event.downloads);
    });
    return () => {
      active = false;
      off();
    };
  }, [native]);
  return downloads;
}

export function useShieldState(): [ShieldState | null, (state: ShieldState) => void] {
  const native = useNative();
  const [state, setState] = useState<ShieldState | null>(null);
  useEffect(() => {
    if (!native) return undefined;
    let active = true;
    void native.shield.getState().then((value) => active && setState(value));
    const off = native.onEvent((event) => {
      if (event.type === 'shield') setState(event.state);
    });
    return () => {
      active = false;
      off();
    };
  }, [native]);
  return [state, setState];
}

export function useHistoryItems(): { items: HistoryItem[]; loading: boolean; reload: () => void } {
  const native = useNative();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(Boolean(native));
  const reload = useCallback(() => {
    if (!native) return;
    void native.history.list().then((list) => {
      setItems(list);
      setLoading(false);
    });
  }, [native]);
  useEffect(() => {
    if (!native) return undefined;
    reload();
    let timer: number | undefined;
    const off = native.onEvent((event) => {
      if (event.type !== 'history-changed') return;
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, 400);
    });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, [native, reload]);
  return { items, loading, reload };
}

export function useDesktopPreferences(): [DesktopPreferences | null, (next: DesktopPreferences) => Promise<void>] {
  const native = useNative();
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null);
  useEffect(() => {
    if (!native) return undefined;
    let active = true;
    void native.preferences.get().then((value) => active && setPreferences(value));
    return () => {
      active = false;
    };
  }, [native]);
  const update = useCallback(
    async (next: DesktopPreferences) => {
      if (!native) return;
      setPreferences(next);
      setPreferences(await native.preferences.set(next));
    },
    [native],
  );
  return [preferences, update];
}
