import type { ProductoAdmin } from '@kiosco/shared';
import { useNavigate, useSearchParams } from 'react-router';
import { pedir } from '../../api/cliente.js';
import { useCambioDeProductos } from './consultas.js';
import { FormularioProducto, type DatosProducto } from './FormularioProducto.js';

export function NuevoProducto() {
  const [params] = useSearchParams();
  const codigo = params.get('codigo') ?? undefined;
  const navigate = useNavigate();
  const alta = useCambioDeProductos((datos: DatosProducto) =>
    pedir<ProductoAdmin>('POST', '/productos', datos),
  );

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Nuevo producto</h1>
      <FormularioProducto
        titulo="Nuevo producto"
        codigoInicial={codigo}
        textoGuardar="Crear producto"
        guardando={alta.isPending}
        error={alta.error}
        // Vuelve a la búsqueda para seguir escaneando el próximo producto.
        alGuardar={(datos) =>
          alta.mutate(datos, {
            onSuccess: (creado) =>
              navigate('/admin/productos', { state: { creado: creado.nombre } }),
          })
        }
        alCancelar={() => navigate('/admin/productos')}
      />
    </section>
  );
}
