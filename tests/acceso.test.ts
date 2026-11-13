import { describe, expect, test } from "bun:test"
import { compararClaves } from "../src/seguridad.ts"
import { get, post, servidorDePrueba, texto } from "./falso.ts"

const CLAVE = "clave-de-acceso-0123456789"
const conClave = { "X-Access-Key": CLAVE }
type Json = Record<string, unknown>
const j = async (r: Response): Promise<Json> => (await r.json()) as Json

describe("clave de acceso (ACCESS_KEY)", () => {
  test("sin clave configurada el acceso está abierto (comportamiento local anterior)", async () => {
    const { fetch } = await servidorDePrueba([texto("hola")])
    expect((await fetch(post("/api/chat", { message: "hola" }))).status).toBe(200)
    expect(((await j(await fetch(get("/api/health")))).acceso)).toBe("abierto")
  })

  test("/api/chat: 401 sin clave o con clave errónea (y el modelo no se llama); 200 con clave correcta", async () => {
    const { fetch, llm } = await servidorDePrueba([texto("hola")], { accessKey: CLAVE })
    expect((await fetch(post("/api/chat", { message: "hola" }))).status).toBe(401)
    expect((await fetch(post("/api/chat", { message: "hola" }, { "X-Access-Key": "otra-clave-incorrecta-123" }))).status).toBe(401)
    expect((await fetch(post("/api/chat", { message: "hola" }, { "X-Access-Key": "" }))).status).toBe(401)
    expect(llm.peticiones).toBe(0)
    const ok = await fetch(post("/api/chat", { message: "hola" }, conClave))
    expect(ok.status).toBe(200)
    expect((await j(ok)).reply).toBe("hola")
    expect(llm.peticiones).toBe(1)
  })

  test("/api/sessions/:id protegido: 401 sin clave; con clave 200 (existe) o 404 (no existe)", async () => {
    const { fetch } = await servidorDePrueba([texto("hola")], { accessKey: CLAVE })
    await fetch(post("/api/chat", { sessionId: "s-acceso", message: "hola" }, conClave))
    expect((await fetch(get("/api/sessions/s-acceso"))).status).toBe(401)
    expect((await fetch(get("/api/sessions/s-acceso", { "X-Access-Key": "mala-clave-mala-clave" }))).status).toBe(401)
    expect((await fetch(get("/api/sessions/s-acceso", conClave))).status).toBe(200)
    expect((await fetch(get("/api/sessions/no-existe", conClave))).status).toBe(404)
  })

  test("/api/health y los archivos estáticos siguen públicos y reportan el acceso como protegido", async () => {
    const { fetch } = await servidorDePrueba([], { accessKey: CLAVE })
    const h = await fetch(get("/api/health"))
    expect(h.status).toBe(200)
    expect(await j(h)).toMatchObject({ ok: true, acceso: "protegido" })
    for (const ruta of ["/", "/app.js", "/styles.css"]) expect((await fetch(get(ruta))).status).toBe(200)
  })

  test("la clave jamás aparece en respuestas (ni de error ni de health)", async () => {
    const { fetch } = await servidorDePrueba([texto("ok")], { accessKey: CLAVE })
    const respuestas = [
      await fetch(post("/api/chat", { message: "x" })),
      await fetch(post("/api/chat", { message: "x" }, conClave)),
      await fetch(get("/api/sessions/x")),
      await fetch(get("/api/health")),
      await fetch(get("/api/diagnostico", conClave)),
    ]
    for (const r of respuestas) expect(await r.text()).not.toContain(CLAVE)
  })

  test("los intentos sin clave no consumen el límite de mensajes; la clave correcta nunca se bloquea", async () => {
    const { fetch } = await servidorDePrueba([texto("a"), texto("b"), texto("c")], { accessKey: CLAVE, limiteChatPorMinuto: 2 })
    for (let i = 0; i < 5; i++) await fetch(post("/api/chat", { message: "x" }), "9.9.9.9")
    expect((await fetch(post("/api/chat", { message: "x" }, conClave), "9.9.9.9")).status).toBe(200)
    expect((await fetch(post("/api/chat", { message: "x" }, conClave), "9.9.9.9")).status).toBe(200)
    expect((await fetch(post("/api/chat", { message: "x" }, conClave), "9.9.9.9")).status).toBe(429) // el límite normal sí aplica
  })

  test("fuerza bruta: tras 10 fallos por minuto desde una IP se responde 429; la clave correcta sigue pasando", async () => {
    const { fetch } = await servidorDePrueba([texto("ok")], { accessKey: CLAVE })
    const estados: number[] = []
    for (let i = 0; i < 13; i++) estados.push((await fetch(get("/api/sessions/x", { "X-Access-Key": `incorrecta-numero-${i}-abcdef` }), "7.7.7.7")).status)
    expect(estados.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(estados.slice(10).every((s) => s === 429)).toBe(true)
    expect((await fetch(get("/api/sessions/x", conClave), "7.7.7.7")).status).toBe(404) // autorizada (la sesión no existe)
    expect((await fetch(get("/api/sessions/x", { "X-Access-Key": "incorrecta-desde-otra-ip" }), "8.8.8.8")).status).toBe(401) // otra IP no se ve afectada
  })

  test("CORS: el preflight de un origen permitido admite la cabecera X-Access-Key; un origen ajeno sigue en 403", async () => {
    const { fetch } = await servidorDePrueba([], { accessKey: CLAVE, corsOrigins: ["https://app.ejemplo.com"] })
    const pre = await fetch(new Request("http://localhost:3000/api/chat", { method: "OPTIONS", headers: { Origin: "https://app.ejemplo.com" } }))
    expect(pre.headers.get("access-control-allow-headers")).toContain("X-Access-Key")
    const ajeno = await fetch(post("/api/chat", { message: "x" }, { Origin: "https://malo.com", ...conClave }))
    expect(ajeno.status).toBe(403)
  })

  test("CSP intacta y sin caché en respuestas de error 401", async () => {
    const { fetch } = await servidorDePrueba([], { accessKey: CLAVE })
    const r = await fetch(post("/api/chat", { message: "x" }))
    expect(r.headers.get("content-security-policy")).toContain("script-src 'self'")
    expect(r.headers.get("cache-control")).toBe("no-store")
  })
})

describe("/api/diagnostico", () => {
  test("no existe sin clave configurada (404); con clave la exige y devuelve cabeceras de red sin secretos", async () => {
    const abierto = await servidorDePrueba([])
    expect((await abierto.fetch(get("/api/diagnostico"))).status).toBe(404)
    const { fetch } = await servidorDePrueba([], { accessKey: CLAVE })
    expect((await fetch(get("/api/diagnostico"))).status).toBe(401)
    const r = await fetch(get("/api/diagnostico", { ...conClave, "X-Forwarded-For": "1.2.3.4, 10.0.0.1" }), "10.9.9.9")
    expect(r.status).toBe(200)
    const d = await j(r)
    expect(d).toMatchObject({ ok: true, ipSocket: "10.9.9.9", ipEfectiva: "10.9.9.9", trustProxy: { activo: false } })
    expect((d.cabeceras as Record<string, string>)["x-forwarded-for"]).toBe("1.2.3.4, 10.0.0.1")
  })
})

describe("compararClaves (tiempo constante)", () => {
  test("igual, distinta, distinta longitud, vacía", () => {
    expect(compararClaves(CLAVE, CLAVE)).toBe(true)
    expect(compararClaves(CLAVE + "x", CLAVE)).toBe(false)
    expect(compararClaves("", CLAVE)).toBe(false)
    expect(compararClaves(CLAVE.slice(0, -1), CLAVE)).toBe(false)
  })
  test("el código usa timingSafeEqual sobre digests y no el operador ===", async () => {
    const src = await Bun.file(`${import.meta.dir}/../src/seguridad.ts`).text()
    expect(src).toContain("timingSafeEqual")
    expect(src).toContain("createHash")
    const server = await Bun.file(`${import.meta.dir}/../src/server.ts`).text()
    expect(server).toContain("compararClaves(")
    expect(server).not.toMatch(/x-access-key"\) *(===|!==)/)
  })
})
