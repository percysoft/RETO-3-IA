import { aprobadorDe, centroDe, type Regla } from "./tipos.ts"

/** RC2 (bloqueo): existe aprobación, dice "Aprobado" y viene de un aprobador del centro de costo. */
export const rc2Aprobacion: Regla = (entrada) => {
  const { aprobacion, solicitud } = entrada.paquete
  const bloqueo = (detalle: string, accion_sugerida: string) => ({
    bloqueos: [{ codigo: "RC2" as const, detalle, accion_sugerida }],
  })

  if (!aprobacion) {
    return bloqueo(
      "No hay correo de aprobación en el paquete.",
      "Pedir al solicitante el correo de aprobación del líder.",
    )
  }
  if (!aprobacion.aprobado) {
    return bloqueo(
      `El correo de ${aprobacion.de} no contiene una aprobación explícita ("Aprobado").`,
      "Pedir al líder que responda con la aprobación expresa.",
    )
  }
  const centro = centroDe(entrada)
  if (!centro) {
    return bloqueo(
      `El centro de costo ${solicitud.centro_costo} no existe en el maestro; no se puede verificar al aprobador.`,
      "Corregir el centro de costo de la solicitud.",
    )
  }
  const aprobador = aprobadorDe(entrada)
  if (!aprobador) {
    const lista = centro.aprobadores.map((a) => a.email).join(", ")
    return bloqueo(
      `${aprobacion.de} no está autorizado como aprobador del centro ${centro.centro_costo} (${centro.nombre}). Aprobadores válidos: ${lista}.`,
      `Solicitar la aprobación a uno de los aprobadores del centro: ${lista}.`,
    )
  }
  return { derivados: { aprobador: { email: aprobador.email, nombre: aprobador.nombre, tope: aprobador.tope } } }
}
