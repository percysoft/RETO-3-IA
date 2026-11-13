import type { SapAdapter } from "../sap/adapter.ts"
import { MockSapAdapter } from "../sap/mock.ts"

/**
 * Contexto de ejecución de las herramientas (PRD 6.2) más dependencias inyectables.
 * `confirmacionHumana` solo lo fija el backend cuando el mensaje del usuario confirma;
 * el modelo no puede fijarlo (no es un argumento de ninguna herramienta).
 */
export type ToolContext = {
  directory: string
  sessionId: string
  outDir?: string
  sap?: SapAdapter
  ahora?: () => Date
  confirmacionHumana?: { por: string }
}

export type Contexto = {
  directory: string
  sessionId: string
  outDir: string
  sap: SapAdapter
  ahora: () => Date
  confirmacionHumana: { por: string } | null
}

export function resolverContexto(ctx: ToolContext): Contexto {
  const outDir = ctx.outDir ?? `${ctx.directory}/out`
  const ahora = ctx.ahora ?? (() => new Date())
  return {
    directory: ctx.directory,
    sessionId: ctx.sessionId,
    outDir,
    ahora,
    sap: ctx.sap ?? new MockSapAdapter({ directory: ctx.directory, outDir, ahora }),
    confirmacionHumana: ctx.confirmacionHumana ?? null,
  }
}
