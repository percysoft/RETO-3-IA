import { describe, expect, test } from "bun:test"
import { ErrorLlm } from "../src/llm/adapter.ts"
import { get, lanza, post, servidorDePrueba, texto, usa } from "./falso.ts"

type Json = Record<string, unknown>
const j = async (r: Response): Promise<Json> => (await r.json()) as Json

async function lineas(ruta: string): Promise<string[]> {
  const f = Bun.file(ruta)
  return (await f.exists()) ? (await f.text()).split("\n").filter((l) => l !== "") : []
}

describe("GET /api/health", () => {
  test("estado del servidor y de la IA, con límites y sin secretos", async () => {
    const { fetch } = await servidorDePrueba([], { secreto: "sk-ant-secreta-123456" })
    const r = await fetch(get("/api/health"))
    expect(r.status).toBe(200)
    const cuerpo = await j(r)
    expect(cuerpo).toMatchObject({ ok: true, servidor: "activo", llm: { configurado: true, proveedor: "falso", modelo: "falso-1" } })
    expect(cuerpo.limites).toMatchObject({ maxIteraciones: 25 })
    expect(JSON.stringify(cuerpo)).not.toContain("sk-ant")
  })
  test("sin agente: informa que la IA no está configurada y el chat responde 503", async () => {
    const { fetch } = await servidorDePrueba([], { sinAgente: true, motivoSinAgente: "Falta la clave del proveedor de IA: defina LLM_API_KEY." })
    const h = await j(await fetch(get("/api/health")))
    expect(h.llm).toMatchObject({ configurado: false, proveedor: "anthropic", modelo: "claude-opus-5-5" })
    const c = await fetch(post("/api/chat", { message: "hola" }))
    expect(c.status).toBe(503)
    expect((await j(c)).error).toContain("LLM_API_KEY")
  })
})

describe("POST /api/chat", () => {
  test("crea sesión, ejecuta el agente y devuelve respuesta, estado y tool calls", async () => {
    const { fetch, outDir } = await servidorDePrueba([usa("oc_validar", { caso: "sol-001" }), usa("oc_crear", { caso: "sol-001" }), texto("OC creada.")])
    const r = await fetch(post("/api/chat", { message: "procesa sol-001" }))
    expect(r.status).toBe(200)
    const c = await j(r)
    expect(c).toMatchObject({ ok: true, reply: "OC creada.", needsConfirmation: false })
    expect(typeof c.sessionId).toBe("string")
    expect((c.toolCalls as { herramienta: string }[]).map((t) => t.herramienta)).toEqual(["oc_validar", "oc_crear"])
    expect((await lineas(`${outDir}/sap/ordenes.jsonl`)).length).toBe(1)
  })

  test("recuperación de sesión: historial, tool calls y estado", async () => {
    const { fetch } = await servidorDePrueba([usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?")])
    const c = await j(await fetch(post("/api/chat", { sessionId: "ses-1", message: "procesa sol-004" })))
    expect(c.sessionId).toBe("ses-1")
    expect(c).toMatchObject({ needsConfirmation: true, pendiente: { caso: "sol-004", presentada: true } })
    const r = await fetch(get("/api/sessions/ses-1"))
    expect(r.status).toBe(200)
    const s = await j(r)
    expect(s).toMatchObject({ ok: true, id: "ses-1", needsConfirmation: true, turnos: 1 })
    expect((s.historial as { rol: string }[]).map((h) => h.rol)).toEqual(["user", "tool", "assistant"])
    expect(await fetch(get("/api/sessions/no-existe")).then((x) => x.status)).toBe(404)
    expect(await fetch(get("/api/sessions/%2e%2e%2fetc")).then((x) => x.status)).toBe(400)
  })

  test("confirmación válida: «Confirmo» crea la OC; antes no existe", async () => {
    const { fetch, outDir } = await servidorDePrueba([
      usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"),
      usa("oc_crear", { caso: "sol-004", confirmado: true }), texto("Creada."),
    ])
    const t1 = await j(await fetch(post("/api/chat", { sessionId: "c1", message: "procesa sol-004" })))
    expect(t1.needsConfirmation).toBe(true)
    expect((await lineas(`${outDir}/sap/ordenes.jsonl`)).length).toBe(0)
    const t2 = await j(await fetch(post("/api/chat", { sessionId: "c1", message: "Confirmo" })))
    expect(t2).toMatchObject({ ok: true, needsConfirmation: false, pendiente: null })
    expect((t2.toolCalls as { ok: boolean }[])[0]?.ok).toBe(true)
    expect((await lineas(`${outDir}/sap/ordenes.jsonl`)).length).toBe(1)
  })

  test("confirmación inválida: mensaje ambiguo no crea; el cliente no puede forzar confirmado=true", async () => {
    const { fetch, outDir } = await servidorDePrueba([
      usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"),
      usa("oc_crear", { caso: "sol-004", confirmado: true }), texto("Necesito «confirmo»."),
    ])
    await fetch(post("/api/chat", { sessionId: "c2", message: "procesa sol-004" }))
    const t2 = await j(await fetch(post("/api/chat", { sessionId: "c2", message: "dale, hazlo ya" })))
    expect((t2.toolCalls as { ok: boolean }[])[0]?.ok).toBe(false)
    expect(t2.needsConfirmation).toBe(true)
    // Campos extra enviados por el cliente (confirmado, payload…) se rechazan.
    const x = await fetch(post("/api/chat", { sessionId: "c2", message: "Confirmo", confirmado: true }))
    expect(x.status).toBe(400)
    expect((await lineas(`${outDir}/sap/ordenes.jsonl`)).length).toBe(0)
  })

  test("«No confirmo» descarta la confirmación pendiente", async () => {
    const { fetch } = await servidorDePrueba([usa("oc_validar", { caso: "sol-004" }), texto("¿Confirmas?"), texto("Entendido, no se crea.")])
    await fetch(post("/api/chat", { sessionId: "r1", message: "procesa sol-004" }))
    const t2 = await j(await fetch(post("/api/chat", { sessionId: "r1", message: "No confirmo" })))
    expect(t2).toMatchObject({ needsConfirmation: false, pendiente: null })
  })

  test("bloqueos: sol-002 no se crea y la razón queda en las tool calls", async () => {
    const { fetch, outDir } = await servidorDePrueba([usa("oc_validar", { caso: "sol-002" }), usa("oc_crear", { caso: "sol-002" }), texto("Bloqueada por RC1.")])
    const c = await j(await fetch(post("/api/chat", { message: "procesa sol-002" })))
    const tcs = c.toolCalls as { resumen: string; ok: boolean }[]
    expect(tcs[0]?.resumen).toContain("bloqueos=RC1")
    expect(tcs[1]?.ok).toBe(false)
    expect(c.needsConfirmation).toBe(false)
    expect((await lineas(`${outDir}/sap/ordenes.jsonl`)).length).toBe(0)
  })

  test("errores del LLM: estado HTTP adecuado, mensaje claro y el servidor sigue operativo", async () => {
    const { fetch } = await servidorDePrueba([
      lanza(new ErrorLlm("timeout", "El proveedor de IA tardó demasiado en responder (timeout).")),
      lanza(new ErrorLlm("autenticacion", "El proveedor de IA rechazó las credenciales configuradas en el servidor.")),
      lanza(new ErrorLlm("limite_tasa", "El proveedor de IA está limitando las solicitudes; reintenta en unos segundos.")),
      lanza(new Error("boom con stack")),
      texto("ya estoy de vuelta"),
    ])
    const estados: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = await fetch(post("/api/chat", { sessionId: "e1", message: `intento ${i}` }))
      estados.push(r.status)
      const c = await j(r)
      expect(c.ok).toBe(false)
      expect(JSON.stringify(c)).not.toMatch(/stack|at .*\.ts|boom/i)
    }
    expect(estados).toEqual([504, 502, 429, 502])
    const ok = await fetch(post("/api/chat", { sessionId: "e1", message: "¿sigues?" }))
    expect(ok.status).toBe(200)
    expect((await j(ok)).reply).toBe("ya estoy de vuelta")
  })

  test("validación de entrada: 400 / 413 / 415", async () => {
    const { fetch, llm } = await servidorDePrueba([])
    const casos: [Request, number][] = [
      [post("/api/chat", "{no es json"), 400],
      [post("/api/chat", {}), 400],
      [post("/api/chat", { message: "   " }), 400],
      [post("/api/chat", { message: 5 }), 400],
      [post("/api/chat", { message: "x".repeat(4001) }), 400],
      [post("/api/chat", { message: "hola", sessionId: "../x" }), 400],
      [post("/api/chat", { message: "hola", extra: 1 }), 400],
      [post("/api/chat", { message: "x".repeat(20000) }), 413],
      [post("/api/chat", { message: "hola" }, { "Content-Type": "text/plain" }), 415],
    ]
    for (const [req, status] of casos) expect((await fetch(req)).status).toBe(status)
    expect(llm.peticiones).toBe(0)
  })

  test("límite de frecuencia por IP", async () => {
    const { fetch } = await servidorDePrueba([texto("a"), texto("b"), texto("c")], { limiteChatPorMinuto: 2 })
    const estados: number[] = []
    for (let i = 0; i < 3; i++) estados.push((await fetch(post("/api/chat", { message: "hola" }), "1.2.3.4")).status)
    expect(estados).toEqual([200, 200, 429])
    expect((await fetch(post("/api/chat", { message: "hola" }), "5.6.7.8")).status).toBe(200)
  })
})

describe("seguridad HTTP", () => {
  test("rutas y métodos: 404 / 405 en JSON, sin stack traces", async () => {
    const { fetch } = await servidorDePrueba([])
    expect((await fetch(get("/api/nada"))).status).toBe(404)
    const m = await fetch(get("/api/chat"))
    expect(m.status).toBe(405)
    expect(m.headers.get("allow")).toContain("POST")
    expect((await fetch(new Request("http://localhost:3000/api/health", { method: "DELETE" }))).status).toBe(405)
    expect((await fetch(new Request("http://localhost:3000/api/sap/ordenes", { method: "POST", body: "{}" }))).status).toBe(404)
  })

  test("cabeceras de seguridad y sin caché en la API", async () => {
    const { fetch } = await servidorDePrueba([])
    const r = await fetch(get("/api/health"))
    expect(r.headers.get("x-content-type-options")).toBe("nosniff")
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'")
    expect(r.headers.get("cache-control")).toBe("no-store")
  })

  test("CORS restrictivo: mismo origen sí, externo no, lista blanca con cabeceras", async () => {
    const { fetch } = await servidorDePrueba([texto("ok")], { corsOrigins: ["https://app.ejemplo.com"] })
    const mismo = await fetch(get("/api/health", { Origin: "http://localhost:3000" }))
    expect(mismo.status).toBe(200)
    expect(mismo.headers.get("access-control-allow-origin")).toBeNull()
    const ajeno = await fetch(post("/api/chat", { message: "hola" }, { Origin: "https://malo.com" }))
    expect(ajeno.status).toBe(403)
    const pre = await fetch(new Request("http://localhost:3000/api/chat", { method: "OPTIONS", headers: { Origin: "https://malo.com" } }))
    expect(pre.status).toBe(403)
    const preOk = await fetch(new Request("http://localhost:3000/api/chat", { method: "OPTIONS", headers: { Origin: "https://app.ejemplo.com" } }))
    expect(preOk.status).toBe(204)
    expect(preOk.headers.get("access-control-allow-origin")).toBe("https://app.ejemplo.com")
    expect(preOk.headers.get("access-control-allow-methods")).not.toContain("DELETE")
    const ok = await fetch(post("/api/chat", { message: "hola" }, { Origin: "https://app.ejemplo.com" }))
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.ejemplo.com")
  })

  test("la clave no aparece en ninguna respuesta (ni en errores del proveedor)", async () => {
    const clave = "sk-ant-secreta-123456789"
    const { fetch } = await servidorDePrueba([lanza(new ErrorLlm("proveedor", `fallo con ${clave}`)), texto("ok")], { secreto: clave })
    const c = await fetch(post("/api/chat", { sessionId: "k1", message: "hola" }))
    const cuerpo = await c.text()
    expect(cuerpo).not.toContain(clave)
    expect(await (await fetch(get("/api/sessions/k1"))).text()).not.toContain(clave)
    expect(await (await fetch(get("/api/health"))).text()).not.toContain(clave)
  })

  test("estáticos: solo la lista cerrada de web/, sin traversal", async () => {
    const { fetch } = await servidorDePrueba([])
    const html = await fetch(get("/"))
    expect(html.status).toBe(200)
    expect(html.headers.get("content-type")).toContain("text/html")
    expect(await html.text()).toContain("Agente de Órdenes de Compra")
    expect((await fetch(get("/app.js"))).headers.get("content-type")).toContain("javascript")
    expect((await fetch(get("/styles.css"))).status).toBe(200)
    for (const ruta of ["/../package.json", "/.env", "/src/server.ts", "/fixtures/reto-03/maestros/proveedores.json", "/%2e%2e/.env"]) {
      expect((await fetch(get(ruta))).status).toBe(404)
    }
  })

  test("el front nunca envía confirmado ni simula resultados", async () => {
    const js = await Bun.file(`${import.meta.dir}/../web/app.js`).text()
    expect(js).not.toMatch(/confirmado\s*:/)
    expect(js).toContain('FRASE_CONFIRMAR = "Confirmo"')
    expect(js).toContain('FRASE_RECHAZAR = "No confirmo"')
    expect(js).not.toMatch(/innerHTML\s*=\s*(?!renderMarkdown)[a-z]/i)
  })
})

describe("resúmenes de tool calls legibles", () => {
  test("payload, evidencia y paquete se resumen sin volcar JSON crudo", async () => {
    const { fetch } = await servidorDePrueba([
      usa("oc_leer_paquete", { caso: "sol-005" }), usa("oc_generar_evidencia", { caso: "sol-005" }), usa("oc_construir_payload", { caso: "sol-005" }), texto("ok"),
    ])
    const c = await j(await fetch(post("/api/chat", { message: "x" })))
    const r = (c.toolCalls as { resumen: string }[]).map((t) => t.resumen)
    expect(r[0]).toContain("paquete SOL-2026-005; faltantes=ninguno; factura=sí")
    expect(r[1]).toMatch(/^evidencia=out\/sol-005\/aprobacion\.txt; sha256=[0-9a-f]{12}…$/)
    expect(r[2]).toContain("OC lista para Papelería Central Ltda.; posiciones=1; excepciones=RC8")
  })
})
