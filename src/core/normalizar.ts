/**
 * Normalizadores puros: NIT, nombres, fechas y montos.
 * Ninguno lanza; devuelven null cuando el valor no es interpretable.
 */

/** "900.555.111-2" → "900555111" (se descarta el dígito de verificación tras el guion). */
export function normalizarNit(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null
  const base = valor.split("-")[0] ?? ""
  const digitos = base.replace(/\D/g, "")
  return digitos.length > 0 ? digitos : null
}

/** Minúsculas, sin tildes ni puntuación ("Papelería Central Ltda." → "papeleria central ltda"). */
export function normalizarNombre(valor: string | null | undefined): string {
  if (!valor) return ""
  return valor
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Compara textos de maestros (subáreas, etc.) ignorando tildes y mayúsculas. */
export function mismoTexto(a: string, b: string): boolean {
  return normalizarNombre(a) === normalizarNombre(b)
}

export function normalizarEmail(valor: string): string {
  return valor.trim().toLowerCase()
}

const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})/
const FECHA_LATINA = /^(\d{2})\/(\d{2})\/(\d{4})$/

function diaValido(y: number, m: number, d: number): boolean {
  const f = new Date(Date.UTC(y, m - 1, d))
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d
}

/**
 * Devuelve el día calendario "YYYY-MM-DD" tal como está escrito (sin convertir zona horaria).
 * Acepta "2026-08-20", "2026-08-21T10:02:00-05:00" y "20/08/2026".
 */
export function normalizarFecha(valor: string | null | undefined): string | null {
  if (!valor) return null
  const txt = valor.trim()
  const iso = FECHA_ISO.exec(txt)
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    return diaValido(y, m, d) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
  }
  const lat = FECHA_LATINA.exec(txt)
  if (lat) {
    const [d, m, y] = [Number(lat[1]), Number(lat[2]), Number(lat[3])]
    return diaValido(y, m, d) ? `${lat[3]}-${lat[2]}-${lat[1]}` : null
  }
  return null
}

/** Suma días a una fecha "YYYY-MM-DD" (UTC, sin efectos de zona horaria). */
export function sumarDias(fecha: string, dias: number): string | null {
  const base = normalizarFecha(fecha)
  if (!base) return null
  const f = new Date(`${base}T00:00:00Z`)
  f.setUTCDate(f.getUTCDate() + dias)
  return f.toISOString().slice(0, 10)
}

/**
 * Interpreta montos colombianos y planos: "COP 11.400.000", "1.234,56", "1,234.56", 95000.
 * Devuelve null si no es numérico.
 */
export function normalizarMonto(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null
  if (typeof valor !== "string") return null
  const limpio = valor.replace(/[A-Za-z$\s]/g, "")
  if (!/^-?[\d.,]+$/.test(limpio) || !/\d/.test(limpio)) return null
  const ultimoPunto = limpio.lastIndexOf(".")
  const ultimaComa = limpio.lastIndexOf(",")
  let texto: string
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    const decimal = ultimoPunto > ultimaComa ? "." : ","
    const miles = decimal === "." ? "," : "."
    texto = limpio.split(miles).join("").replace(decimal, ".")
  } else if (ultimoPunto >= 0 || ultimaComa >= 0) {
    const sep = ultimoPunto >= 0 ? "." : ","
    const partes = limpio.split(sep)
    const todasDeTres = partes.slice(1).every((p) => p.length === 3)
    texto = partes.length > 2 || todasDeTres ? partes.join("") : `${partes[0]}.${partes[1]}`
  } else {
    texto = limpio
  }
  const n = Number(texto)
  return Number.isFinite(n) ? n : null
}
