import { useMessages } from '../../i18n';
import { useBrowser } from '../BrowserShell/BrowserContext';
import { Icon } from '../common/Icon';

/** Botón visible de personalización de la página de inicio. */
export function CustomizeButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  const m = useMessages();
  const { setCustomizeOpen, customizeOpen } = useBrowser();
  return (
    <button
      type="button"
      className={`customize-btn${compact ? ' customize-btn--compact' : ''}${className ? ` ${className}` : ''}`}
      onClick={() => setCustomizeOpen(true)}
      aria-expanded={customizeOpen}
      aria-label={compact ? m.customize.open : undefined}
      title={m.customize.open}
    >
      <Icon name="brush" size={16} />
      {!compact && <span>{m.customize.open}</span>}
    </button>
  );
}
