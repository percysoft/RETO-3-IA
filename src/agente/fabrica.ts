import { cargarConfig } from "../config.ts"
import { ErrorLlm } from "../llm/adapter.ts"
import { AnthropicAdapter } from "../llm/anthropic.ts"
import { Agente, cargarSistema } from "./ciclo.ts"
import type { PresupuestoGlobal } from "./presupuesto.ts"

/** Crea el agente real con la configuración del entorno. Devuelve ErrorLlm si falta la clave. */
export async function crearAgenteDesdeEntorno(
  directory: string,
  env: Record<string, string | undefined> = process.env,
  extras: { presupuesto?: PresupuestoGlobal } = {},
): Promise<Agente | ErrorLlm> {
  const config = cargarConfig(env)
  const llm = AnthropicAdapter.desdeEntorno(env)
  if (llm instanceof ErrorLlm) return llm
  const secreto = env.LLM_API_KEY || env.ANTHROPIC_API_KEY
  return new Agente({
    directory,
    llm,
    sistema: await cargarSistema(directory),
    maxIteraciones: config.MAX_ITERACIONES,
    maxTokensSesion: config.MAX_TOKENS_SESION,
    timeoutMs: config.LLM_TIMEOUT_MS,
    ...(secreto ? { secreto } : {}),
    ...(extras.presupuesto ? { presupuesto: extras.presupuesto } : {}),
  })
}
