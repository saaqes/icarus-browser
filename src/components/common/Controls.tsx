/** Controles de formulario reutilizables (interruptor, selector segmentado, grupo de opciones). */

import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  hideLabel?: boolean;
  disabled?: boolean;
}

export function Toggle({ label, checked, onChange, description, hideLabel = false, disabled = false }: ToggleProps) {
  const descriptionId = useId();
  return (
    <label className={`toggle${hideLabel ? ' toggle--bare' : ''}`}>
      <span className="toggle__text">
        <span className={hideLabel ? 'visually-hidden' : 'toggle__label'}>{label}</span>
        {description && !hideLabel && (
          <span id={descriptionId} className="toggle__description">
            {description}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="toggle__input"
        checked={checked}
        disabled={disabled}
        aria-describedby={description && !hideLabel ? descriptionId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
    </label>
  );
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  icon?: IconName;
}

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (value: T) => void;
}

/** Selector de opciones excluyentes (radiogroup) con aspecto segmentado. */
export function Segmented<T extends string | number>({ label, value, options, onChange }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend className="field-label">{label}</legend>
      <div className="segmented__options">
        {options.map((option) => (
          <label key={String(option.value)} className={`segmented__option${option.value === value ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            {option.icon && <Icon name={option.icon} size={16} />}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface RadioListProps<T extends string> {
  label: string;
  /** Oculta la leyenda visualmente (se mantiene para lectores de pantalla). */
  hideLabel?: boolean;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; description?: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  children?: ReactNode;
}

/** Lista de opciones en vertical, para la página de configuración. */
export function RadioList<T extends string>({ label, hideLabel = false, value, options, onChange, disabled = false, children }: RadioListProps<T>) {
  const name = useId();
  return (
    <fieldset className="radio-list" disabled={disabled}>
      <legend className={hideLabel ? 'visually-hidden' : 'field-label'}>{label}</legend>
      {options.map((option) => (
        <label key={option.value} className="radio-list__item">
          <input type="radio" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
          <span>
            <span className="radio-list__label">{option.label}</span>
            {option.description && <span className="radio-list__description">{option.description}</span>}
          </span>
        </label>
      ))}
      {children}
    </fieldset>
  );
}

interface FieldProps {
  label: string;
  error?: string | null;
  hint?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}

/** Campo de formulario con etiqueta, ayuda y mensaje de error asociados. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint && !error && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          <Icon name="warning" size={14} />
          {error}
        </p>
      )}
    </div>
  );
}
