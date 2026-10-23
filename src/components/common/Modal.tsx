import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMessages } from '../../i18n';
import { Icon } from './Icon';
import { useOverlayRoot } from './OverlayRoot';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
  description?: string;
  /** Rol del diálogo: `alertdialog` para confirmaciones. */
  role?: 'dialog' | 'alertdialog';
  className?: string;
  hideHeader?: boolean;
}

/** Diálogo modal accesible: foco inicial, ciclo de tabulación, Escape y restauración del foco. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  description,
  role = 'dialog',
  className,
  hideHeader = false,
}: ModalProps) {
  const m = useMessages();
  const container = useOverlayRoot();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    panel?.addEventListener('keydown', onKey);
    return () => {
      panel?.removeEventListener('keydown', onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  const content = (
    <div className="modal-layer">
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`modal modal--${size}${className ? ` ${className}` : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className={hideHeader ? 'visually-hidden' : 'modal__header'}>
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={m.common.close}>
            <Icon name="close" />
          </button>
        </header>
        {description && (
          <p id={descriptionId} className="modal__description">
            {description}
          </p>
        )}
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  );

  return createPortal(content, container ?? document.body);
}
