import { describe, expect, test } from "bun:test"
import { cargarConfig } from "../src/config.ts"

describe("RATE_LIMIT_CHAT_PER_MIN", () => {
  test("ausente → 30 por defecto", () => {
    expect(cargarConfig({}).RATE_LIMIT_CHAT_PER_MIN).toBe(30)
  })
  test("valor válido", () => {
    expect(cargarConfig({ RATE_LIMIT_CHAT_PER_MIN: "5" }).RATE_LIMIT_CHAT_PER_MIN).toBe(5)
    expect(cargarConfig({ RATE_LIMIT_CHAT_PER_MIN: "120" }).RATE_LIMIT_CHAT_PER_MIN).toBe(120)
  })
  test.each([
    ["vacía", ""],
    ["cero", "0"],
    ["negativo", "-5"],
    ["texto no numérico", "abc"],
    ["decimal", "1.5"],
    ["con espacios", " 5 "],
    ["notación científica", "1e2"],
    ["con signo más", "+5"],
    ["cero a la izquierda", "05"],
    ["demasiado grande", "9".repeat(30)],
  ])("rechaza %s", (_nombre, valor) => {
    expect(() => cargarConfig({ RATE_LIMIT_CHAT_PER_MIN: valor })).toThrow(/RATE_LIMIT_CHAT_PER_MIN|entero positivo/)
  })
  test("el mensaje de error nombra la variable", () => {
    try {
      cargarConfig({ RATE_LIMIT_CHAT_PER_MIN: "abc" })
      throw new Error("debía fallar")
    } catch (e) {
      expect(String(e)).toContain("RATE_LIMIT_CHAT_PER_MIN")
    }
  })
  test("el resto de la configuración no cambia", () => {
    expect(cargarConfig({})).toMatchObject({ PORT: 3000, MAX_ITERACIONES: 25, MAX_TOKENS_SESION: 100000, LLM_TIMEOUT_MS: 60000 })
  })
})
