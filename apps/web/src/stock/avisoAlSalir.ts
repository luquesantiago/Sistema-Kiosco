import { useEffect } from 'react';
import { useBlocker } from 'react-router';

const MENSAJE = 'Hay productos cargados sin confirmar. ¿Salir igual y perderlos?';

/** Avisa antes de cerrar la pestaña o de ir a otra pantalla si hay cambios sin confirmar. */
export function useAvisoAlSalir(hayCambios: boolean): void {
  const bloqueo = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hayCambios && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (bloqueo.state !== 'blocked') return;
    if (window.confirm(MENSAJE)) bloqueo.proceed();
    else bloqueo.reset();
  }, [bloqueo]);

  useEffect(() => {
    if (!hayCambios) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [hayCambios]);
}
