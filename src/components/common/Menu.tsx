import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { Icon, type IconName } from './Icon';
import { useOverlayLayer } from './overlayLayer';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface MenuButtonProps {
  label: string;
  items: MenuItem[];
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
}

/** Botón con menú desplegable accesible (flechas, Inicio/Fin, Escape). */
export function MenuButton({ label, items, children, className, align = 'end' }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);
  useOverlayLayer(open);

  // El menú se coloca de forma fija respecto a la ventana para que ningún
  // contenedor con desplazamiento lo recorte; se cierra al desplazar o redimensionar.
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 240;
      const height = items.length * 36 + 10;
      const left = align === 'end' ? rect.right - width : rect.left;
      // Si no cabe por debajo, se abre hacia arriba.
      const top = rect.bottom + 6 + height > window.innerHeight ? Math.max(8, rect.top - 6 - height) : rect.bottom + 6;
      setPosition({
        top,
        left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
        width,
      });
    }
    setOpen((value) => !value);
  };

  const focusItem = (index: number) => {
    const elements = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (!elements || elements.length === 0) return;
    elements[(index + elements.length) % elements.length]?.focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const elements = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const current = elements.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(elements.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={className ?? 'icon-btn'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            toggle();
            requestAnimationFrame(() => focusItem(0));
          }
        }}
      >
        {children}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className="menu" style={position} onKeyDown={onMenuKeyDown}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={16} /> : <span className="menu__spacer" />}
              <span className="menu__label">{item.label}</span>
              {item.shortcut && <kbd className="menu__shortcut">{item.shortcut}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
