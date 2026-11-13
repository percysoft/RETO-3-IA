import type { Regla } from "./tipos.ts"

/** RC8 (confirmación): factura con fecha anterior a fecha_solicitud → OC retroactiva. */
export const rc8Retroactiva: Regla = ({ paquete }) => {
  const { factura, solicitud } = paquete
  if (!factura || factura.fecha >= solicitud.fecha_solicitud) return { retroactiva: false }
  return {
    retroactiva: true,
    confirmaciones: [
      {
        codigo: "RC8",
        detalle: `La factura ${factura.numero} (${factura.fecha}) es anterior a la solicitud (${solicitud.fecha_solicitud}): OC retroactiva.`,
        accion_sugerida: "Confirmar que se acepta crear la OC retroactiva; quedará marcada en el log de control.",
      },
    ],
  }
}
