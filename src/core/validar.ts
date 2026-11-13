import { REGLAS, type EntradaRegla } from "./reglas/index.ts"
import type { Derivados, Hallazgo, Validacion } from "./tipos.ts"

const DERIVADOS_VACIOS: Derivados = { proveedor: null, aprobador: null, indicador_iva: null, condiciones_pago: null }

/** HU-2: aplica RC1–RC10. Puro y determinístico: mismo paquete + maestros → mismo resultado. */
export function validar(entrada: EntradaRegla): Validacion {
  const bloqueos: Hallazgo[] = []
  const confirmaciones: Hallazgo[] = []
  const advertencias: Hallazgo[] = []
  let derivados: Derivados = { ...DERIVADOS_VACIOS }
  let retroactiva = false

  for (const regla of REGLAS) {
    const r = regla(entrada)
    bloqueos.push(...(r.bloqueos ?? []))
    confirmaciones.push(...(r.confirmaciones ?? []))
    advertencias.push(...(r.advertencias ?? []))
    derivados = { ...derivados, ...r.derivados }
    retroactiva = retroactiva || r.retroactiva === true
  }
  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, advertencias, derivados, retroactiva }
}
