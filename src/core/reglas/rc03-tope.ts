import { aprobadorDe, cop, type Regla } from "./tipos.ts"

/** RC3 (bloqueo): valor_total ≤ tope del aprobador. Solo se evalúa si RC2 identificó al aprobador. */
export const rc3Tope: Regla = (entrada) => {
  const aprobador = aprobadorDe(entrada)
  const { valor_total } = entrada.paquete.solicitud
  if (!aprobador || valor_total <= aprobador.tope) return {}
  return {
    bloqueos: [
      {
        codigo: "RC3",
        detalle: `El valor total ${cop(valor_total)} excede el tope de ${cop(aprobador.tope)} de ${aprobador.email}.`,
        accion_sugerida: "Obtener la aprobación de un aprobador con tope suficiente para este centro de costo.",
      },
    ],
  }
}
