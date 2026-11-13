import { normalizarNombre } from "../core/normalizar.ts"

/**
 * El backend (no el modelo) decide si un mensaje del usuario es una confirmación explícita.
 * Lista cerrada de frases completas: cualquier condicionante o negación ("no confirmo",
 * "confirmo pero cambia el valor") queda fuera y NO confirma.
 */
const FRASES = new Set([
  "confirmo",
  "si confirmo",
  "lo confirmo",
  "confirmado",
  "si confirmado",
  "confirmo la creacion",
  "confirmo la oc",
  "confirmo crear la oc",
  "confirmo y crea la oc",
  "confirmo por favor",
  "si confirmo la creacion de la oc",
  "confirmo la creacion de la oc",
  "confirmo las excepciones",
  "confirmo las excepciones y crea la oc",
])

export function esConfirmacionExplicita(texto: string): boolean {
  if (texto.length > 80) return false
  const limpio = normalizarNombre(texto)
  return FRASES.has(limpio)
}

const FRASES_RECHAZO = new Set([
  "no confirmo",
  "no lo confirmo",
  "rechazo",
  "rechazo la oc",
  "rechazo las excepciones",
  "no confirmo la creacion",
  "no confirmo la oc",
  "cancelar",
  "cancela",
  "cancela la creacion",
  "no crear la oc",
])

/** Rechazo explícito: el backend descarta la confirmación pendiente. */
export function esRechazoExplicito(texto: string): boolean {
  if (texto.length > 80) return false
  return FRASES_RECHAZO.has(normalizarNombre(texto))
}
