import { describe, expect, test } from "bun:test"
import { cargarConfig } from "../src/config.ts"
import { get, post, servidorDePrueba, texto } from "./falso.ts"

describe("ALLOW_OPEN_ACCESS (demo pública sin clave)", () => {
  test("producción sin clave sigue fallando salvo que se active explícitamente", () => {
    expect(() => cargarConfig({ NODE_ENV: "production" })).toThrow(/ACCESS_KEY es obligatoria/)
    expect(() => cargarConfig({ NODE_ENV: "production", ALLOW_OPEN_ACCESS: "false" })).toThrow(/ACCESS_KEY es obligatoria/)
    const c = cargarConfig({ NODE_ENV: "production", ALLOW_OPEN_ACCESS: "true" })
    expect(c).toMatchObject({ ALLOW_OPEN_ACCESS: true, ACCESS_KEY: undefined })
  })
  test("no se puede combinar con ACCESS_KEY (evita un estado ambiguo)", () => {
    const k = "clave-de-acceso-0123456789"
    expect(() => cargarConfig({ NODE_ENV: "production", ALLOW_OPEN_ACCESS: "true", ACCESS_KEY: k })).toThrow(/no puede combinarse/)
    try { cargarConfig({ ALLOW_OPEN_ACCESS: "true", ACCESS_KEY: k }) } catch (e) { expect(String(e)).not.toContain(k) }
  })
  test("solo acepta true/false y por defecto es false", () => {
    expect(cargarConfig({}).ALLOW_OPEN_ACCESS).toBe(false)
    for (const v of ["", "yes", "1", "TRUE"]) expect(() => cargarConfig({ ALLOW_OPEN_ACCESS: v })).toThrow(/ALLOW_OPEN_ACCESS/)
  })
  test("el mensaje de error de producción menciona la salida explícita", () => {
    expect(() => cargarConfig({ NODE_ENV: "production" })).toThrow(/ALLOW_OPEN_ACCESS=true/)
  })
})

describe("servidor en modo abierto", () => {
  test("sin clave: /api/chat responde 200 sin cabecera, health lo declara abierto y /api/diagnostico no existe", async () => {
    const { fetch } = await servidorDePrueba([texto("hola")])
    const r = await fetch(post("/api/chat", { message: "hola" }))
    expect(r.status).toBe(200)
    expect((await (await fetch(get("/api/health"))).json()) as { acceso: string }).toMatchObject({ acceso: "abierto" })
    expect((await fetch(get("/api/diagnostico"))).status).toBe(404)
  })
  test("los límites siguen activos en modo abierto (frecuencia por IP)", async () => {
    const { fetch } = await servidorDePrueba([texto("a"), texto("b"), texto("c")], { limiteChatPorMinuto: 2 })
    const estados: number[] = []
    for (let i = 0; i < 3; i++) estados.push((await fetch(post("/api/chat", { message: "x" }), "4.4.4.4")).status)
    expect(estados).toEqual([200, 200, 429])
  })
})

describe("arranque real en producción abierta", () => {
  test("imprime la advertencia de acceso abierto y no revela claves", async () => {
    const proc = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd: `${import.meta.dir}/..`,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "production", ALLOW_OPEN_ACCESS: "true", PORT: "10077", GLOBAL_TOKEN_BUDGET: "300000" },
      stdout: "pipe", stderr: "pipe",
    })
    let salida = ""
    const lector = proc.stdout.getReader()
    const dec = new TextDecoder()
    const limite = Date.now() + 8000
    while (Date.now() < limite && !salida.includes("Servidor en")) {
      const { value, done } = await Promise.race([lector.read(), Bun.sleep(500).then(() => ({ value: undefined, done: false }))])
      if (value) salida += dec.decode(value)
      if (done) break
    }
    proc.kill()
    await proc.exited
    const err = await new Response(proc.stderr).text().catch(() => "")
    const todo = salida + err
    expect(todo).toContain("acceso: ABIERTO")
    expect(todo).toContain("ALLOW_OPEN_ACCESS=true")
    expect(todo).toContain("300000")
    expect(todo).not.toMatch(/sk-ant|ACCESS_KEY=/)
  })
})
