import { describe, expect, test } from "bun:test"
import { normalizarFecha, normalizarMonto, normalizarNit, normalizarNombre, sumarDias } from "../src/core/normalizar.ts"

describe("normalizadores", () => {
  test("NIT", () => {
    expect(normalizarNit("900.555.111-2")).toBe("900555111")
    expect(normalizarNit("900555111")).toBe("900555111")
    expect(normalizarNit(" ")).toBeNull()
    expect(normalizarNit(undefined)).toBeNull()
  })
  test("nombre", () => {
    expect(normalizarNombre("Papelería Central Ltda.")).toBe("papeleria central ltda")
    expect(normalizarNombre("TecnoSuministros S.A.S.")).toBe(normalizarNombre("tecnosuministros SAS"))
  })
  test("fecha", () => {
    expect(normalizarFecha("2026-08-21T10:02:00-05:00")).toBe("2026-08-21")
    expect(normalizarFecha("20/08/2026")).toBe("2026-08-20")
    expect(normalizarFecha("2026-02-30")).toBeNull()
    expect(normalizarFecha("ayer")).toBeNull()
    expect(sumarDias("2026-08-18", 30)).toBe("2026-09-17")
  })
  test("monto", () => {
    expect(normalizarMonto("COP 11.400.000")).toBe(11400000)
    expect(normalizarMonto("1.234,56")).toBe(1234.56)
    expect(normalizarMonto("1,234.56")).toBe(1234.56)
    expect(normalizarMonto(95000)).toBe(95000)
    expect(normalizarMonto("mucho")).toBeNull()
    expect(normalizarMonto(Number.NaN)).toBeNull()
  })
})
