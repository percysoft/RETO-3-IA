import Anthropic from "@anthropic-ai/sdk"
import { describe, expect, test } from "bun:test"
import { ErrorLlm, type SolicitudLlm } from "../src/llm/adapter.ts"
import {
  AnthropicAdapter,
  MODELO_POR_DEFECTO,
  aMensajesAnthropic,
  deRespuestaAnthropic,
  redactar,
} from "../src/llm/anthropic.ts"

const solicitud: SolicitudLlm = {
  sistema: "sistema",
  mensajes: [{ rol: "user", bloques: [{ tipo: "texto", texto: "hola" }] }],
  herramientas: [{ nombre: "oc_validar", descripcion: "d", esquema: { properties: { caso: { type: "string" } }, required: ["caso"] } }],
  maxTokensRespuesta: 1000,
  timeoutMs: 1234,
}

function clienteFalso(create: (p: Anthropic.MessageCreateParamsNonStreaming, o: unknown) => Promise<unknown>): Anthropic {
  return { messages: { create } } as unknown as Anthropic
}

describe("adaptador Anthropic (sin red)", () => {
  test("conversión de mensajes: tool_use/tool_result y bloques opacos intactos", () => {
    const opaco: Anthropic.ThinkingBlockParam = { type: "thinking", thinking: "", signature: "sig" }
    const msgs = aMensajesAnthropic([
      { rol: "assistant", bloques: [{ tipo: "opaco", proveedor: "anthropic", datos: opaco }, { tipo: "uso_herramienta", id: "t1", nombre: "oc_validar", entrada: { caso: "x" } }] },
      { rol: "user", bloques: [{ tipo: "resultado_herramienta", id: "t1", contenido: "{}", esError: true }] },
      { rol: "assistant", bloques: [{ tipo: "opaco", proveedor: "otro", datos: { x: 1 } }] },
    ])
    expect(msgs[0]?.content).toEqual([opaco, { type: "tool_use", id: "t1", name: "oc_validar", input: { caso: "x" } }])
    expect(msgs[1]?.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "{}", is_error: true }])
    expect(msgs[2]?.content).toEqual([]) // bloques de otro proveedor se descartan
  })

  test("conversión de la respuesta y conteo de tokens", () => {
    const r = deRespuestaAnthropic({
      content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t", name: "oc_validar", input: { caso: "a" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 },
    } as unknown as Anthropic.Message)
    expect(r.motivo).toBe("herramientas")
    expect(r.tokens).toBe(20)
    expect(r.bloques.map((b) => b.tipo)).toEqual(["opaco", "uso_herramienta"])
  })

  test("la petición usa auto, timeout configurable, modelo por defecto y no expone la clave", async () => {
    let params: Anthropic.MessageCreateParamsNonStreaming | undefined
    let opts: unknown
    const a = new AnthropicAdapter({
      apiKey: "sk-ant-clave-de-prueba",
      cliente: clienteFalso(async (p, o) => {
        params = p
        opts = o
        return { content: [{ type: "text", text: "hola" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }
      }),
    })
    const r = await a.enviar(solicitud)
    expect(a.modelo).toBe(MODELO_POR_DEFECTO)
    expect(r.bloques).toEqual([{ tipo: "texto", texto: "hola" }])
    expect(params?.tool_choice).toEqual({ type: "auto" })
    expect(opts).toEqual({ timeout: 1234 })
    expect(params?.tools?.[0]).toMatchObject({ name: "oc_validar", input_schema: { type: "object" } })
    expect(JSON.stringify(params)).not.toContain("sk-ant-clave-de-prueba")
    expect(params).not.toHaveProperty("temperature")
  })

  test("LLM_MODEL configura el modelo; sin clave devuelve ErrorLlm (no lanza)", () => {
    const a = AnthropicAdapter.desdeEntorno({ LLM_API_KEY: "sk-ant-x-12345678", LLM_MODEL: "claude-sonnet-5-5" })
    expect(a instanceof AnthropicAdapter && a.modelo).toBe("claude-sonnet-5-5")
    expect(AnthropicAdapter.desdeEntorno({})).toBeInstanceOf(ErrorLlm)
  })

  test("errores del proveedor se traducen a mensajes claros sin secretos", async () => {
    const fallar = (e: Error) =>
      new AnthropicAdapter({ apiKey: "sk-ant-clave-de-prueba", cliente: clienteFalso(async () => { throw e }) }).enviar(solicitud)
    const timeout = await fallar(new Anthropic.APIConnectionTimeoutError()).catch((e: unknown) => e)
    expect(timeout).toBeInstanceOf(ErrorLlm)
    expect((timeout as ErrorLlm).tipo).toBe("timeout")
    const auth = await fallar(Anthropic.APIError.generate(401, { error: { message: "bad sk-ant-clave-de-prueba" } }, "bad sk-ant-clave-de-prueba", new Headers())).catch((e: unknown) => e)
    expect((auth as ErrorLlm).tipo).toBe("autenticacion")
    expect((auth as ErrorLlm).message).not.toContain("sk-ant-clave-de-prueba")
    const rl = await fallar(Anthropic.APIError.generate(429, {}, "slow down", new Headers())).catch((e: unknown) => e)
    expect((rl as ErrorLlm).tipo).toBe("limite_tasa")
    const mala = await fallar(Anthropic.APIError.generate(400, {}, "usa sk-ant-clave-de-prueba", new Headers())).catch((e: unknown) => e)
    expect((mala as ErrorLlm).message).not.toContain("sk-ant-clave-de-prueba")
  })

  test("redactar", () => {
    expect(redactar("a sk-ant-clave-de-prueba b", "sk-ant-clave-de-prueba")).toBe("a [REDACTADO] b")
    expect(redactar("abc", undefined)).toBe("abc")
  })
})
