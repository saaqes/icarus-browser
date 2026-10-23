import { useEffect, useState } from 'react';
import { useServices } from '../app/ServicesContext';

/** Fecha actual que se actualiza cada `intervalMs` (por defecto, cada 15 s). */
export function useNow(intervalMs = 15_000): Date {
  const { now } = useServices();
  const [date, setDate] = useState(now);
  useEffect(() => {
    const id = window.setInterval(() => setDate(now()), intervalMs);
    return () => window.clearInterval(id);
  }, [now, intervalMs]);
  return date;
}
