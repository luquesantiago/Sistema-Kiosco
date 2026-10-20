import type { ProductoVenta } from '@kiosco/shared';
import { useRef, useState, type KeyboardEvent } from 'react';
import { ErrorDeApi, pedir } from '../api/cliente.js';

interface Props<P extends ProductoVenta> {
  /** Se llama con el producto escaneado o elegido de la lista. */
  alElegir: (producto: P) => void;
  /** Para quien no puede crear productos: qué hacer si el código no existe. */
  avisoInexistente: string;
  etiqueta?: string;
}

/**
 * Campo de carga con el lector: código + Enter agrega el producto. Si no hay
 * un código exacto, muestra los resultados por nombre para elegir con las
 * flechas y Enter. El campo vuelve a quedar enfocado después de cada carga.
 */
export function EscanerDeProductos<P extends ProductoVenta>({
  alElegir,
  avisoInexistente,
  etiqueta = 'Escaneá o buscá un producto',
}: Props<P>) {
  const campo = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<{ consulta: string; productos: P[] } | null>(null);
  const [indice, setIndice] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  const elegir = (producto: P) => {
    alElegir(producto);
    setTexto('');
    setResultados(null);
    setAviso(null);
    campo.current?.focus();
  };

  const buscar = async (consulta: string) => {
    setBuscando(true);
    setAviso(null);
    try {
      const productos = await pedir<P[]>(
        'GET',
        `/productos?${new URLSearchParams({ q: consulta, pagina: '1' })}`,
      );
      const exacto = productos.find((p) => p.codigoBarras === consulta);
      if (exacto) {
        elegir(exacto);
      } else if (productos.length > 0) {
        setResultados({ consulta, productos });
        setIndice(0);
      } else {
        setResultados(null);
        setAviso(`No existe un producto con "${consulta}". ${avisoInexistente}`);
        setTexto('');
      }
    } catch (error) {
      setAviso(error instanceof ErrorDeApi ? error.message : 'No se pudo buscar el producto.');
    } finally {
      setBuscando(false);
      campo.current?.focus();
    }
  };

  const alPresionar = (e: KeyboardEvent<HTMLInputElement>) => {
    const lista = resultados?.consulta === texto.trim() ? resultados.productos : null;
    if (e.key === 'ArrowDown' && lista) {
      e.preventDefault();
      setIndice((i) => Math.min(i + 1, lista.length - 1));
    } else if (e.key === 'ArrowUp' && lista) {
      e.preventDefault();
      setIndice((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setResultados(null);
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const consulta = texto.trim();
      if (consulta === '' || buscando) return;
      const elegido = lista?.[indice];
      if (elegido) elegir(elegido);
      else void buscar(consulta);
    }
  };

  const lista = resultados?.consulta === texto.trim() ? resultados.productos : null;

  return (
    <div className="relative">
      <label>
        <span className="text-sm font-medium">{etiqueta}</span>
        <input
          ref={campo}
          className="campo"
          type="search"
          autoFocus
          autoComplete="off"
          role="combobox"
          aria-expanded={lista !== null}
          aria-controls="resultados-escaner"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alPresionar}
        />
      </label>
      {aviso && (
        <p role="alert" className="mt-1 text-sm text-amber-800">
          {aviso}
        </p>
      )}
      {lista && (
        <ul
          id="resultados-escaner"
          role="listbox"
          aria-label="Resultados"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded border border-slate-300 bg-white shadow-lg"
        >
          {lista.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === indice}
              className={`cursor-pointer px-3 py-2 ${i === indice ? 'bg-slate-200' : ''}`}
              onMouseDown={(e) => {
                // mousedown en vez de click: así el campo no pierde el foco antes de elegir.
                e.preventDefault();
                elegir(p);
              }}
            >
              {p.nombre}
              <span className="text-sm text-slate-500"> · {p.codigoBarras ?? 'sin código'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
