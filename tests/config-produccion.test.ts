import { describe, expect, test } from "bun:test"
import { cargarConfig } from "../src/config.ts"

const CLAVE_VALIDA = "clave-de-acceso-0123456789"

describe("HOST", () => {
  test("ausente → 127.0.0.1; informado → se respeta", () => {
    expect(cargarConfig({}).HOST).toBe("127.0.0.1")
    expect(cargarConfig({ HOST: "0.0.0.0" }).HOST).toBe("0.0.0.0")
  })
  test.each([["vacío", ""], ["solo espacios", "   "]])("rechaza %s", (_n, v) => {
    expect(() => cargarConfig({ HOST: v })).toThrow(/HOST/)
  })
})

describe("ACCESS_KEY", () => {
  test("fuera de producción puede omitirse o dejarse vacía → acceso abierto", () => {
    expect(cargarConfig({}).ACCESS_KEY).toBeUndefined()
    expect(cargarConfig({ ACCESS_KEY: "" }).ACCESS_KEY).toBeUndefined()
    expect(cargarConfig({ NODE_ENV: "development", ACCESS_KEY: "  " }).ACCESS_KEY).toBeUndefined()
  })
  test("en producción es obligatoria", () => {
    expect(() => cargarConfig({ NODE_ENV: "production" })).toThrow(/obligatoria en producción/)
    expect(() => cargarConfig({ NODE_ENV: "production", ACCESS_KEY: "" })).toThrow(/obligatoria en producción/)
    expect(() => cargarConfig({ NODE_ENV: "production", ACCESS_KEY: "   " })).toThrow(/obligatoria en producción/)
  })
  test("mínimo 16 caracteres, en producción y fuera de ella", () => {
    expect(() => cargarConfig({ NODE_ENV: "production", ACCESS_KEY: "corta-123456789" })).toThrow(/al menos 16/)
    expect(() => cargarConfig({ ACCESS_KEY: "corta" })).toThrow(/al menos 16/)
    expect(cargarConfig({ NODE_ENV: "production", ACCESS_KEY: "x".repeat(16) }).ACCESS_KEY).toBe("x".repeat(16))
  })
  test("clave válida en producción", () => {
    expect(cargarConfig({ NODE_ENV: "production", ACCESS_KEY: CLAVE_VALIDA }).ACCESS_KEY).toBe(CLAVE_VALIDA)
  })
  test("el error nunca incluye el valor de la clave", () => {
    for (const k of ["secreto-corto", "otra-clave-muy-corta"]) {
      try {
        cargarConfig({ NODE_ENV: "production", ACCESS_KEY: k })
        throw new Error("debía fallar")
      } catch (e) {
        expect(String(e)).not.toContain(k)
      }
    }
  })
})

describe("TRUST_PROXY y presupuesto", () => {
  test("valores por defecto seguros", () => {
    const c = cargarConfig({})
    expect(c).toMatchObject({ TRUST_PROXY: false, TRUST_PROXY_HEADER: "x-forwarded-for", TRUST_PROXY_HOPS: 1, EPHEMERAL_STORAGE: false })
    expect(c.GLOBAL_TOKEN_BUDGET).toBeUndefined()
  })
  test("TRUST_PROXY solo acepta true/false", () => {
    expect(cargarConfig({ TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true)
    for (const v of ["", "yes", "1", "TRUE"]) expect(() => cargarConfig({ TRUST_PROXY: v })).toThrow(/TRUST_PROXY/)
  })
  test("TRUST_PROXY_HOPS y GLOBAL_TOKEN_BUDGET: enteros positivos", () => {
    expect(cargarConfig({ TRUST_PROXY_HOPS: "2" }).TRUST_PROXY_HOPS).toBe(2)
    expect(cargarConfig({ GLOBAL_TOKEN_BUDGET: "500000" }).GLOBAL_TOKEN_BUDGET).toBe(500000)
    for (const v of ["0", "-1", "1.5", "abc", ""]) {
      expect(() => cargarConfig({ GLOBAL_TOKEN_BUDGET: v })).toThrow(/GLOBAL_TOKEN_BUDGET/)
      expect(() => cargarConfig({ TRUST_PROXY_HOPS: v })).toThrow(/TRUST_PROXY_HOPS/)
    }
  })
})
