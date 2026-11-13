import { describe, expect, test } from "bun:test"
import { Agente, cargarSistema } from "../src/agente/ciclo.ts"
import { resolverContexto } from "../src/core/contexto.ts"
import { solicitarConfirmacion } from "../src/core/servicio.ts"
import { crear, validar } from "../src/tools/oc.ts"
import { ctxAislado, RAIZ } from "./ayudas.ts"
import { LlmFalso, texto, usa, type Paso } from "./falso.ts"

type Evento = {
  ts: string; evento: string; caso: string; solicitud_id: string; sessionId: string; huella: string
  estado: string; confirmaciones: string[]; origen: string; decidido_por?: string; herramienta?: string
}

async function crearAgente(pasos: Paso[], outDir: string) {
  return new Agente({ directory: RAIZ, outDir, llm: new LlmFalso(pasos), sistema: await cargarSistema(RAIZ), maxIteraciones: 25, maxTokensSesion: 100_000, timeoutMs: 1000 })
}
async function lineas(ruta: string): Promise<string[]> {
  const f = Bun.file(ruta)
  return (await f.exists()) ? (await f.text()).split("\n").filter((l) => l !== "") : []
}
const eventos = async (outDir: string): Promise<Evento[]> =>
  (await lineas(`${outDir}/log.jsonl`)).map((l) => JSON.parse(l) as Evento).filter((e) => e.evento !== undefined)
const filas = async (outDir: string, id: string): Promise<string[][]> =>
  (await lineas(`${outDir}/control.csv`)).slice(1).map((l) => l.split(",")).filter((c) => c[0] === id)
const resultados = async (outDir: string, id: string) => (await filas(outDir, id)).map((c) => c[1])
const ordenes = async (outDir: string) => (await lineas(`${outDir}/sap/ordenes.jsonl`)).length

describe("auditoría de la confirmación (B6.1)", () => {
  test("1. caso apto sin excepciones: no genera pendiente ni eventos", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([usa("oc_validar", { caso: "sol-001" }), usa("oc_crear", { caso: "sol-001" }), texto("Creada.")], outDir)
    await agente.procesar("a1", "procesa sol-001")
    expect(await resultados(outDir, "SOL-2026-001")).toEqual(["CREADA"])
    expect(await eventos(outDir)).toEqual([])
    const r = await solicitarConfirmacion(resolverContexto({ ...base }), "sol-001")
    expect(r).toEqual({ ok: true, data: { registrada: false } })
  })

  test("2. caso bloqueado (RC1/RC2): no genera pendiente", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([usa("oc_validar", { caso: "sol-002" }), texto("Bloqueada."), usa("oc_validar", { caso: "sol-003" }), texto("Bloqueada.")], outDir)
    await agente.procesar("b1", "sol-002"); await agente.procesar("b1", "sol-003")
    expect(await lineas(`${outDir}/control.csv`)).toEqual([])
    expect(await eventos(outDir)).toEqual([])
    expect(await Bun.file(`${outDir}/confirmaciones.json`).exists()).toBe(false)
  })

  test("3. caso con confirmación: un único pendiente al presentarse (fila + evento SOLICITADA)", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas? Responde «confirmo».")], outDir)
    const t = await agente.procesar("c1", "procesa sol-004")
    expect(t.needsConfirmation).toBe(true)
    expect(await filas(outDir, "SOL-2026-004")).toHaveLength(1)
    expect((await filas(outDir, "SOL-2026-004"))[0]?.slice(1, 6)).toEqual(["PENDIENTE_CONFIRMACION", "", "false", "", "RC5"])
    const ev = await eventos(outDir)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ evento: "CONFIRMACION_SOLICITADA", caso: "sol-004", solicitud_id: "SOL-2026-004", sessionId: "c1", estado: "PENDIENTE", confirmaciones: ["RC5"], origen: "backend" })
    expect(ev[0]?.huella).toMatch(/^[0-9a-f]{64}$/)
    expect(ev[0]?.herramienta).toBeUndefined()
    expect(ev[0]?.decidido_por).toBeUndefined()
  })

  test("3b. el pendiente no se registra mientras no se haya presentado (turno interrumpido)", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([usa("oc_validar", { caso: "sol-004" })], outDir) // el guion se agota → error del proveedor
    const t = await agente.procesar("c2", "procesa sol-004")
    expect(t.ok).toBe(false)
    expect(await lineas(`${outDir}/control.csv`)).toEqual([])
    expect(await eventos(outDir)).toEqual([])
  })

  test("4. validación repetida (misma sesión y otra sesión): no duplica fila ni evento", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([
      usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"),
      usa("oc_validar", { caso: "sol-004" }), texto("Sigue pendiente."),
      usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"),
    ], outDir)
    await agente.procesar("d1", "procesa sol-004")
    await agente.procesar("d1", "valida de nuevo")
    await agente.procesar("d2", "procesa sol-004 otra vez") // sesión distinta, misma huella
    expect(await resultados(outDir, "SOL-2026-004")).toEqual(["PENDIENTE_CONFIRMACION"])
    expect((await eventos(outDir)).map((e) => e.evento)).toEqual(["CONFIRMACION_SOLICITADA"])
  })

  test("5. confirmación válida: registra concesión y creación, con trazabilidad por huella", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([
      usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"),
      usa("oc_crear", { caso: "sol-004", confirmado: true }), texto("Creada."),
    ], outDir)
    await agente.procesar("e1", "procesa sol-004")
    await agente.procesar("e1", "Confirmo")
    expect(await resultados(outDir, "SOL-2026-004")).toEqual(["PENDIENTE_CONFIRMACION", "CREADA"])
    const ev = await eventos(outDir)
    expect(ev.map((e) => e.evento)).toEqual(["CONFIRMACION_SOLICITADA", "CONFIRMACION_CONCEDIDA"])
    expect(ev[1]).toMatchObject({ estado: "CONCEDIDA", origen: "backend", decidido_por: "sesion:e1", sessionId: "e1", confirmaciones: ["RC5"] })
    expect(ev[1]?.huella).toBe(ev[0]?.huella)
    const estado = JSON.parse(await Bun.file(`${outDir}/confirmaciones.json`).text()) as Record<string, { huella: string; solicitada?: string; concedida?: string; numero_oc?: string }>
    expect(estado["SOL-2026-004"]).toMatchObject({ huella: ev[0]?.huella, numero_oc: "4500000001" })
    expect(estado["SOL-2026-004"]?.solicitada).toBeDefined(); expect(estado["SOL-2026-004"]?.concedida).toBeDefined()
    expect(await ordenes(outDir)).toBe(1)
  })

  test("6. rechazo humano: registra RECHAZADA y no crea OC; una nueva solicitud posterior se audita de nuevo", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([
      usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"),
      texto("Entendido, no se crea."),
      usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"),
    ], outDir)
    await agente.procesar("f1", "procesa sol-004")
    const r = await agente.procesar("f1", "No confirmo")
    expect(r.needsConfirmation).toBe(false)
    expect(await ordenes(outDir)).toBe(0)
    expect(await resultados(outDir, "SOL-2026-004")).toEqual(["PENDIENTE_CONFIRMACION", "RECHAZADA"])
    const ev = await eventos(outDir)
    expect(ev.map((e) => e.evento)).toEqual(["CONFIRMACION_SOLICITADA", "CONFIRMACION_RECHAZADA"])
    expect(ev[1]).toMatchObject({ estado: "RECHAZADA", origen: "backend", decidido_por: "sesion:f1" })
    // Nuevo ciclo (el usuario vuelve a pedirlo): se solicita de nuevo, sin crear OC.
    await agente.procesar("f2", "procesa sol-004 de nuevo")
    expect(await resultados(outDir, "SOL-2026-004")).toEqual(["PENDIENTE_CONFIRMACION", "RECHAZADA", "PENDIENTE_CONFIRMACION"])
    expect(await ordenes(outDir)).toBe(0)
  })

  test("6b. rechazo de algo que nunca se presentó no genera auditoría", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([usa("oc_validar", { caso: "sol-004" }), texto("ok")], outDir)
    // (g0 deja un pendiente presentado de sol-004; g1 es otra sesión sin pendiente propio: su rechazo no se audita)
    await agente.procesar("g0", "hola")
    expect(await eventos(outDir)).toEqual(expect.not.arrayContaining([expect.objectContaining({ evento: "CONFIRMACION_RECHAZADA" })]))
    await agente.procesar("g1", "No confirmo")
    expect((await eventos(outDir)).filter((e) => e.evento === "CONFIRMACION_RECHAZADA")).toEqual([])
  })

  test("7. confirmado:true del modelo sin confirmación humana no concede nada", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([
      usa("oc_validar", { caso: "sol-004" }), usa("oc_crear", { caso: "sol-004", confirmado: true }), texto("¿Confirmas?"),
      usa("oc_crear", { caso: "sol-004", confirmado: true }), texto("Necesito «confirmo»."),
    ], outDir)
    await agente.procesar("h1", "procesa sol-004")
    await agente.procesar("h1", "claro, hazlo") // mensaje ambiguo
    expect((await eventos(outDir)).map((e) => e.evento)).not.toContain("CONFIRMACION_CONCEDIDA")
    expect(await resultados(outDir, "SOL-2026-004")).toEqual(["PENDIENTE_CONFIRMACION"])
    expect(await ordenes(outDir)).toBe(0)
  })

  test("8a. «Confirmo» en otra sesión (sin pendiente propio) no concede", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([
      usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"),
      usa("oc_crear", { caso: "sol-004", confirmado: true }), texto("No puedo."),
    ], outDir)
    await agente.procesar("i1", "procesa sol-004")
    const t = await agente.procesar("i2", "Confirmo") // i2 nunca presentó nada
    expect(t.toolCalls[0]?.ok).toBe(false)
    expect((await eventos(outDir)).map((e) => e.evento)).toEqual(["CONFIRMACION_SOLICITADA"])
    expect(await ordenes(outDir)).toBe(0)
  })

  test("8b. huella distinta: ni con canal humano se concede", async () => {
    const base = await ctxAislado({ confirmacionHumana: { por: "sesion:x" } }); const outDir = base.outDir ?? ""
    await validar.execute({ caso: "sol-004" }, base) // deja constancia de la huella vigente
    const estado = JSON.parse(await Bun.file(`${outDir}/confirmaciones.json`).text()) as Record<string, { huella: string; ts: string }>
    await Bun.write(`${outDir}/confirmaciones.json`, JSON.stringify({ "SOL-2026-004": { ...estado["SOL-2026-004"], huella: "0".repeat(64) } }))
    const r = JSON.parse(await crear.execute({ caso: "sol-004", confirmado: true }, base)) as { ok: boolean }
    expect(r.ok).toBe(false)
    expect((await eventos(outDir)).map((e) => e.evento)).not.toContain("CONFIRMACION_CONCEDIDA")
    expect(await ordenes(outDir)).toBe(0)
  })

  test("9. repetición idempotente: no duplica la OC ni los eventos de creación", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([
      usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"),
      usa("oc_crear", { caso: "sol-004", confirmado: true }), texto("Creada."),
      usa("oc_crear", { caso: "sol-004" }), texto("Ya existía."),
    ], outDir)
    await agente.procesar("j1", "procesa sol-004"); await agente.procesar("j1", "Confirmo")
    const antes = await eventos(outDir)
    await agente.procesar("j2", "créala otra vez")
    expect(await eventos(outDir)).toEqual(antes)
    expect(await resultados(outDir, "SOL-2026-004")).toEqual(["PENDIENTE_CONFIRMACION", "CREADA", "IDEMPOTENTE"])
    expect(await ordenes(outDir)).toBe(1)
    expect((await eventos(outDir)).filter((e) => e.evento === "CONFIRMACION_CONCEDIDA")).toHaveLength(1)
  })

  test("los eventos nunca contienen secretos ni texto de documentos, y solo los emite el backend", async () => {
    const base = await ctxAislado(); const outDir = base.outDir ?? ""
    const agente = await crearAgente([usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"), usa("oc_crear", { caso: "sol-004", confirmado: true }), texto("ok")], outDir)
    await agente.procesar("k1", "procesa sol-004"); await agente.procesar("k1", "Confirmo")
    const crudo = (await lineas(`${outDir}/log.jsonl`)).filter((l) => l.includes('"evento"')).join("\n")
    expect(crudo).not.toMatch(/sk-ant|Aprobado por 25 millones|@periferia/)
    for (const e of await eventos(outDir)) {
      expect(e.origen).toBe("backend")
      expect(Object.keys(e).sort()).toEqual(expect.arrayContaining(["ts", "evento", "caso", "solicitud_id", "sessionId", "huella", "estado", "confirmaciones", "origen"]))
    }
  })
})
