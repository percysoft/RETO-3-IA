import { Agente, cargarSistema } from "../src/agente/ciclo.ts"
import { cargarConfig } from "../src/config.ts"
import type { LlmAdapter, RespuestaLlm, SolicitudLlm } from "../src/llm/adapter.ts"
import { crearManejador, type ManejadorHttp, type OpcionesServidor } from "../src/server.ts"
import { ctxAislado, RAIZ } from "./ayudas.ts"

export type Paso = (peticion: SolicitudLlm) => RespuestaLlm
export const texto = (t: string, tokens = 100): Paso => () => ({ bloques: [{ tipo: "texto", texto: t }], motivo: "fin", tokens })
export const usa = (nombre: string, entrada: unknown, tokens = 100): Paso => () => ({
  bloques: [{ tipo: "uso_herramienta", id: `tu_${Math.random().toString(36).slice(2)}`, nombre, entrada }],
  motivo: "herramientas",
  tokens,
})
export const lanza = (e: Error): Paso => () => {
  throw e
}

export class LlmFalso implements LlmAdapter {
  readonly proveedor = "falso"
  readonly modelo = "falso-1"
  peticiones = 0
  private i = 0
  constructor(private readonly pasos: Paso[]) {}
  async enviar(s: SolicitudLlm): Promise<RespuestaLlm> {
    this.peticiones++
    const paso = this.pasos[this.i++]
    if (!paso) throw new Error("guion agotado")
    return paso(s)
  }
}

export async function servidorDePrueba(
  pasos: Paso[],
  extra: Partial<OpcionesServidor> & { sinAgente?: boolean; secreto?: string } = {},
): Promise<{ fetch: ManejadorHttp; outDir: string; llm: LlmFalso }> {
  const base = await ctxAislado()
  const outDir = base.outDir ?? ""
  const llm = new LlmFalso(pasos)
  const config = cargarConfig({})
  const agente = new Agente({
    directory: RAIZ,
    outDir,
    llm,
    sistema: await cargarSistema(RAIZ),
    maxIteraciones: config.MAX_ITERACIONES,
    maxTokensSesion: config.MAX_TOKENS_SESION,
    timeoutMs: 1000,
    ...(extra.secreto ? { secreto: extra.secreto } : {}),
  })
  const { sinAgente, ...resto } = extra
  const fetch = crearManejador({ agente: sinAgente ? null : agente, config, directory: RAIZ, ...resto })
  return { fetch, outDir, llm }
}

export const post = (ruta: string, cuerpo: unknown, cabeceras: Record<string, string> = {}): Request =>
  new Request(`http://localhost:3000${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabeceras },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  })
export const get = (ruta: string, cabeceras: Record<string, string> = {}): Request =>
  new Request(`http://localhost:3000${ruta}`, { headers: cabeceras })
