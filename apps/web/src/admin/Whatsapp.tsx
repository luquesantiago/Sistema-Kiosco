import { type EstadoWhatsappRespuesta, formatearNumero, type QrWhatsapp } from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';

export const CLAVE_WHATSAPP = ['whatsapp'] as const;

/** Estado de WhatsApp: se refresca seguido mientras se espera el escaneo del QR. */
export function useEstadoWhatsapp() {
  return useQuery({
    queryKey: CLAVE_WHATSAPP,
    queryFn: () => pedir<EstadoWhatsappRespuesta>('GET', '/whatsapp'),
    refetchInterval: (query) => (query.state.data?.estado === 'esperando_qr' ? 3_000 : 30_000),
  });
}

/** Mientras corresponda, el QR se pide de nuevo antes de que WhatsApp lo venza (cada 20 s). */
function Qr() {
  const { data, isError } = useQuery({
    queryKey: [...CLAVE_WHATSAPP, 'qr'],
    queryFn: () => pedir<QrWhatsapp>('GET', '/whatsapp/qr'),
    refetchInterval: 15_000,
  });
  return (
    <div className="space-y-2">
      <ol className="list-decimal space-y-1 pl-5 text-slate-700">
        <li>En el celular del chip, abrí WhatsApp.</li>
        <li>
          Entrá a <strong>Dispositivos vinculados</strong> y tocá{' '}
          <strong>Vincular un dispositivo</strong>.
        </li>
        <li>Escaneá este QR.</li>
      </ol>
      {data ? (
        <img
          src={data.imagen}
          alt="QR para vincular WhatsApp"
          className="size-64 rounded border border-slate-200 bg-white p-2"
        />
      ) : (
        <p className="text-slate-600">{isError ? 'Preparando el QR…' : 'Cargando el QR…'}</p>
      )}
    </div>
  );
}

function Conexion({ estado }: { estado: EstadoWhatsappRespuesta }) {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const alCambiar = (nuevo: EstadoWhatsappRespuesta) => {
    queryClient.setQueryData(CLAVE_WHATSAPP, nuevo);
    void queryClient.invalidateQueries({ queryKey: [...CLAVE_WHATSAPP, 'qr'] });
  };
  const vincular = useMutation({
    mutationFn: () => pedir<EstadoWhatsappRespuesta>('POST', '/whatsapp/vincular'),
    onSuccess: alCambiar,
  });
  const desvincular = useMutation({
    mutationFn: () => pedir<EstadoWhatsappRespuesta>('POST', '/whatsapp/desvincular'),
    onSuccess: (nuevo) => {
      setConfirmando(false);
      alCambiar(nuevo);
    },
  });

  return (
    <section className="space-y-3 rounded-lg bg-white p-4 shadow">
      <h2 className="text-lg font-semibold">Conexión</h2>
      {estado.estado === 'conectado' && (
        <>
          <p className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-green-600" />
            Conectado
            {estado.cuenta && <> con el chip {formatearNumero(estado.cuenta.numero)}</>}
          </p>
          {confirmando ? (
            <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
              <p>
                ¿Desvincular el chip? Los avisos van a quedar pendientes hasta que vincules otro.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="boton"
                  disabled={desvincular.isPending}
                  onClick={() => desvincular.mutate()}
                >
                  Sí, desvincular
                </button>
                <button
                  type="button"
                  className="boton-secundario"
                  onClick={() => setConfirmando(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="boton-secundario" onClick={() => setConfirmando(true)}>
              Desvincular
            </button>
          )}
        </>
      )}
      {estado.estado === 'esperando_qr' && <Qr />}
      {estado.estado === 'desvinculado' && (
        <>
          <p className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-red-600" />
            {vincular.isSuccess
              ? 'El QR se venció sin que nadie lo escaneara.'
              : 'WhatsApp no está vinculado. Los avisos esperan hasta que lo vincules.'}
          </p>
          <button
            type="button"
            className="boton"
            disabled={vincular.isPending}
            onClick={() => vincular.mutate()}
          >
            {vincular.isSuccess ? 'Generar QR nuevo' : 'Vincular WhatsApp'}
          </button>
        </>
      )}
      {estado.estado === 'no_disponible' && (
        <p className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-red-600" />
          WhatsApp no responde. Si sigue así, hay que revisar el servidor.
        </p>
      )}
      <MensajeError error={vincular.error ?? desvincular.error} />
    </section>
  );
}

function Destino({ estado }: { estado: EstadoWhatsappRespuesta }) {
  const queryClient = useQueryClient();
  const [numero, setNumero] = useState('');
  const guardar = useMutation({
    mutationFn: (valor: string) =>
      pedir<EstadoWhatsappRespuesta>('PUT', '/whatsapp/destino', { numero: valor }),
    onSuccess: (nuevo) => {
      queryClient.setQueryData(CLAVE_WHATSAPP, nuevo);
      setNumero('');
    },
  });
  const prueba = useMutation({ mutationFn: () => pedir('POST', '/whatsapp/prueba') });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    prueba.reset();
    guardar.mutate(numero);
  };

  return (
    <section className="space-y-3 rounded-lg bg-white p-4 shadow">
      <h2 className="text-lg font-semibold">Número que recibe los avisos</h2>
      <p>
        {estado.destino
          ? `Los avisos llegan al ${formatearNumero(estado.destino.numero)}.`
          : 'Todavía no hay número cargado: los avisos no se envían.'}
      </p>
      <form onSubmit={enviar} className="space-y-2">
        <label className="block">
          <span className="text-sm font-medium">
            {estado.destino ? 'Cambiar el número' : 'Número'}
          </span>
          <input
            className="campo"
            inputMode="tel"
            placeholder="11 2345-6789"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
          />
          <span className="text-sm text-slate-600">Código de área sin 0 y número sin 15.</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="boton" disabled={guardar.isPending || !numero.trim()}>
            Guardar
          </button>
          <button
            type="button"
            className="boton-secundario"
            disabled={!estado.destino || estado.estado !== 'conectado' || prueba.isPending}
            onClick={() => {
              guardar.reset();
              prueba.mutate();
            }}
          >
            Mandar prueba
          </button>
        </div>
        <MensajeError error={guardar.error ?? prueba.error} />
        {prueba.isSuccess && (
          <p role="status" className="text-sm text-green-800">
            Mensaje de prueba enviado. Fijate que haya llegado.
          </p>
        )}
      </form>
    </section>
  );
}

/** Vinculación del chip y número que recibe los avisos. */
export function Whatsapp() {
  const { data: estado, isPending, error } = useEstadoWhatsapp();

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">WhatsApp</h1>
      {isPending && <p>Consultando WhatsApp…</p>}
      <MensajeError error={error} />
      {estado?.estado === 'no_configurado' && (
        <p className="rounded-lg bg-white p-4 shadow">
          WhatsApp no está configurado en el servidor (falta <code>WAHA_URL</code>). Los avisos se
          guardan y se pueden ver en <Link to="/admin/avisos">Avisos</Link>.
        </p>
      )}
      {estado && estado.estado !== 'no_configurado' && (
        <>
          <Conexion estado={estado} />
          <Destino estado={estado} />
          {estado.pendientes > 0 && (
            <p className="text-slate-600">
              {estado.pendientes === 1
                ? 'Hay 1 aviso esperando envío.'
                : `Hay ${estado.pendientes} avisos esperando envío.`}{' '}
              <Link to="/admin/avisos" className="text-blue-700 underline">
                Ver avisos
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Cartel del panel del admin: si WhatsApp está caído, este es el único lugar donde se entera. */
export function CartelWhatsapp() {
  const { data: estado } = useEstadoWhatsapp();
  if (!estado || estado.estado === 'no_configurado') return null;
  const conectado = estado.estado === 'conectado';
  if (conectado && estado.destino) return null;

  const problema = !conectado
    ? estado.estado === 'no_disponible'
      ? 'WhatsApp no responde.'
      : 'WhatsApp no está vinculado.'
    : 'Falta cargar el número que recibe los avisos.';
  const esperando =
    estado.pendientes === 0
      ? ''
      : estado.pendientes === 1
        ? ' Hay 1 aviso esperando envío.'
        : ` Hay ${estado.pendientes} avisos esperando envío.`;

  return (
    <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p>
        <strong>{problema}</strong>
        {esperando}
      </p>
      <Link to="/admin/whatsapp" className="text-blue-700 underline">
        Ir a WhatsApp
      </Link>
    </div>
  );
}
