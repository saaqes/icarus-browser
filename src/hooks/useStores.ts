/** Hooks de acceso a los stores persistentes. */

import { useCallback, useSyncExternalStore } from 'react';
import { useServices } from '../app/ServicesContext';
import type { PersistentStore } from '../services/persistence/store';
import type { SaveResult } from '../services/persistence/document';

export function useStoreValue<T>(store: PersistentStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

type Updater<T> = (update: T | ((previous: T) => T)) => SaveResult;

function useStore<T>(store: PersistentStore<T>): [T, Updater<T>] {
  const value = useStoreValue(store);
  const update = useCallback<Updater<T>>((next) => store.set(next), [store]);
  return [value, update];
}

export const useSettings = () => useStore(useServices().settings);
export const useShortcuts = () => useStore(useServices().shortcuts);
export const useCustomAddresses = () => useStore(useServices().customAddresses);
export const useWidgetData = () => useStore(useServices().widgets);
export const useBackgroundImage = () => useStore(useServices().backgroundImage);
