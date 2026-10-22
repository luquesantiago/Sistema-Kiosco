import {
  CATEGORIAS_GASTO,
  comparar,
  CUENTAS,
  NOMBRE_CATEGORIA_GASTO,
  NOMBRE_CUENTA,
  NOMBRE_MOVIMIENTO_CAJA,
  nombreMovimientoCaja,
  type CategoriaGasto,
  type CierreRespuesta,
  type Cuenta,
  type EstadoCaja,
  type MovimientoCaja,
  type MovimientoCajaEntrada,
  type TipoMovimientoSuelto,
} from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { OpcionesBoton } from '../app/OpcionesBoton.js';
import { useSalir } from '../app/sesion.js';
import { formatearHora } from '../lib/fechas.js';
import { entradaAMonto, formatearPesos, montoParaEditar } from '../lib/montos.js';
import { CLAVE_ESTADO_CAJA, esErrorDeTurno } from './estadoCaja.js';
import { Dialogo } from './Dialogos.js';

type Responsable = NonNullable<EstadoCaja['turnoAbierto']>['responsable'];

/** Selecciona todo el texto al enfocar: Enter confirma lo precargado o se escribe encima. */
const seleccionarTodo = (e: { currentTarget: HTMLInputElement }) => e.currentTarget.select();

/** Apertura del turno: el monto que dejó el turno anterior, precargado y editable. */
export function AbrirTurno({ montoSugerido }: { montoSugerido: string }) {
  const queryClient = useQueryClient();
  const [monto, setMonto] = useState(montoParaEditar(montoSugerido));
  const [invalido, setInvalido] = useState(false);
  const apertura = useMutation({
    mutationFn: (montoInicial: string) =>
      pedir<EstadoCaja>('POST', '/caja/turnos', { montoInicial }),
    onSuccess: (estado) => queryClient.setQueryData(CLAVE_ESTADO_CAJA, estado),
    // Si otro abrió primero, el estado nuevo muestra su turno.
    onError: () => void queryClient.invalidateQueries({ queryKey: CLAVE_ESTADO_CAJA }),
  });

  const abrir = (e: FormEvent) => {
    e.preventDefault();
    const montoInicial = entradaAMonto(monto);
    setInvalido(montoInicial === null);
    if (montoInicial !== null && !apertura.isPending) apertura.mutate(montoInicial);
  };

  return (
    <section className="mx-auto max-w-md space-y-4 rounded-lg bg-white p-6 shadow">
      <h1 className="text-2xl font-semibold">Abrir turno</h1>
      <p className="text-slate-600">
        El turno anterior dejó <strong>{formatearPesos(montoSugerido)}</strong> en la caja. Contá el
        efectivo: si coincide, presioná Enter; si no, escribí lo que contaste.
      </p>
      <form onSubmit={abrir} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Efectivo en la caja</span>
          <input
            className="campo text-2xl"
            inputMode="decimal"
            autoFocus
            autoComplete="off"
            value={monto}
            onFocus={seleccionarTodo}
            onChange={(e) => setMonto(e.target.value)}
          />
        </label>
        {invalido && (
          <p role="alert" className="text-sm text-red-700">
            Escribí un monto válido.
          </p>
        )}
        <button type="submit" className="boton" disabled={apertura.isPending}>
          Abrir turno (Enter)
        </button>
        <MensajeError error={apertura.error} />
      </form>
    </section>
  );
}

/** El turno abierto es de otro empleado: hay que cerrarlo contando la caja. */
export function TurnoDeOtro({
  turnoId,
  responsable,
}: {
  turnoId: string;
  responsable: Responsable;
}) {
  const [cerrando, setCerrando] = useState(false);
  return (
    <section className="mx-auto max-w-md space-y-4 rounded-lg bg-white p-6 shadow">
      <h1 className="text-2xl font-semibold">El turno de {responsable.nombre} está abierto</h1>
      <p className="text-slate-600">
        Antes de abrir tu turno, contá el efectivo de la caja y cerralo. Va a quedar registrado que
        lo cerraste vos.
      </p>
      <button type="button" className="boton" autoFocus onClick={() => setCerrando(true)}>
        Cerrar turno de {responsable.nombre}
      </button>
      {cerrando && (
        <DialogoCerrarTurno
          turnoId={turnoId}
          responsable={responsable}
          esMio={false}
          alCancelar={() => setCerrando(false)}
        />
      )}
    </section>
  );
}

/**
 * Cierre ciego: lo contado y un retiro opcional, sin mostrar el esperado. Al
 * terminar muestra lo que queda en caja y ofrece cerrar la sesión.
 */
export function DialogoCerrarTurno({
  turnoId,
  responsable,
  esMio,
  alCancelar,
}: {
  turnoId: string;
  responsable: Responsable;
  esMio: boolean;
  alCancelar: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const salir = useSalir();
  const [contado, setContado] = useState('');
  const [retiro, setRetiro] = useState('');
  const [motivo, setMotivo] = useState('');
  const [problema, setProblema] = useState<string | null>(null);
  const cierre = useMutation({
    mutationFn: (datos: { montoContado: string; retiro: string | null; motivoRetiro: string }) =>
      pedir<CierreRespuesta>('POST', `/caja/turnos/${turnoId}/cerrar`, datos),
  });
  // El estado de la caja se refresca recién al salir del diálogo, para no
  // desmontarlo antes de mostrar lo que quedó.
  const continuar = () => void queryClient.invalidateQueries({ queryKey: CLAVE_ESTADO_CAJA });

  const cerrar = (e: FormEvent) => {
    e.preventDefault();
    const montoContado = entradaAMonto(contado);
    const montoRetiro = retiro.trim() === '' ? null : entradaAMonto(retiro);
    if (montoContado === null || (retiro.trim() !== '' && montoRetiro === null)) {
      setProblema('Escribí montos válidos.');
      return;
    }
    if (montoRetiro !== null && comparar(montoRetiro, '0') > 0 && motivo.trim().length < 3) {
      setProblema('Escribí el motivo del retiro.');
      return;
    }
    if (montoRetiro !== null && comparar(montoRetiro, montoContado) > 0) {
      setProblema('No podés retirar más de lo que contaste.');
      return;
    }
    setProblema(null);
    if (!cierre.isPending) {
      cierre.mutate({ montoContado, retiro: montoRetiro, motivoRetiro: motivo.trim() });
    }
  };

  const titulo = esMio ? 'Cerrar turno' : `Cerrar turno de ${responsable.nombre}`;

  if (cierre.data) {
    return (
      <Dialogo titulo="Turno cerrado" alCerrar={continuar}>
        <p className="text-center">
          <span className="block text-sm text-slate-600">Quedan en la caja</span>
          <span className="text-4xl font-bold" data-testid="quedo-en-caja">
            {formatearPesos(cierre.data.quedoEnCaja)}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {esMio ? (
            <>
              <button
                type="button"
                className="boton"
                autoFocus
                disabled={salir.isPending}
                onClick={() =>
                  salir.mutate(undefined, {
                    onSettled: () => navigate('/ingresar', { replace: true }),
                  })
                }
              >
                Cerrar sesión (Enter)
              </button>
              <button type="button" className="boton-secundario" onClick={continuar}>
                Seguir en el sistema
              </button>
            </>
          ) : (
            <button type="button" className="boton" autoFocus onClick={continuar}>
              Abrir mi turno (Enter)
            </button>
          )}
        </div>
      </Dialogo>
    );
  }

  return (
    <Dialogo titulo={titulo} alCerrar={alCancelar}>
      <form onSubmit={cerrar} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Efectivo contado en la caja</span>
          <input
            className="campo text-2xl"
            inputMode="decimal"
            autoFocus
            autoComplete="off"
            value={contado}
            onChange={(e) => setContado(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Retiro al cerrar (opcional)</span>
          <input
            className="campo"
            inputMode="decimal"
            autoComplete="off"
            value={retiro}
            onChange={(e) => setRetiro(e.target.value)}
          />
        </label>
        {retiro.trim() !== '' && (
          <label className="block">
            <span className="text-sm font-medium">Motivo del retiro</span>
            <input
              className="campo"
              autoComplete="off"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </label>
        )}
        {problema && (
          <p role="alert" className="text-sm text-red-700">
            {problema}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="boton" disabled={cierre.isPending}>
            Cerrar turno (Enter)
          </button>
          <button type="button" className="boton-secundario" onClick={alCancelar}>
            Cancelar (Esc)
          </button>
        </div>
        <MensajeError error={cierre.error} />
      </form>
    </Dialogo>
  );
}

const CLAVE_MOVIMIENTOS = ['caja', 'movimientos'] as const;

/** F8: gasto o retiro (más ingreso para el admin) y los movimientos del turno. */
export function DialogoCaja({ esAdmin, alCerrar }: { esAdmin: boolean; alCerrar: () => void }) {
  const queryClient = useQueryClient();
  const tipos: TipoMovimientoSuelto[] = esAdmin
    ? ['gasto', 'retiro', 'ingreso']
    : ['gasto', 'retiro'];
  const [tipo, setTipo] = useState<TipoMovimientoSuelto>('gasto');
  const [monto, setMonto] = useState('');
  // Sin categoría preseleccionada, para que "Otro" no se llene por apuro.
  const [categoria, setCategoria] = useState<CategoriaGasto | null>(null);
  // Efectivo es lo común en el mostrador; el empleado solo elige cuenta en los gastos.
  const [cuenta, setCuenta] = useState<Cuenta>('efectivo');
  const conCuenta = tipo === 'gasto' || esAdmin;
  const [motivo, setMotivo] = useState('');
  const [problema, setProblema] = useState<string | null>(null);
  const movimientos = useQuery({
    queryKey: CLAVE_MOVIMIENTOS,
    queryFn: () => pedir<MovimientoCaja[]>('GET', '/caja/movimientos'),
  });
  const registro = useMutation({
    mutationFn: (datos: MovimientoCajaEntrada) =>
      pedir<MovimientoCaja>('POST', '/caja/movimientos', datos),
    onSuccess: () => {
      setMonto('');
      setCategoria(null);
      setCuenta('efectivo');
      setMotivo('');
      void queryClient.invalidateQueries({ queryKey: CLAVE_MOVIMIENTOS });
    },
    onError: (error) => {
      if (esErrorDeTurno(error)) {
        alCerrar();
        void queryClient.invalidateQueries({ queryKey: CLAVE_ESTADO_CAJA });
      }
    },
  });

  const registrar = (e: FormEvent) => {
    e.preventDefault();
    const valor = entradaAMonto(monto);
    if (valor === null || comparar(valor, '0') <= 0) {
      setProblema('Escribí un monto mayor que cero.');
      return;
    }
    if (tipo === 'gasto' && categoria === null) {
      setProblema('Elegí la categoría del gasto.');
      return;
    }
    if (motivo.trim().length < 3) {
      setProblema('Escribí el motivo (al menos 3 letras).');
      return;
    }
    setProblema(null);
    if (registro.isPending) return;
    const base = {
      cuenta: conCuenta ? cuenta : ('efectivo' as const),
      monto: valor,
      motivo: motivo.trim(),
    };
    if (tipo === 'gasto') {
      if (categoria !== null) registro.mutate({ tipo, categoria, ...base });
    } else {
      registro.mutate({ tipo, ...base });
    }
  };

  return (
    <Dialogo titulo="Caja" alCerrar={alCerrar}>
      <form onSubmit={registrar} className="space-y-4">
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Tipo de movimiento</legend>
          {tipos.map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input
                type="radio"
                name="tipo"
                value={t}
                checked={tipo === t}
                onChange={() => setTipo(t)}
              />
              {NOMBRE_MOVIMIENTO_CAJA[t]}
            </label>
          ))}
        </fieldset>
        <label className="block">
          <span className="text-sm font-medium">Monto</span>
          <input
            className="campo text-2xl"
            inputMode="decimal"
            autoFocus
            autoComplete="off"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
          />
        </label>
        {tipo === 'gasto' && (
          <OpcionesBoton
            leyenda="Categoría"
            nombre="categoria"
            opciones={CATEGORIAS_GASTO}
            nombres={NOMBRE_CATEGORIA_GASTO}
            valor={categoria}
            alCambiar={setCategoria}
          />
        )}
        {conCuenta && (
          <OpcionesBoton
            leyenda="Sale de"
            nombre="cuenta"
            opciones={CUENTAS}
            nombres={NOMBRE_CUENTA}
            valor={cuenta}
            alCambiar={setCuenta}
          />
        )}
        <label className="block">
          <span className="text-sm font-medium">Motivo</span>
          <input
            className="campo"
            autoComplete="off"
            placeholder={tipo === 'gasto' ? 'Por ejemplo: bolsas, luz, limpieza' : undefined}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </label>
        {problema && (
          <p role="alert" className="text-sm text-red-700">
            {problema}
          </p>
        )}
        {registro.isSuccess && (
          <p role="status" className="text-sm text-green-700">
            Registrado.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="boton" disabled={registro.isPending}>
            Registrar (Enter)
          </button>
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cerrar (Esc)
          </button>
        </div>
        <MensajeError error={registro.error} />
      </form>
      <div>
        <h3 className="text-sm font-semibold text-slate-600">Movimientos del turno</h3>
        {movimientos.data?.length === 0 && <p className="text-sm text-slate-600">Ninguno.</p>}
        <ul aria-label="Movimientos del turno" className="max-h-40 overflow-y-auto text-sm">
          {movimientos.data?.map((m) => (
            <li key={m.id} className="flex justify-between gap-2 border-b py-1 last:border-0">
              <span>
                {formatearHora(m.creadoEn)} · {nombreMovimientoCaja(m)}: {m.motivo}
              </span>
              <span className="font-medium">{formatearPesos(m.monto)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Dialogo>
  );
}
