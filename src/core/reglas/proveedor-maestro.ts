import { normalizarNit, normalizarNombre } from "../normalizar.ts"
import type { EntradaRegla } from "./tipos.ts"

/** Proveedor del maestro según el mismo criterio de RC1 (NIT; sin NIT, nombre). */
export function proveedorMaestro({ paquete, maestros }: EntradaRegla) {
  const { proveedor_nit, proveedor_nombre } = paquete.solicitud
  return proveedor_nit !== null
    ? (maestros.proveedores.find((p) => normalizarNit(p.nit) === proveedor_nit) ?? null)
    : (maestros.proveedores.find((p) => normalizarNombre(p.nombre) === normalizarNombre(proveedor_nombre)) ?? null)
}
