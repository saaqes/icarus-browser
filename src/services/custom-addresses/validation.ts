/**
 * Validación de direcciones personalizadas. Devuelve códigos de error por campo
 * (la interfaz los traduce) y, si el problema es otra entrada, cuál es.
 *
 * Reglas para que mostrar y navegar sean siempre coherentes:
 * - La dirección usa el mismo protocolo que el destino: la barra nunca presenta
 *   como HTTPS una página HTTP (ni al revés).
 * - Entre las entradas activas, ningún destino se solapa con otro destino ni con
 *   otra dirección, y ninguna dirección se solapa con otra dirección ni con otro
 *   destino. Así cada URL real tiene como mucho una dirección visible y cada
 *   dirección escrita lleva a un único destino.
 * - La dirección no puede estar dentro de su propio destino (ni al revés).
 */

import type { CustomAddress, CustomAddressInput } from '../../types/customAddress';
import { formatLocation, locationsOverlap, normalizeLocationInput, parseLocation, type Location, type LocationError } from './locations';

export type CustomAddressFieldError =
  | LocationError
  | 'protocol-mismatch'
  | 'same-as-target'
  | 'target-in-use'
  | 'target-is-address'
  | 'address-in-use'
  | 'address-is-target';

export type CustomAddressField = 'target' | 'address';
export type CustomAddressErrors = Partial<Record<CustomAddressField, CustomAddressFieldError>>;
/** Entrada con la que choca cada campo (para nombrarla en el mensaje). */
export type CustomAddressConflicts = Partial<Record<CustomAddressField, CustomAddress>>;

export type CustomAddressValidation =
  | { ok: true; value: CustomAddressInput }
  | { ok: false; errors: CustomAddressErrors; conflicts: CustomAddressConflicts };

interface Locations {
  target: Location;
  address: Location;
}

function locationsOf(entry: CustomAddress): Locations | null {
  const target = parseLocation(entry.target);
  const address = parseLocation(entry.address);
  return target && address ? { target, address } : null;
}

/** Busca la primera entrada activa (distinta de `exceptId`) que choca con estas ubicaciones. */
export function findConflicts(
  locations: Locations,
  entries: CustomAddress[],
  exceptId?: string,
): { errors: CustomAddressErrors; conflicts: CustomAddressConflicts } {
  const errors: CustomAddressErrors = {};
  const conflicts: CustomAddressConflicts = {};
  for (const other of entries) {
    if (!other.enabled || other.id === exceptId) continue;
    const parsed = locationsOf(other);
    if (!parsed) continue;
    if (!errors.target) {
      if (locationsOverlap(locations.target, parsed.target)) errors.target = 'target-in-use';
      else if (locationsOverlap(locations.target, parsed.address)) errors.target = 'target-is-address';
      if (errors.target) conflicts.target = other;
    }
    if (!errors.address) {
      if (locationsOverlap(locations.address, parsed.address)) errors.address = 'address-in-use';
      else if (locationsOverlap(locations.address, parsed.target)) errors.address = 'address-is-target';
      if (errors.address) conflicts.address = other;
    }
  }
  return { errors, conflicts };
}

/**
 * Valida y normaliza una entrada.
 * @param entries entradas existentes, para detectar conflictos.
 * @param editingId entrada que se edita (no choca consigo misma).
 */
export function validateCustomAddressInput(
  input: CustomAddressInput,
  entries: CustomAddress[] = [],
  editingId?: string,
): CustomAddressValidation {
  const errors: CustomAddressErrors = {};
  const target = normalizeLocationInput(input.target);
  if (!target.ok) errors.target = target.error;

  const address = normalizeLocationInput(input.address, target.ok ? target.location.protocol : undefined);
  if (!address.ok) errors.address = address.error;
  else if (target.ok) {
    if (address.location.protocol !== target.location.protocol) errors.address = 'protocol-mismatch';
    else if (locationsOverlap(address.location, target.location)) errors.address = 'same-as-target';
  }

  let conflicts: CustomAddressConflicts = {};
  if (target.ok && address.ok && Object.keys(errors).length === 0 && input.enabled) {
    const found = findConflicts({ target: target.location, address: address.location }, entries, editingId);
    Object.assign(errors, found.errors);
    conflicts = found.conflicts;
  }

  if (!target.ok || !address.ok || Object.keys(errors).length > 0) return { ok: false, errors, conflicts };
  return {
    ok: true,
    value: { target: formatLocation(target.location), address: formatLocation(address.location), enabled: Boolean(input.enabled) },
  };
}
