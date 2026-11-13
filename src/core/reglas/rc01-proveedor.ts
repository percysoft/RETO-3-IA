import { proveedorMaestro } from "./proveedor-maestro.ts"
import type { Regla } from "./tipos.ts"

/** RC1 (bloqueo): el proveedor existe (por NIT; sin NIT, por nombre normalizado) y está activo. */
export const rc1Proveedor: Regla = ({ paquete, maestros }) => {
  const { proveedor_nit, proveedor_nombre } = paquete.solicitud
  const porNit = proveedor_nit !== null
  const encontrado = proveedorMaestro({ paquete, maestros })
  const criterio = porNit ? `NIT ${proveedor_nit}` : `nombre "${proveedor_nombre}" (la solicitud no trae NIT)`

  if (!encontrado) {
    return {
      bloqueos: [
        {
          codigo: "RC1",
          detalle: `El proveedor con ${criterio} no existe en el maestro de proveedores.`,
          accion_sugerida: "Solicitar el alta del proveedor en SAP (o corregir el NIT) antes de crear la OC.",
        },
      ],
    }
  }
  if (!encontrado.activo) {
    return {
      bloqueos: [
        {
          codigo: "RC1",
          detalle: `El proveedor ${encontrado.nombre} (${encontrado.codigo_sap}) está inactivo en el maestro.`,
          accion_sugerida: "Pedir a Compras la reactivación del proveedor o elegir otro proveedor.",
        },
      ],
    }
  }
  return {
    derivados: {
      proveedor: { codigo_sap: encontrado.codigo_sap, nit: encontrado.nit, nombre: encontrado.nombre },
    },
  }
}
