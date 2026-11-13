import type { Derivados, Hallazgo, Maestros, Paquete } from "../tipos.ts"

export type EntradaRegla = { paquete: Paquete; maestros: Maestros }

/** Aporte de una regla. Todas son funciones puras e independientes entre sí. */
export type SalidaRegla = {
  bloqueos?: Hallazgo[]
  confirmaciones?: Hallazgo[]
  /** Avisos informativos: nunca impiden ni condicionan la creación. */
  advertencias?: Hallazgo[]
  derivados?: Partial<Derivados>
  retroactiva?: boolean
}

export type Regla = (entrada: EntradaRegla) => SalidaRegla

export const cop = (n: number): string => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })

export function centroDe({ paquete, maestros }: EntradaRegla) {
  return maestros.centrosCosto.find((c) => c.centro_costo === paquete.solicitud.centro_costo) ?? null
}

export function aprobadorDe(entrada: EntradaRegla) {
  const { paquete } = entrada
  if (!paquete.aprobacion) return null
  const email = paquete.aprobacion.de
  return centroDe(entrada)?.aprobadores.find((a) => a.email.trim().toLowerCase() === email) ?? null
}
