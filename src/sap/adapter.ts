import type { OrdenCompra } from "../core/tipos.ts"

/** Interfaz obligatoria del PRD 7.4. `fecha` en la búsqueda es un extra opcional compatible. */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha?: string } | null>
}
