import type { Regla } from "./tipos.ts"
import { proveedorMaestro } from "./proveedor-maestro.ts"

/** RC7: condiciones de pago ausentes → derivado del proveedor (solo informativo). Código desconocido → advertencia. */
export const rc7Pago: Regla = (entrada) => {
  const { condiciones_pago } = entrada.paquete.solicitud
  const existe = (c: string) => entrada.maestros.condicionesPago.some((i) => i.codigo === c)

  if (condiciones_pago !== null) {
    const derivados = { condiciones_pago: { codigo: condiciones_pago, origen: "solicitud" as const } }
    if (existe(condiciones_pago)) return { derivados }
    // Advertencia NO bloqueante: el PRD no define el código inexistente como regla de control.
    return {
      derivados,
      advertencias: [
        {
          codigo: "RC7",
          detalle: `La condición de pago "${condiciones_pago}" no existe en el maestro.`,
          accion_sugerida: "Verificar la condición de pago en la solicitud.",
        },
      ],
    }
  }
  const proveedor = proveedorMaestro(entrada)
  if (!proveedor) return {}
  return { derivados: { condiciones_pago: { codigo: proveedor.condiciones_pago_default, origen: "derivado" } } }
}
