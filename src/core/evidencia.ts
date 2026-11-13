import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import type { Paquete } from "./tipos.ts"
import { fallo, ok, type Resultado } from "./resultado.ts"

export type Evidencia = { ruta: string; sha256: string }

export const sha256 = (texto: string): string => createHash("sha256").update(texto, "utf8").digest("hex")

/** Contenido que se firma: encabezados + cuerpo. El hash se calcula sobre este texto exacto. */
export function contenidoEvidencia(aprobacion: NonNullable<Paquete["aprobacion"]>): string {
  const lineas = [
    "EVIDENCIA DE APROBACIÓN - ORDEN DE COMPRA",
    `De: ${aprobacion.de}`,
    `Para: ${aprobacion.para}`,
    ...(aprobacion.cc.length > 0 ? [`Cc: ${aprobacion.cc.join(", ")}`] : []),
    `Fecha: ${aprobacion.fecha}`,
    `Asunto: ${aprobacion.asunto}`,
    "",
    aprobacion.texto.replace(/\r\n/g, "\n").trimEnd(),
  ]
  return `${lineas.join("\n")}\n`
}

/**
 * HU-4 (P0): out/<caso>/aprobacion.txt con el contenido y su sha256.
 * Depende solo de la aprobación, no del payload: por eso se genera ANTES del payload,
 * cuyo campo `aprobador.evidencia_sha256` necesita este hash. Es determinístico (idempotente).
 */
export async function generarEvidencia(
  outDir: string,
  caso: string,
  paquete: Paquete,
): Promise<Resultado<Evidencia>> {
  const { aprobacion } = paquete
  if (!aprobacion) return fallo("No hay aprobación en el paquete: no se puede generar la evidencia.")
  if (!aprobacion.aprobado) {
    return fallo("El correo no contiene una aprobación explícita: no constituye evidencia de aprobación.")
  }
  const contenido = contenidoEvidencia(aprobacion)
  const hash = sha256(contenido)
  const dir = `${outDir}/${caso}`
  await mkdir(dir, { recursive: true })
  await Bun.write(`${dir}/aprobacion.txt`, `${contenido}\n--\nsha256: ${hash}\n`)
  return ok({ ruta: `out/${caso}/aprobacion.txt`, sha256: hash })
}
