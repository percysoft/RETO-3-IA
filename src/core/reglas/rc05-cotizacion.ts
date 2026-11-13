import { cop, type Regla } from "./tipos.ts"

export const TOLERANCIA_COTIZACION = 0.02

/** RC5 (confirmación): cotización ausente o con diferencia > 2 % frente al valor_total de la solicitud. */
export const rc5Cotizacion: Regla = ({ paquete }) => {
  const { cotizacion, solicitud } = paquete
  if (!cotizacion) {
    return {
      confirmaciones: [
        {
          codigo: "RC5",
          detalle: "No hay cotización en el paquete; el valor no se puede contrastar con el proveedor.",
          accion_sugerida: "Confirmar que se desea crear la OC sin cotización o pedirla al solicitante.",
        },
      ],
    }
  }
  if (cotizacion.moneda !== solicitud.moneda) {
    return {
      confirmaciones: [
        {
          codigo: "RC5",
          detalle: `La cotización está en ${cotizacion.moneda} y la solicitud en ${solicitud.moneda}; no son comparables.`,
          accion_sugerida: "Confirmar la moneda correcta con el solicitante.",
        },
      ],
    }
  }
  const diferencia =
    solicitud.valor_total > 0
      ? Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total
      : Number.POSITIVE_INFINITY
  if (diferencia <= TOLERANCIA_COTIZACION) return {}
  const pct = Number.isFinite(diferencia) ? `${(diferencia * 100).toFixed(2)} %` : "indeterminada"
  return {
    confirmaciones: [
      {
        codigo: "RC5",
        detalle: `Cotización (${cop(cotizacion.total)}) ≠ solicitud (${cop(solicitud.valor_total)}): diferencia ${pct}, tolerancia ${TOLERANCIA_COTIZACION * 100} %.`,
        accion_sugerida: "Confirmar con el solicitante cuál valor es el correcto antes de crear la OC.",
      },
    ],
  }
}
