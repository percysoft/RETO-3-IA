import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"

const R = `${import.meta.dir}/..`
const leer = (p: string) => Bun.file(`${R}/${p}`).text()

describe("Dockerfile", () => {
  test("imagen fijada, instalación reproducible de producción y usuario no root", async () => {
    const d = await leer("Dockerfile")
    expect(d).toContain("FROM oven/bun:1.4.4-slim")
    expect(d).toContain("bun install --frozen-lockfile --production")
    expect(d).toContain("USER bun")
    expect(d).toContain("HOST=0.0.0.0")
    expect(d).toContain("PORT=10000")
    expect(d).toContain('CMD ["bun", "run", "src/server.ts"]')
  })
  test("copia explícita: nunca `COPY .` y solo los directorios necesarios", async () => {
    const d = await leer("Dockerfile")
    const copias = d.split("\n").filter((l) => /^COPY\b/.test(l.trim()) && !l.includes("--from="))
    expect(copias.some((l) => /^COPY\s+\.\s/.test(l.trim()))).toBe(false)
    const origen = [...new Set(copias.flatMap((l) => l.trim().split(/\s+/).slice(1, -1)))]
    expect(origen.sort()).toEqual(["agent", "bun.lock", "fixtures", "package.json", "src", "tsconfig.json", "web"].sort())
    for (const prohibido of [".env", "out", "node_modules", "tests", "docs", "PRD.md", "backups"]) expect(origen).not.toContain(prohibido)
  })
  test("ningún secreto en ENV/ARG del Dockerfile", async () => {
    const d = await leer("Dockerfile")
    const asignaciones = d.split("\n").filter((l) => /^\s*(ENV|ARG)\b|^\s+[A-Z_]+=/.test(l))
    for (const l of asignaciones) expect(l).not.toMatch(/KEY|SECRET|TOKEN|PASSWORD/i)
    expect(d).not.toMatch(/sk-ant/)
  })
})

describe(".dockerignore y .gitignore", () => {
  test(".dockerignore es lista blanca y bloquea .env, out, node_modules y respaldos", async () => {
    const lineas = (await leer(".dockerignore")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    expect(lineas[0]).toBe("*")
    const incluidos = lineas.filter((l) => l.startsWith("!")).map((l) => l.slice(1).replace(/\/$/, ""))
    expect(incluidos.sort()).toEqual(["agent", "bun.lock", "fixtures", "package.json", "src", "tsconfig.json", "web"].sort())
    for (const bloqueado of ["**/.env", "**/.env.*", "**/out", "**/node_modules", "**/backups*"]) expect(lineas).toContain(bloqueado)
  })
  test("contexto de construcción simulado: no incluye .env, out/, node_modules/ ni tests", async () => {
    const incluidos = (await leer(".dockerignore")).split("\n").filter((l) => l.startsWith("!")).map((l) => l.slice(1).replace(/\/$/, ""))
    const raiz = readdirSync(R).filter((n) => incluidos.includes(n))
    for (const n of [".env", "out", "node_modules", "tests", "docs", "PRD.md"]) expect(raiz).not.toContain(n)
    expect(raiz).toEqual(expect.arrayContaining(["src", "agent", "web", "fixtures", "package.json"]))
  })
  test(".gitignore excluye .env, out/ y node_modules/", async () => {
    const g = (await leer(".gitignore")).split("\n").map((l) => l.trim())
    for (const e of [".env", "out/", "node_modules/"]) expect(g).toContain(e)
  })
})

describe("render.yaml", () => {
  test("Docker, plan free, health check, despliegue manual entre comillas", async () => {
    const y = await leer("render.yaml")
    expect(y).toMatch(/runtime:\s*docker/)
    expect(y).toMatch(/plan:\s*free/)
    expect(y).toMatch(/healthCheckPath:\s*\/api\/health/)
    expect(y).toMatch(/autoDeployTrigger:\s*"off"/)
  })
  test("LLM_API_KEY y ACCESS_KEY son secretos no sincronizados y sin valor en el archivo", async () => {
    const y = await leer("render.yaml")
    for (const k of ["LLM_API_KEY", "ACCESS_KEY"]) {
      const bloque = new RegExp(`- key: ${k}\\n\\s+sync: false\\n`)
      expect(y).toMatch(bloque)
      expect(y).not.toMatch(new RegExp(`- key: ${k}\\n\\s+value:`))
    }
    expect(y).not.toMatch(/sk-ant/)
  })
  test("TRUST_PROXY desactivado, almacenamiento efímero declarado y presupuesto global definido", async () => {
    const y = await leer("render.yaml")
    expect(y).toMatch(/- key: TRUST_PROXY\n\s+value: "false"/)
    expect(y).toMatch(/- key: EPHEMERAL_STORAGE\n\s+value: "true"/)
    expect(y).toMatch(/- key: GLOBAL_TOKEN_BUDGET\n\s+value: "\d+"/)
    expect(y).toMatch(/- key: NODE_ENV\n\s+value: production/)
  })
})

describe("front: pantalla de acceso", () => {
  test("la clave va solo en la cabecera X-Access-Key y se guarda en sessionStorage (no localStorage)", async () => {
    const js = await leer("web/app.js")
    expect(js).toContain('"X-Access-Key"')
    expect(js).toContain("sessionStorage")
    expect(js).not.toMatch(/localStorage\.(set|get)Item\(CLAVE_ACCESO/)
    expect(js).not.toMatch(/[?&](clave|key|access[_-]?key)=/i)
    expect(js).not.toMatch(/console\.log\([^)]*clave/i)
  })
  test("el HTML tiene el diálogo de acceso accesible, campo de contraseña y sin scripts ni estilos en línea", async () => {
    const h = await leer("web/index.html")
    expect(h).toContain('id="acceso"')
    expect(h).toContain('role="dialog"')
    expect(h).toMatch(/<input id="clave" type="password"/)
    expect(h).toContain('id="aviso-efimero"')
    expect(h).not.toMatch(/<script(?![^>]*\ssrc=)/)
    expect(h).not.toMatch(/\sstyle="/)
    expect(h).not.toMatch(/\son[a-z]+="/)
  })
  test("el front sigue sin enviar `confirmado` y sin innerHTML con datos crudos", async () => {
    const js = await leer("web/app.js")
    expect(js).not.toMatch(/confirmado\s*:/)
    expect(js).not.toMatch(/innerHTML\s*=\s*(?!renderMarkdown)[a-z]/i)
  })
})
