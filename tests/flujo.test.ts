import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readdir } from "node:fs/promises"
import { crear, construir_payload, generar_evidencia, leer_paquete, validar } from "../src/tools/oc.ts"
import { OrdenCompraSchema } from "../src/core/tipos.ts"
import { ctxAislado, RAIZ } from "./ayudas.ts"

type Json = Record<string, unknown>
const parse = (s: string): Json => JSON.parse(s) as Json
const data = (s: string): Json => (parse(s).data ?? {}) as Json
const codigos = (v: unknown): string[] => (v as { codigo: string }[]).map((x) => x.codigo)

// Resultado esperado por caso (PRD §3.1 y §7.3).
const ESPERADO = [
  { caso: "sol-001", apta: true, bloq: [], conf: [], retro: false },
  { caso: "sol-002", apta: false, bloq: ["RC1"], conf: [], retro: false },
  { caso: "sol-003", apta: false, bloq: ["RC2"], conf: [], retro: false },
  { caso: "sol-004", apta: true, bloq: [], conf: ["RC5"], retro: false },
  { caso: "sol-005", apta: true, bloq: [], conf: ["RC8"], retro: true },
  { caso: "sol-006", apta: true, bloq: [], conf: ["RC6"], retro: false },
] as const

describe("seis casos vía oc_validar", () => {
  for (const e of ESPERADO) {
    test(e.caso, async () => {
      const d = data(await validar.execute({ caso: e.caso }, await ctxAislado()))
      expect(d.apta).toBe(e.apta)
      expect(codigos(d.bloqueos)).toEqual([...e.bloq])
      expect(codigos(d.confirmaciones)).toEqual([...e.conf])
      expect(d.retroactiva).toBe(e.retro)
    })
  }
  test("sol-006 deriva IVA y condiciones de pago del proveedor", async () => {
    const d = data(await validar.execute({ caso: "sol-006" }, await ctxAislado()))
    expect(d.derivados).toMatchObject({
      indicador_iva: { codigo: "C1", origen: "derivado" },
      condiciones_pago: { codigo: "Z030", origen: "derivado" },
      proveedor: { codigo_sap: "100234" },
    })
  })
})

describe("leer_paquete y errores", () => {
  test("factura solo en sol-005; los demás null", async () => {
    expect(data(await leer_paquete.execute({ caso: "sol-005" }, await ctxAislado())).factura).toMatchObject({ numero: "FC-88231", fecha: "2026-08-10", total: 3200000 })
    expect(data(await leer_paquete.execute({ caso: "sol-001" }, await ctxAislado())).factura).toBeNull()
  })
  test("caso inexistente → ok:false sin excepción", async () => {
    const r = parse(await leer_paquete.execute({ caso: "sol-999" }, await ctxAislado()))
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain("Paquete incompleto")
  })
  test("path traversal rechazado", async () => {
    expect(parse(await leer_paquete.execute({ caso: "../maestros" }, await ctxAislado())).ok).toBe(false)
  })
  test("directorio inexistente en ctx → ok:false", async () => {
    const ctx = { ...(await ctxAislado()), directory: "/no/existe" }
    expect(parse(await validar.execute({ caso: "sol-001" }, ctx)).ok).toBe(false)
  })
})

describe("evidencia y payload", () => {
  test("evidencia TXT con sha256 verificable", async () => {
    const ctx = await ctxAislado()
    const r = data(await generar_evidencia.execute({ caso: "sol-001" }, ctx))
    const txt = await Bun.file(`${ctx.outDir}/sol-001/aprobacion.txt`).text()
    const [contenido, pie] = txt.split("\n--\n")
    expect(createHash("sha256").update(contenido ?? "").digest("hex")).toBe(r.sha256 as string)
    expect(pie).toContain(r.sha256 as string)
    for (const h of ["De:", "Para:", "Fecha:", "Asunto:"]) expect(contenido).toContain(h)
  })
  test("payload sol-001 válido, con el hash de la evidencia y trazabilidad por campo", async () => {
    const ctx = await ctxAislado()
    const d = data(await construir_payload.execute({ caso: "sol-001" }, ctx))
    const orden = OrdenCompraSchema.parse(d.orden)
    const ev = d.evidencia as { sha256: string }
    expect(orden.aprobador.evidencia_sha256).toBe(ev.sha256)
    expect(orden.proveedor.codigo_sap).toBe("100234")
    expect(orden.posiciones[0]).toMatchObject({ numero: 10, unidad: "UN", precio_unitario: 95000, indicador_iva: "C1" })
    const traza = JSON.parse(await Bun.file(`${ctx.outDir}/sol-001/trazabilidad.json`).text()) as Record<string, { fuente: string }>
    expect(traza["proveedor.codigo_sap"]?.fuente).toBe("maestro.proveedores")
    expect(traza["posiciones.0.cantidad"]?.fuente).toBe("solicitud")
  })
  test("sol-004: el payload usa el valor de la solicitud, no el de la cotización; unidad H", async () => {
    const d = data(await construir_payload.execute({ caso: "sol-004" }, await ctxAislado()))
    const orden = OrdenCompraSchema.parse(d.orden)
    expect(orden.posiciones[0]).toMatchObject({ precio_unitario: 250000, cantidad: 100, unidad: "H" })
    expect(orden.excepciones[0]).toMatchObject({ codigo: "RC5", confirmado_por: null })
  })
  test("la descripción se trunca a 40 y queda trazado", async () => {
    const ctx = await ctxAislado()
    const d = data(await construir_payload.execute({ caso: "sol-001" }, ctx))
    const orden = OrdenCompraSchema.parse(d.orden)
    expect(orden.posiciones[0]?.descripcion.length).toBeLessThanOrEqual(40)
    const traza = JSON.parse(await Bun.file(`${ctx.outDir}/sol-001/trazabilidad.json`).text()) as Record<string, { fuente: string }>
    expect(traza["posiciones.0.descripcion"]?.fuente).toBe("derivado")
  })
  test("caso bloqueado no construye payload", async () => {
    expect(parse(await construir_payload.execute({ caso: "sol-002" }, await ctxAislado())).ok).toBe(false)
  })
  test("derivados/paquete enviados por el modelo se ignoran", async () => {
    const ctx = await ctxAislado()
    const r = await construir_payload.execute({ caso: "sol-001", paquete: { solicitud: { valor_total: 1 } }, derivados: {} }, ctx)
    expect(OrdenCompraSchema.parse(data(r).orden).posiciones[0]?.precio_unitario).toBe(95000)
  })
})

async function lineas(ruta: string): Promise<string[]> {
  const f = Bun.file(ruta)
  return (await f.exists()) ? (await f.text()).split("\n").filter((l) => l !== "") : []
}

describe("crear: numeración, idempotencia y control", () => {
  test("sol-001 dos veces → mismo número, una sola OC, 2 filas en control", async () => {
    const ctx = await ctxAislado()
    const a = data(await crear.execute({ caso: "sol-001" }, ctx))
    const b = data(await crear.execute({ caso: "sol-001" }, ctx))
    expect(a).toMatchObject({ numero_oc: "4500000001", idempotente: false })
    expect(b).toMatchObject({ numero_oc: "4500000001", idempotente: true })
    expect(await lineas(`${ctx.outDir}/sap/ordenes.jsonl`)).toHaveLength(1)
    const control = await lineas(`${ctx.outDir}/control.csv`)
    expect(control[0]).toBe("solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts")
    expect(control[1]).toContain("SOL-2026-001,CREADA,4500000001,false")
    expect(control[2]).toContain("SOL-2026-001,IDEMPOTENTE,4500000001")
  })
  test("bloqueados no crean OC y quedan en control", async () => {
    const ctx = await ctxAislado()
    for (const caso of ["sol-002", "sol-003"]) {
      const r = parse(await crear.execute({ caso, confirmado: true }, { ...ctx, confirmacionHumana: { por: "ana" } }))
      expect(r.ok).toBe(false)
    }
    expect(await lineas(`${ctx.outDir}/sap/ordenes.jsonl`)).toHaveLength(0)
    const control = (await lineas(`${ctx.outDir}/control.csv`)).join("\n")
    expect(control).toContain("SOL-2026-002,BLOQUEADA,,false,RC1")
    expect(control).toContain("SOL-2026-003,BLOQUEADA,,false,RC2")
  })
  test("sol-004 NO se crea sin confirmación (ni siquiera con confirmado=true del modelo)", async () => {
    const ctx = await ctxAislado()
    const r1 = parse(await crear.execute({ caso: "sol-004" }, ctx))
    expect(r1.ok).toBe(false)
    expect(String(r1.error)).toContain("confirmación")
    // El modelo afirma confirmado=true pero el canal humano no lo respalda → sigue pendiente.
    const r2 = parse(await crear.execute({ caso: "sol-004", confirmado: true }, ctx))
    expect(r2.ok).toBe(false)
    expect(await lineas(`${ctx.outDir}/sap/ordenes.jsonl`)).toHaveLength(0)
    // Dos intentos con la misma huella dejan UNA sola fila pendiente (B6.1: sin duplicados).
    expect((await lineas(`${ctx.outDir}/control.csv`)).filter((l) => l.includes("PENDIENTE_CONFIRMACION"))).toHaveLength(1)
  })
  test("confirmación del humano sin haber presentado las excepciones tampoco crea", async () => {
    const ctx = { ...(await ctxAislado()), confirmacionHumana: { por: "ana" } }
    // Primer intento con confirmado=true: backend aún no las había presentado → se registra pendiente y no crea.
    const r = parse(await crear.execute({ caso: "sol-004", confirmado: true }, ctx))
    expect(r.ok).toBe(false)
  })
  test("sol-004 se crea tras presentar y confirmar; registra quién confirmó", async () => {
    const base = await ctxAislado()
    await validar.execute({ caso: "sol-004" }, base) // presenta las confirmaciones
    const ctx = { ...base, confirmacionHumana: { por: "analista@periferia-ficticia.com" } }
    const r = data(await crear.execute({ caso: "sol-004", confirmado: true }, ctx))
    expect(r.numero_oc).toBe("4500000001")
    const reg = JSON.parse((await lineas(`${base.outDir}/sap/ordenes.jsonl`))[0] ?? "{}") as { orden: { excepciones: { confirmado_por: string }[] } }
    expect(reg.orden.excepciones[0]?.confirmado_por).toBe("analista@periferia-ficticia.com")
  })
  test("sol-005 confirmada queda retroactiva=true en control", async () => {
    const base = await ctxAislado()
    await validar.execute({ caso: "sol-005" }, base)
    await crear.execute({ caso: "sol-005", confirmado: true }, { ...base, confirmacionHumana: { por: "ana" } })
    expect((await lineas(`${base.outDir}/control.csv`)).join("\n")).toContain("SOL-2026-005,CREADA,4500000001,true,,RC8")
  })
  test("numeración secuencial entre casos", async () => {
    const base = await ctxAislado()
    const ctx = { ...base, confirmacionHumana: { por: "ana" } }
    await crear.execute({ caso: "sol-001" }, ctx)
    await validar.execute({ caso: "sol-006" }, base)
    const r = data(await crear.execute({ caso: "sol-006", confirmado: true }, ctx))
    expect(r.numero_oc).toBe("4500000002")
  })
  test("payload alterado por el modelo se rechaza", async () => {
    const ctx = await ctxAislado()
    const ok = data(await construir_payload.execute({ caso: "sol-001" }, ctx)).orden as { posiciones: { precio_unitario: number }[] }
    const alterado = structuredClone(ok)
    const pos = alterado.posiciones[0]
    if (pos) pos.precio_unitario = 1
    expect(parse(await crear.execute({ caso: "sol-001", payload: alterado }, ctx)).ok).toBe(false)
    expect(data(await crear.execute({ caso: "sol-001", payload: ok }, ctx)).numero_oc).toBe("4500000001")
  })
  test("crear sobre caso inexistente → ok:false y fila ERROR", async () => {
    const ctx = await ctxAislado()
    expect(parse(await crear.execute({ caso: "sol-999" }, ctx)).ok).toBe(false)
    expect((await lineas(`${ctx.outDir}/control.csv`)).join("\n")).toContain("sol-999,ERROR")
  })
})

describe("fixtures intactos", () => {
  test("los fixtures no contienen archivos nuevos ni de salida", async () => {
    const nombres = await readdir(`${RAIZ}/fixtures/reto-03/solicitudes/sol-001`)
    expect(nombres.sort()).toEqual(["aprobacion.json", "correo.json", "cotizacion.txt", "solicitud.json"])
  })
})
