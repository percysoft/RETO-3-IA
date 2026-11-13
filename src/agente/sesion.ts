import { mkdir } from "node:fs/promises"
import { z } from "zod"
import type { MensajeLlm } from "../llm/adapter.ts"

export const ID_SESION = /^[A-Za-z0-9_-]{1,64}$/

export type Pendiente = {
  caso: string
  solicitud_id: string
  /** true cuando el backend ya cerró un turno mostrando las confirmaciones al usuario. */
  presentada: boolean
}

export type EntradaHistorial =
  | { ts: string; rol: "user" | "assistant"; texto: string }
  | { ts: string; rol: "tool"; herramienta: string; args: unknown; ok: boolean; resumen: string }

export type Sesion = {
  id: string
  creada: string
  tokens: number
  turnos: number
  pendiente: Pendiente | null
  /** Historial visible (para el front y GET /sessions/:id). */
  historial: EntradaHistorial[]
  /** Conversación tal como se envía al proveedor LLM. */
  mensajes: MensajeLlm[]
}

const PendienteSchema = z.object({ caso: z.string(), solicitud_id: z.string(), presentada: z.boolean() })
const SesionSchema = z.object({
  id: z.string(),
  creada: z.string(),
  tokens: z.number(),
  turnos: z.number(),
  pendiente: PendienteSchema.nullable(),
  historial: z.array(z.record(z.string(), z.unknown())),
  mensajes: z.array(z.record(z.string(), z.unknown())),
})

/** Sesiones en memoria con respaldo en out/sessions/<id>.json (recuperables tras reinicio). */
export class AlmacenSesiones {
  private readonly memoria = new Map<string, Sesion>()

  constructor(private readonly outDir: string) {}

  private ruta(id: string): string {
    return `${this.outDir}/sessions/${id}.json`
  }

  async obtener(id: string, crear: boolean): Promise<Sesion | null> {
    if (!ID_SESION.test(id)) return null
    const enMemoria = this.memoria.get(id)
    if (enMemoria) return enMemoria
    const f = Bun.file(this.ruta(id))
    if (await f.exists()) {
      try {
        const r = SesionSchema.safeParse(JSON.parse(await f.text()) as unknown)
        if (r.success) {
          const s = r.data as unknown as Sesion
          this.memoria.set(id, s)
          return s
        }
      } catch {
        // Archivo corrupto: se trata como sesión inexistente.
      }
    }
    if (!crear) return null
    const nueva: Sesion = { id, creada: new Date().toISOString(), tokens: 0, turnos: 0, pendiente: null, historial: [], mensajes: [] }
    this.memoria.set(id, nueva)
    return nueva
  }

  async guardar(s: Sesion): Promise<void> {
    await mkdir(`${this.outDir}/sessions`, { recursive: true })
    await Bun.write(this.ruta(s.id), JSON.stringify(s))
  }
}
