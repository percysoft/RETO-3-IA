import { normalizarFecha } from "../normalizar.ts"
import type { Regla } from "./tipos.ts"

/** RC9 (confirmación): la fecha de aprobación debe ser ≥ fecha_solicitud (comparación por día calendario). */
export const rc9FechaAprobacion: Regla = ({ paquete }) => {
  const { aprobacion, solicitud } = paquete
  if (!aprobacion) return {} // RC2 ya bloquea.
  const dia = normalizarFecha(aprobacion.fecha)
  if (dia !== null && dia >= solicitud.fecha_solicitud) return {}
  const detalle =
    dia === null
      ? `La fecha de aprobación "${aprobacion.fecha}" no es válida.`
      : `La aprobación (${dia}) es anterior a la solicitud (${solicitud.fecha_solicitud}).`
  return {
    confirmaciones: [
      {
        codigo: "RC9",
        detalle,
        accion_sugerida: "Confirmar que la aprobación cubre esta solicitud o pedir una aprobación posterior.",
      },
    ],
  }
}
