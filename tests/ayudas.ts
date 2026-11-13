import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { cargarMaestros } from "../src/core/maestros.ts"
import type { ToolContext } from "../src/core/contexto.ts"
import { leerPaquete } from "../src/core/paquete.ts"
import type { Maestros, Paquete, Solicitud } from "../src/core/tipos.ts"

export const RAIZ = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

export async function ctxAislado(extra: Partial<ToolContext> = {}): Promise<ToolContext> {
  const outDir = await mkdtemp(`${tmpdir()}/reto03-`)
  return { directory: RAIZ, sessionId: "test", outDir, ahora: () => new Date("2026-09-01T00:00:00Z"), ...extra }
}

export async function maestros(): Promise<Maestros> {
  const m = await cargarMaestros(RAIZ)
  if (!m.ok) throw new Error(m.error)
  return m.data
}

export async function paquete(caso: string): Promise<Paquete> {
  const p = await leerPaquete(RAIZ, caso)
  if (!p.ok) throw new Error(p.error)
  return p.data
}

/** Variante de un paquete real, para probar cada regla de forma aislada. */
export function conSolicitud(p: Paquete, cambios: Partial<Solicitud>): Paquete {
  return { ...p, solicitud: { ...p.solicitud, ...cambios } }
}
