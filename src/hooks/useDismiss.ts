import { useEffect, type RefObject } from 'react';

/** Cierra un elemento flotante al pulsar Escape o al hacer clic fuera de él. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void, ignore?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || ignore?.current?.contains(target)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, ignore, open, onDismiss]);
}
