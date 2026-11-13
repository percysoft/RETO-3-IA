import { createHash, timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"

/**
 * Comparación de claves en tiempo constante. Se comparan los SHA-256 de ambas (misma longitud
 * siempre), así que ni el contenido ni la longitud de la clave correcta se filtran por tiempos.
 */
export function compararClaves(entregada: string, esperada: string): boolean {
  const a = createHash("sha256").update(entregada, "utf8").digest()
  const b = createHash("sha256").update(esperada, "utf8").digest()
  return timingSafeEqual(a, b)
}

export type ConfianzaProxy = {
  /** Solo si es true se mira la cabecera; por defecto el servidor NO confía en ninguna. */
  activo: boolean
  /** Nombre de la cabecera con la cadena de IPs (p. ej. "x-forwarded-for"). */
  cabecera: string
  /** Proxies de confianza, contados desde la DERECHA de la cadena (1 = el último que añadió una entrada). */
  saltos: number
}

function limpiarIp(texto: string): string {
  const t = texto.trim()
  const corchetes = /^\[([^\]]+)\](?::\d+)?$/.exec(t) // [::1]:8080
  if (corchetes?.[1]) return corchetes[1]
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(t)) return t.slice(0, t.lastIndexOf(":")) // 1.2.3.4:5678
  return t
}

/**
 * IP efectiva del cliente. Sin confianza configurada devuelve la IP del socket. Con confianza usa la
 * entrada N-ésima desde la derecha de la cadena (las entradas de la izquierda las controla el cliente y
 * se ignoran); si falta, no es una IP válida o hay menos entradas que saltos, vuelve a la IP del socket.
 */
export function resolverIpCliente(headers: Headers, ipSocket: string, confianza: ConfianzaProxy): string {
  if (!confianza.activo) return ipSocket
  const valor = headers.get(confianza.cabecera)
  if (!valor) return ipSocket
  const partes = valor.split(",").map((p) => p.trim()).filter((p) => p !== "")
  const candidata = partes[partes.length - confianza.saltos]
  if (candidata === undefined) return ipSocket
  const ip = limpiarIp(candidata)
  return isIP(ip) !== 0 ? ip : ipSocket
}
