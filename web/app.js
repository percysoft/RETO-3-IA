"use strict"

/* Frontend sin frameworks. Solo consume /api/*; no calcula ni simula resultados y
   nunca envía confirmado=true: la confirmación son frases de texto que valida el backend. */

const CLAVE_SESION = "oc_session_id"
const CLAVE_ACCESO = "oc_access_key" // solo sessionStorage: se borra al cerrar la pestaña
const FRASE_CONFIRMAR = "Confirmo"
const FRASE_RECHAZAR = "No confirmo"
const CASOS = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]
const TIMEOUT_CLIENTE_MS = 150000

const $ = (id) => document.getElementById(id)
const el = {
  mensajes: $("mensajes"), bienvenida: $("bienvenida"), chips: $("chips"), procesando: $("procesando"),
  confirmacion: $("confirmacion"), confDetalle: $("conf-detalle"), btnConfirmar: $("btn-confirmar"), btnRechazar: $("btn-rechazar"),
  form: $("form"), texto: $("texto"), btnEnviar: $("btn-enviar"), btnNueva: $("btn-nueva"),
  health: $("health"), avisoIa: $("aviso-ia"), avisoEfimero: $("aviso-efimero"),
  acceso: $("acceso"), formAcceso: $("form-acceso"), clave: $("clave"), accesoError: $("acceso-error"), btnAcceso: $("btn-acceso"),
  sId: $("s-id"), sEstado: $("s-estado"), sPendiente: $("s-pendiente"), sModelo: $("s-modelo"),
  sTokens: $("s-tokens"), sTokensTxt: $("s-tokens-txt"),
}

const estado = { sessionId: null, enviando: false, needsConfirmation: false, pendiente: null, tokens: 0, maxTokens: 0, iaLista: false, ultimoValidar: null, protegido: false, accesoOk: true }

// ---------- utilidades ----------

function leerAlmacen() { try { return localStorage.getItem(CLAVE_SESION) } catch { return null } }
function guardarAlmacen(v) { try { v ? localStorage.setItem(CLAVE_SESION, v) : localStorage.removeItem(CLAVE_SESION) } catch { /* sin almacenamiento */ } }

function leerClave() { try { return sessionStorage.getItem(CLAVE_ACCESO) } catch { return null } }
function guardarClave(v) { try { v ? sessionStorage.setItem(CLAVE_ACCESO, v) : sessionStorage.removeItem(CLAVE_ACCESO) } catch { /* sin almacenamiento */ } }

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/* Markdown mínimo y seguro: se escapa TODO el texto primero y solo después se agregan etiquetas propias. */
function inline(s) {
  return s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
}
function celdas(linea) {
  return linea.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => inline(c.trim()))
}
function renderMarkdown(origen) {
  const lineas = esc(origen).split("\n")
  const salida = []
  let i = 0
  while (i < lineas.length) {
    const l = lineas[i]
    if (l.trim() === "") { i++; continue }
    if (l.trim().startsWith("|") && i + 1 < lineas.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lineas[i + 1]) && lineas[i + 1].includes("-")) {
      const cab = celdas(l); i += 2
      const filas = []
      while (i < lineas.length && lineas[i].trim().startsWith("|")) { filas.push(celdas(lineas[i])); i++ }
      salida.push("<table><thead><tr>" + cab.map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>" +
        filas.map((f) => "<tr>" + f.map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody></table>")
      continue
    }
    if (/^\s*[-*] /.test(l)) {
      const items = []
      while (i < lineas.length && /^\s*[-*] /.test(lineas[i])) { items.push(inline(lineas[i].replace(/^\s*[-*] /, ""))); i++ }
      salida.push("<ul>" + items.map((x) => `<li>${x}</li>`).join("") + "</ul>"); continue
    }
    if (/^\s*\d+\. /.test(l)) {
      const items = []
      while (i < lineas.length && /^\s*\d+\. /.test(lineas[i])) { items.push(inline(lineas[i].replace(/^\s*\d+\. /, ""))); i++ }
      salida.push("<ol>" + items.map((x) => `<li>${x}</li>`).join("") + "</ol>"); continue
    }
    if (/^#{1,4} /.test(l)) { salida.push(`<p><strong>${inline(l.replace(/^#{1,4} /, ""))}</strong></p>`); i++; continue }
    const parrafo = []
    while (i < lineas.length && lineas[i].trim() !== "" && !lineas[i].trim().startsWith("|") && !/^\s*([-*]|\d+\.) /.test(lineas[i]) && !/^#{1,4} /.test(lineas[i])) { parrafo.push(inline(lineas[i])); i++ }
    if (parrafo.length) salida.push("<p>" + parrafo.join("<br>") + "</p>")
  }
  return salida.join("")
}

function bajar() { el.mensajes.scrollTop = el.mensajes.scrollHeight }
function ocultarBienvenida() { if (el.bienvenida) el.bienvenida.hidden = true }

// ---------- render del chat ----------

function agregarMensaje(rol, texto, opciones = {}) {
  ocultarBienvenida()
  const d = document.createElement("div")
  d.className = `msg msg-${rol}`
  if (rol === "user") d.textContent = texto
  else d.innerHTML = renderMarkdown(texto)
  if (opciones.pideConfirmacion) d.classList.add("pide-confirmacion")
  el.mensajes.appendChild(d)
  bajar()
  return d
}

function agregarError(texto) {
  ocultarBienvenida()
  const d = document.createElement("div")
  d.className = "msg msg-error"
  d.setAttribute("role", "alert")
  d.textContent = texto
  el.mensajes.appendChild(d)
  bajar()
}

function argsLegibles(args) {
  if (args && typeof args === "object") {
    const partes = Object.entries(args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    return partes.length ? partes.join(", ") : "(sin argumentos)"
  }
  return JSON.stringify(args)
}

function agregarTool(llamada) {
  ocultarBienvenida()
  const d = document.createElement("div")
  d.className = "tool" + (llamada.ok ? "" : " tool-err")
  const cab = document.createElement("div"); cab.className = "t-cab"
  const nombre = document.createElement("span"); nombre.className = "t-nombre"; nombre.textContent = llamada.herramienta
  const badge = document.createElement("span"); badge.className = "pill " + (llamada.ok ? "pill-ok" : "pill-err"); badge.textContent = llamada.ok ? "ok" : "error"
  cab.append(nombre, badge)
  const args = document.createElement("div"); args.className = "t-args"; args.append("Argumentos: ")
  const ca = document.createElement("code"); ca.textContent = argsLegibles(llamada.args); args.appendChild(ca)
  const res = document.createElement("div"); res.className = "t-res"; res.append("Resultado: ")
  const cr = document.createElement("code"); cr.textContent = llamada.resumen; res.appendChild(cr)
  d.append(cab, args, res)
  el.mensajes.appendChild(d)
  if (llamada.herramienta === "oc_validar") estado.ultimoValidar = llamada
  bajar()
}

// ---------- estado de la sesión ----------

function pintarEstado() {
  el.sId.textContent = estado.sessionId ? estado.sessionId.slice(0, 8) + "…" : "—"
  el.sId.title = estado.sessionId ?? ""
  let txt = "Lista", clase = "pill pill-ok"
  if (!estado.sessionId) { txt = "Sin iniciar"; clase = "pill pill-neutral" }
  if (estado.needsConfirmation) { txt = "Esperando tu confirmación"; clase = "pill pill-aviso" }
  if (estado.enviando) { txt = "Procesando…"; clase = "pill pill-neutral" }
  el.sEstado.textContent = txt; el.sEstado.className = clase
  el.sPendiente.textContent = estado.pendiente ? `${estado.pendiente.caso} (${estado.pendiente.solicitud_id})` : "Ninguno"
  el.sTokensTxt.textContent = estado.maxTokens ? `${estado.tokens.toLocaleString("es-CO")} / ${estado.maxTokens.toLocaleString("es-CO")}` : String(estado.tokens)
  el.sTokens.max = estado.maxTokens || 1
  el.sTokens.value = Math.min(estado.tokens, estado.maxTokens || 1)

  // El panel de confirmación existe SOLO si el backend reporta una confirmación pendiente ya presentada.
  const hayPanel = estado.needsConfirmation && estado.pendiente !== null
  const eraVisible = !el.confirmacion.hidden
  el.confirmacion.hidden = !hayPanel
  if (hayPanel && !eraVisible) requestAnimationFrame(bajar)
  if (hayPanel) {
    const extra = estado.ultimoValidar && estado.ultimoValidar.ok ? ` · ${estado.ultimoValidar.resumen}` : ""
    el.confDetalle.textContent = `Caso ${estado.pendiente.caso} (${estado.pendiente.solicitud_id})${extra}`
  }
  const bloquear = estado.enviando || !estado.iaLista || !estado.accesoOk
  el.btnEnviar.disabled = bloquear
  el.btnConfirmar.disabled = bloquear
  el.btnRechazar.disabled = bloquear
  el.texto.disabled = estado.enviando
  el.procesando.hidden = !estado.enviando
}

function aplicarEstadoServidor(d) {
  if (typeof d.needsConfirmation === "boolean") estado.needsConfirmation = d.needsConfirmation
  estado.pendiente = d.pendiente ?? null
  if (typeof d.tokens === "number") estado.tokens = d.tokens
}

// ---------- API ----------

async function api(ruta, opciones = {}, claveExplicita) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_CLIENTE_MS)
  try {
    // La clave de acceso viaja solo en la cabecera X-Access-Key (nunca en la URL ni en el cuerpo).
    const clave = claveExplicita ?? leerClave()
    const headers = { ...(opciones.headers ?? {}), ...(clave ? { "X-Access-Key": clave } : {}) }
    const r = await fetch(ruta, { ...opciones, headers, signal: ctrl.signal })
    let cuerpo = null
    try { cuerpo = await r.json() } catch { /* cuerpo no JSON */ }
    return { status: r.status, cuerpo }
  } finally { clearTimeout(t) }
}

async function cargarHealth() {
  try {
    const { cuerpo } = await api("/api/health")
    if (!cuerpo || cuerpo.ok !== true) throw new Error("health")
    const llm = cuerpo.llm
    estado.protegido = cuerpo.acceso === "protegido"
    el.avisoEfimero.hidden = cuerpo.persistencia !== "efimera"
    estado.iaLista = llm.configurado === true
    estado.maxTokens = cuerpo.limites.maxTokensSesion
    el.sModelo.textContent = `${llm.proveedor} · ${llm.modelo}`
    el.health.textContent = estado.iaLista ? "Servidor y IA listos" : "IA sin configurar"
    el.health.className = "pill " + (estado.iaLista ? "pill-ok" : "pill-err")
    el.avisoIa.hidden = estado.iaLista
    if (!estado.iaLista) el.avisoIa.textContent = `El agente de IA no está disponible: ${llm.motivo ?? "falta configuración en el servidor"}. Puedes revisar la interfaz, pero no enviar mensajes.`
  } catch {
    estado.iaLista = false
    el.health.textContent = "Servidor sin respuesta"; el.health.className = "pill pill-err"
    el.avisoIa.hidden = false; el.avisoIa.textContent = "No se pudo contactar con el servidor."
  }
  pintarEstado()
}

// ---------- acceso ----------

function pedirClave(mensaje) {
  guardarClave(null)
  estado.accesoOk = false
  el.accesoError.hidden = !mensaje
  el.accesoError.textContent = mensaje ?? ""
  el.clave.value = ""
  el.acceso.hidden = false
  pintarEstado()
  el.clave.focus()
}

/** Comprueba una clave contra el backend sin gastar tokens: 404 (sesión inexistente) = autorizada; 401 = inválida. */
async function validarClave(clave) {
  try {
    const { status } = await api("/api/sessions/acceso-prueba", {}, clave)
    if (status === 401) return "invalida"
    if (status === 429) return "limite"
    return status === 404 || status === 200 ? "ok" : "error"
  } catch { return "error" }
}

el.formAcceso.addEventListener("submit", async (e) => {
  e.preventDefault()
  const clave = el.clave.value.trim()
  if (!clave) return
  el.btnAcceso.disabled = true
  const r = await validarClave(clave)
  el.btnAcceso.disabled = false
  if (r === "ok") {
    guardarClave(clave); estado.accesoOk = true
    el.acceso.hidden = true; el.accesoError.hidden = true; el.clave.value = ""
    await restaurarSesion()
    if (estado.sessionId || el.mensajes.querySelector(".msg, .tool")) ocultarBienvenida()
    pintarEstado()
    return
  }
  el.clave.value = ""
  el.accesoError.hidden = false
  el.accesoError.textContent = r === "invalida" ? "Clave incorrecta." : r === "limite" ? "Demasiados intentos. Espera un momento." : "No se pudo verificar la clave. Inténtalo de nuevo."
  el.clave.focus()
})

async function restaurarSesion() {
  const id = leerAlmacen()
  if (!id) return
  try {
    const { status, cuerpo } = await api(`/api/sessions/${encodeURIComponent(id)}`)
    if (status === 401) { pedirClave("La clave de acceso ya no es válida."); return }
    if (status === 404 || !cuerpo || cuerpo.ok !== true) { guardarAlmacen(null); return }
    estado.sessionId = id
    for (const h of cuerpo.historial) {
      if (h.rol === "user") agregarMensaje("user", h.texto)
      else if (h.rol === "assistant") agregarMensaje("agente", h.texto)
      else if (h.rol === "tool") agregarTool({ herramienta: h.herramienta, args: h.args, ok: h.ok, resumen: h.resumen })
    }
    aplicarEstadoServidor(cuerpo)
    if (cuerpo.limites) estado.maxTokens = cuerpo.limites.maxTokensSesion
    const ultimos = el.mensajes.querySelectorAll(".msg-agente")
    if (estado.needsConfirmation && ultimos.length) ultimos[ultimos.length - 1].classList.add("pide-confirmacion")
  } catch { /* sin sesión previa recuperable */ }
}

async function enviar(texto) {
  const mensaje = texto.trim()
  if (!mensaje || estado.enviando || !estado.iaLista || !estado.accesoOk) return
  agregarMensaje("user", mensaje)
  estado.enviando = true; pintarEstado()
  try {
    // El cuerpo contiene SOLO sessionId y message. Nada más viaja al backend.
    const cuerpoEnvio = estado.sessionId ? { sessionId: estado.sessionId, message: mensaje } : { message: mensaje }
    const { status, cuerpo } = await api("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpoEnvio) })
    if (status === 401) { agregarError("La clave de acceso no es válida o expiró. Ingrésala de nuevo."); pedirClave(); return }
    if (!cuerpo) { agregarError(`El servidor respondió con un error inesperado (HTTP ${status}).`); return }
    if (cuerpo.sessionId) { estado.sessionId = cuerpo.sessionId; guardarAlmacen(cuerpo.sessionId) }
    for (const t of cuerpo.toolCalls ?? []) agregarTool(t)
    if (cuerpo.reply) {
      if (cuerpo.ok === false || status >= 400) agregarError(cuerpo.reply)
      else agregarMensaje("agente", cuerpo.reply, { pideConfirmacion: cuerpo.needsConfirmation === true })
    } else if (cuerpo.error) {
      agregarError(cuerpo.error)
    }
    aplicarEstadoServidor(cuerpo)
  } catch (e) {
    agregarError(e && e.name === "AbortError" ? "La solicitud tardó demasiado. Inténtalo de nuevo." : "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.")
  } finally {
    estado.enviando = false; pintarEstado(); if (!el.texto.disabled) el.texto.focus()
  }
}

// ---------- eventos ----------

function ajustarAltura() { el.texto.style.height = "auto"; el.texto.style.height = Math.min(el.texto.scrollHeight, 140) + "px" }

el.form.addEventListener("submit", (e) => {
  e.preventDefault()
  const t = el.texto.value
  el.texto.value = ""; ajustarAltura()
  void enviar(t)
})
el.texto.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.form.requestSubmit() }
})
el.texto.addEventListener("input", ajustarAltura)
el.btnConfirmar.addEventListener("click", () => void enviar(FRASE_CONFIRMAR))
el.btnRechazar.addEventListener("click", () => void enviar(FRASE_RECHAZAR))
el.btnNueva.addEventListener("click", () => {
  if (estado.enviando) return
  guardarAlmacen(null)
  estado.sessionId = null; estado.needsConfirmation = false; estado.pendiente = null; estado.tokens = 0; estado.ultimoValidar = null
  el.mensajes.querySelectorAll(".msg, .tool").forEach((n) => n.remove())
  el.bienvenida.hidden = false
  pintarEstado()
})

for (const caso of CASOS) {
  const b = document.createElement("button")
  b.type = "button"; b.className = "chip"; b.textContent = `Procesar ${caso}`
  b.addEventListener("click", () => void enviar(`Procesa la solicitud ${caso}. Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.`))
  el.chips.appendChild(b)
}

async function iniciar() {
  pintarEstado()
  await cargarHealth()
  if (estado.protegido) {
    const guardada = leerClave()
    if (guardada && (await validarClave(guardada)) === "ok") estado.accesoOk = true
    else { pedirClave(guardada ? "La clave guardada ya no es válida." : undefined); return }
  }
  await restaurarSesion()
  if (estado.sessionId || el.mensajes.querySelector(".msg, .tool")) ocultarBienvenida()
  pintarEstado()
}
void iniciar()
