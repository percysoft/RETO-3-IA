import { describe, expect, test } from "bun:test"
import { Agente, cargarSistema } from "../src/agente/ciclo.ts"
import { PresupuestoGlobal } from "../src/agente/presupuesto.ts"
import type { LlmAdapter, RespuestaLlm } from "../src/llm/adapter.ts"
import { crearManejador } from "../src/server.ts"
import { cargarConfig } from "../src/config.ts"
import { ctxAislado, RAIZ } from "./ayudas.ts"
import { get, post } from "./falso.ts"

describe("PresupuestoGlobal", () => {
  test("reserva y liquida; no supera el límite", () => {
    const p = new PresupuestoGlobal(100, 40)
    expect(p.reservar()).toBe(40)
    expect(p.reservar()).toBe(40)
    expect(p.reservar()).toBeNull() // 80 reservados + 40 > 100
    p.liquidar(40, 10)
    expect(p.estado).toEqual({ limite: 100, consumido: 10, reservado: 40, disponible: 50 })
    expect(p.reservar()).toBe(40)
  })
  test("una llamada fallida libera la reserva sin consumir", () => {
    const p = new PresupuestoGlobal(100, 60)
    const r = p.reservar() ?? 0
    p.liquidar(r, 0)
    expect(p.estado).toMatchObject({ consumido: 0, reservado: 0 })
    expect(p.reservar()).toBe(60)
  })
  test("valores inválidos se ignoran; el constructor valida", () => {
    const p = new PresupuestoGlobal(100, 10)
    p.liquidar(p.reservar() ?? 0, Number.NaN)
    expect(p.estado.consumido).toBe(0)
    expect(() => new PresupuestoGlobal(0)).toThrow()
    expect(() => new PresupuestoGlobal(10, 0)).toThrow()
  })
})

/** Modelo falso que tarda, para forzar llamadas concurrentes. */
class LlmLento implements LlmAdapter {
  readonly proveedor = "falso"
  readonly modelo = "lento"
  llamadas = 0
  constructor(private readonly tokens: number, private readonly ms: number) {}
  async enviar(): Promise<RespuestaLlm> {
    this.llamadas++
    await new Promise((r) => setTimeout(r, this.ms))
    return { bloques: [{ tipo: "texto", texto: "ok" }], motivo: "fin", tokens: this.tokens }
  }
}

describe("presupuesto global en el agente (concurrencia)", () => {
  test("con 8 turnos concurrentes y cupo para 3 reservas, solo 3 llegan al modelo y el resto recibe presupuesto_global", async () => {
    const base = await ctxAislado()
    const presupuesto = new PresupuestoGlobal(300, 100) // caben 3 reservas simultáneas
    const llm = new LlmLento(50, 40)
    const agente = new Agente({ directory: RAIZ, outDir: base.outDir ?? "", llm, sistema: await cargarSistema(RAIZ), maxIteraciones: 5, maxTokensSesion: 1e6, timeoutMs: 1000, presupuesto })
    const resultados = await Promise.all(Array.from({ length: 8 }, (_, i) => agente.procesar(`conc-${i}`, "hola")))
    expect(llm.llamadas).toBe(3)
    expect(resultados.filter((r) => r.ok).length).toBe(3)
    expect(resultados.filter((r) => r.error === "presupuesto_global").length).toBe(5)
    expect(presupuesto.estado).toEqual({ limite: 300, consumido: 150, reservado: 0, disponible: 150 })
  })
  test("tras liquidar, el cupo liberado vuelve a estar disponible", async () => {
    const base = await ctxAislado()
    const presupuesto = new PresupuestoGlobal(300, 100)
    const agente = new Agente({ directory: RAIZ, outDir: base.outDir ?? "", llm: new LlmLento(50, 5), sistema: await cargarSistema(RAIZ), maxIteraciones: 5, maxTokensSesion: 1e6, timeoutMs: 1000, presupuesto })
    // Cada llamada consume 50 y exige 100 de margen libre: caben 5 (la 5.ª ve 200 + 100 ≤ 300); la 6.ª ve 250 + 100 > 300.
    for (let i = 0; i < 5; i++) expect((await agente.procesar(`sec-${i}`, "hola")).ok).toBe(true)
    const r = await agente.procesar("sec-final", "hola")
    expect(r.error).toBe("presupuesto_global")
    expect(presupuesto.estado.consumido).toBe(250)
  })
  test("una llamada que falla no consume presupuesto", async () => {
    const base = await ctxAislado()
    const presupuesto = new PresupuestoGlobal(300, 100)
    const roto: LlmAdapter = { proveedor: "falso", modelo: "roto", enviar: async () => { throw new Error("boom") } }
    const agente = new Agente({ directory: RAIZ, outDir: base.outDir ?? "", llm: roto, sistema: "x", maxIteraciones: 5, maxTokensSesion: 1e6, timeoutMs: 1000, presupuesto })
    await agente.procesar("f1", "hola")
    expect(presupuesto.estado).toMatchObject({ consumido: 0, reservado: 0 })
  })
  test("HTTP: presupuesto agotado → 503 con mensaje claro; /api/health muestra el estado", async () => {
    const base = await ctxAislado()
    const presupuesto = new PresupuestoGlobal(100, 100)
    presupuesto.liquidar(presupuesto.reservar() ?? 0, 100) // consumido = 100 → agotado
    const agente = new Agente({ directory: RAIZ, outDir: base.outDir ?? "", llm: new LlmLento(1, 1), sistema: "x", maxIteraciones: 5, maxTokensSesion: 1e6, timeoutMs: 1000, presupuesto })
    const manejador = crearManejador({ agente, config: cargarConfig({}), directory: RAIZ, presupuesto })
    const r = await manejador(post("/api/chat", { message: "hola" }))
    expect(r.status).toBe(503)
    expect(JSON.stringify(await r.json())).toContain("presupuesto global")
    const h = (await (await manejador(get("/api/health"))).json()) as { presupuesto: { limite: number; consumido: number } }
    expect(h.presupuesto).toMatchObject({ limite: 100, consumido: 100 })
  })
})
