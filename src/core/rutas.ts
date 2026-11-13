/** Resolución de rutas. Todo cuelga de `directory` (raíz del proyecto); nunca rutas absolutas externas. */
export const rutaFixtures = (directory: string): string => `${directory}/fixtures/reto-03`
export const rutaCaso = (directory: string, caso: string): string =>
  `${rutaFixtures(directory)}/solicitudes/${caso}`

const CASO_VALIDO = /^[A-Za-z0-9_-]{1,64}$/
/** Evita path traversal: el caso es solo el nombre de la carpeta. */
export const casoValido = (caso: string): boolean => CASO_VALIDO.test(caso)
