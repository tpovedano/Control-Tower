# Procore Control Tower

Torre de control para **estandarizar y gobernar la configuración de múltiples companies de Procore** desde un único lugar:

| Objeto | Leer / gobernar | Crear / actualizar |
|---|---|---|
| Custom Fields | ✅ | ✅ |
| Custom Field LOV Entries | ✅ | ✅ (solo crear, ver limitaciones) |
| Field Sets (configurable field sets) | ✅ | ✅ |
| Inspection Types (company) | ✅ | ✅ |
| Company Observation Types | ✅ | ❌ solo lectura (ver limitaciones) |

La llave de correspondencia entre instancias es el **ID estándar entre corchetes al final del nombre**: `Fecha de inspección [QE-CF-001]` ≡ `Inspection date [QE-CF-001]`. Se compara **siempre por `[ID]`**, nunca por el texto ni el idioma.

**Naming convention.** El `[ID]` empieza por el código de la disciplina:

| Código | Disciplina |
|---|---|
| `QE` | Calidad y Medioambiente |
| `HS` | Seguridad y Salud |
| `DE` | Oficina Técnica |

En **Cargar** cada tipo tiene una columna *Disciplina* (desplegable, última columna): si el `[ID]` no lleva el código, se antepone automáticamente (`Fecha [CF-001]` + `QE` → `Fecha [QE-CF-001]`); si lleva otro distinto, la fila da error. Las opciones de LOV no llevan disciplina (la lleva su custom field padre). Los elementos que ya existen en Procore con el formato antiguo (`[CF-001] Nombre`) se siguen reconociendo por su `[ID]`; para migrarlos al formato nuevo, carga el lote de cada instancia (con el texto en su idioma) activando *Sobrescribir también textos*. Las disciplinas se configuran en `lib/naming.ts`.

Stack: Next.js 15 (App Router) + TypeScript · Tailwind (componentes estilo shadcn/ui) · Drizzle ORM sobre Vercel Postgres (Neon) · Zod · TanStack Table + Virtual · Vitest.

---

## Contenido

1. [Crear la base de datos en Vercel](#1-crear-la-base-de-datos-en-vercel)
2. [Variables de entorno](#2-variables-de-entorno)
3. [Redirect URI en el Developer Portal de Procore](#3-redirect-uri-en-el-developer-portal-de-procore)
4. [Desplegar](#4-desplegar)
5. [Guía de uso con un lote de prueba](#5-guía-de-uso-con-un-lote-de-prueba)
6. [Limitaciones y pendientes conocidos](#6-limitaciones-y-pendientes-conocidos)
7. [Arquitectura y decisiones](#7-arquitectura-y-decisiones)
8. [Desarrollo local y tests](#8-desarrollo-local-y-tests)

---

## 1. Crear la base de datos en Vercel

1. En el proyecto de Vercel: **Storage → Create Database → Neon (Postgres)** (lo que antes era “Vercel Postgres”) y conéctala al proyecto. Vercel añade `POSTGRES_URL` (y otras) a las variables de entorno automáticamente.
2. Las tablas se crean solas: el script `vercel-build` ejecuta las migraciones (`lib/db/migrations`) antes de `next build` en cada despliegue. Son idempotentes.
3. Si prefieres hacerlo a mano (o en local):
   ```bash
   vercel env pull .env.local   # trae POSTGRES_URL
   npm run db:migrate
   ```

Tablas: `instances` (conexiones; secretos y tokens cifrados), `snapshots` (lecturas por instancia/tipo), `catalog_items` (catálogo maestro), `runs` / `run_items` (dry-run y ejecuciones), `audit_log` (historial).

> Cualquier otro Postgres también funciona: si la URL no es de Neon se usa el driver `postgres-js` (forzable con `DB_DRIVER=neon|postgres`).

## 2. Variables de entorno

Copia `.env.example` a `.env.local` (local) o defínelas en **Vercel → Settings → Environment Variables**.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `PROCORE_CLIENT_ID` | ✅* | Client ID de **producción** (Developer Portal → tu app → *Production OAuth Credentials*). |
| `PROCORE_CLIENT_SECRET` | ✅* | Client Secret de producción. |
| `PROCORE_SANDBOX_CLIENT_ID` | ✅* | Client ID de **sandbox** (*Sandbox OAuth Credentials*). Es distinto del de producción. |
| `PROCORE_SANDBOX_CLIENT_SECRET` | ✅* | Client Secret de sandbox. |

\* Basta con el par del entorno que uses (instancias marcadas Producción o Sandbox). Usar el par de un entorno contra el otro produce en Procore *“Client authentication failed due to unknown client…”*.
| `PROCORE_BASE_URL` | – | API de producción. Por defecto `https://api.procore.com`. |
| `PROCORE_LOGIN_URL` | – | Login/OAuth de producción. Por defecto `https://login.procore.com`. |
| `PROCORE_SANDBOX_BASE_URL` | – | API sandbox (instancias marcadas “Sandbox”). Por defecto `https://sandbox.procore.com`. |
| `PROCORE_SANDBOX_LOGIN_URL` | – | Login sandbox. Por defecto `https://login-sandbox.procore.com`. |
| `POSTGRES_URL` | ✅ | La crea Vercel al conectar Neon. |
| `ENCRYPTION_KEY` | ✅ | 32 bytes en base64 o 64 hex. `openssl rand -base64 32`. Cifra secrets/tokens (AES-256-GCM). **No la cambies** después de guardar instancias (no podrían descifrarse). |
| `SESSION_SECRET` | – | Firma de la cookie de sesión. Si falta se deriva de `ENCRYPTION_KEY`. |
| `APP_ACCESS_PASSWORD` | ✅ | Contraseña de acceso a la app. Sin ella nadie puede entrar. |
| `APP_ALLOWED_USERS` | – | Lista blanca de correos separados por coma. Si se define, el login exige uno de ellos y queda registrado en el historial. |
| `NEXT_PUBLIC_APP_URL` | ✅ | URL pública, p. ej. `https://control-tower.vercel.app`. Se usa para el Redirect URI. |
| `MAX_ROWS_PER_BATCH` | – | Límite de filas por lote en “Cargar” (500). |
| `PROCORE_MAX_CONCURRENCY` | – | Peticiones simultáneas por instancia (3). |
| `DB_DRIVER` | – | `neon` o `postgres` para forzar el driver de BD. |
| `PROCORE_EMBED_ORIGINS` | – | Orígenes que pueden mostrar la app en un iframe. Por defecto `https://*.procore.com https://procore.com`. Se aplica en el build (redeploy al cambiarla). |

Credencial por instancia (opcional): en la pestaña Instancias se puede guardar un Client ID/Secret propio para una company (p. ej. una DMSA distinta). Si se deja vacío se usan las variables globales.

## 3. Redirect URI en el Developer Portal de Procore

Solo necesario si alguna instancia usa **Authorization Code** (autorización con un usuario):

1. developers.procore.com → *My Apps* → tu app → *Configuration* / *OAuth Credentials*.
2. En **Redirect URI** añade: `https://<tu-dominio>/api/auth/procore/callback`
   (en local: `http://localhost:3000/api/auth/procore/callback`). Debe coincidir exactamente con `NEXT_PUBLIC_APP_URL` + `/api/auth/procore/callback`.
3. Para **Client Credentials (DMSA)** no hace falta Redirect URI, pero la service account debe estar **instalada en cada company** (Company Admin → App Management) con permisos de Admin en *Company Admin*/*Custom Fields*, *Inspections* y *Observations*. “Probar conexión” muestra qué permisos faltan.

### 3.1 Mostrar la app incrustada en Procore (full screen)

1. Developer Portal → tu app → **Configuration Builder** → añade un componente **Embedded / Full Screen** a nivel company, con URL `https://<tu-dominio>/` (la app redirige a su login y después a Cargar). Crea/promueve la versión del manifiesto.
2. En cada company: **Company Admin → App Management** → instala o actualiza la app a esa versión. Aparecerá en el menú de herramientas/Apps de la company.
3. En Vercel → Settings → **Deployment Protection**, desactiva *Vercel Authentication* para producción: su pantalla de login (`vercel.com`) nunca se deja incrustar y Procore mostraría “vercel.com rechazó la conexión”. La app ya está protegida por su propia contraseña.

Cómo funciona: la app envía `Content-Security-Policy: frame-ancestors 'self' https://*.procore.com …` (solo Procore puede incrustarla) y en producción la cookie de sesión es `SameSite=None; Secure; Partitioned`, necesaria para funcionar dentro de un iframe de otro sitio. Si el navegador bloquea igualmente las cookies de terceros (Safari, o Chrome con el bloqueo estricto), el login lo detecta y ofrece **abrir Control Tower en una pestaña nueva**; dentro de Procore también hay un botón ↗ en la barra superior para lo mismo. **Autorizar con Procore** (Authorization Code) siempre se abre en una pestaña nueva, porque el login de Procore no se puede mostrar dentro de un iframe; al terminar, la tarjeta de la instancia se actualiza sola.

## 4. Desplegar

```bash
npm i -g vercel
vercel link            # o importa el repo desde vercel.com/new
vercel env add ...     # o desde el dashboard (ver tabla anterior)
vercel --prod
```

No requiere configuración especial: Vercel detecta Next.js, ejecuta `vercel-build` (migraciones + build). Los Route Handlers largos declaran `maxDuration` (60–300 s; según tu plan de Vercel el máximo efectivo puede ser menor, por eso todo se trocea en llamadas cortas — ver §7).

## 5. Guía de uso con un lote de prueba

**Paso 0 — Instancias.** Pestaña **Instancias → Añadir instancia**: etiqueta, `company_id`, idioma, entorno y método de autenticación. Pulsa **Probar conexión** (valida token, que la company sea visible y el acceso de lectura a cada herramienta). Si usas Authorization Code, pulsa **Autorizar con Procore**. Marca con ★ la instancia de referencia (golden).

**Paso 1 — Gobierno.** Pulsa **Sincronizar / Leer instancias**. Verás la matriz `[ID] × instancia`:
✅ alineado · ➕ falta · ⚠️ difiere (tipo de dato, variante, activo, opciones LOV, composición del field set…) · ⛔ conflicto (ID repetido en una instancia o de naturaleza distinta) · 🔇 sin `[ID]`.
Haz clic en una fila para ver la comparación lado a lado.

**Paso 2 — Cargar.** Elige **Custom Fields** y pega desde Excel (con o sin cabecera) estas 10 filas:

```
Nombre con [ID]	Tipo de dato	Variante	Descripción	Valor por defecto	Activo	Disciplina
Fecha de inspección [QE-CF-001]	datetime				Sí	QE
Estado de calidad [QE-CF-002]	lov_entry				Sí	QE
Responsable [QE-CF-003]	usuario				Sí	QE
Importe estimado [DE-CF-004]	decimal	currency	Importe en moneda local		Sí	DE
Requiere reinspección [QE-CF-005]	boolean				Sí	QE
Observaciones [QE-CF-006]	texto largo				Sí	QE
Zona [HS-CF-007]	string		Zona de obra		Sí	HS
Disciplinas [DE-CF-008]	selección múltiple				Sí	DE
Fecha de cierre [QE-CF-009]	datetime				Sí	QE
Campo obsoleto [CF-010]	string				No	DE
```

(Tipos de dato válidos según Procore: `string`, `decimal`, `boolean`, `lov_entry`, `lov_entries`, `datetime`, `rich_text`, `login_information`, `login_informations`, `vendor`, `location`, `prostore_files`; variantes: `currency`, `project_directory`, `radio_button`, `read_only` (dependen del tipo). Se aceptan alias en español: *texto, texto largo, número, fecha, lista desplegable, selección múltiple, usuario, empresa, archivos…*; y para la variante *moneda, solo lectura…*. La validación es fila a fila (✅/⚠️/❌): `[ID]` presente y válido, duplicados del lote, obligatorios, tipo de dato/variante contra los metadatos reales de Procore y dependencias.)

Elige las instancias destino → **Revisar (dry-run)**: por instancia y fila verás `CREAR`, `ACTUALIZAR`, `SIN CAMBIOS` u `OMITIR`, con totales. **Ejecutar** pide confirmación explícita (“Se crearán N… en M instancias”). Al terminar: resultado por fila e instancia, **Reintentar solo los fallidos** y **Descargar reporte CSV**. Vuelve a lanzar el mismo lote: todo saldrá `SIN CAMBIOS` (idempotente).

Después, opciones de la lista (**LOV Entries**):
```
[QE-CF-002]	Conforme [OK]
[QE-CF-002]	No conforme [NOK]
[QE-CF-002]	No aplica [NA]
```
y un **Field Set**:
```
Inspección de calidad [QE-FS-001]	Observations::Item | quality	[QE-CF-001];[QE-CF-002];[HS-CF-007]	General	QE
```
(*Clase/Herramienta* es un desplegable con los `class_name` que admite Procore — `Observations::Item` con su categoría (Calidad `quality`, Seguridad `safety`, Puesta en marcha `commissioning`, Garantía `warranty`, Trabajo pendiente `work_to_complete`), `PunchItem` (Punch List) y `Rfi::Header` (RFI) —, con formato `class_name | categoría` e indicando en cuántas instancias hay plantilla; también se puede pegar así desde Excel y se aceptan alias como *Observaciones*, *Punch* o *RFI*; *Custom fields incluidos* es una selección múltiple de los custom fields sincronizados. *Secciones*: vacío = “General”; `Sección A: [QE-CF-001] | Sección B: [QE-CF-002]` para varias.)

**Paso 3 — Remediar.** En Gobierno, selecciona filas (o abre una) y usa **Crear donde falta** o **Alinear atributos**: abre el mismo dry-run + confirmación con la definición de referencia (catálogo maestro → instancia ★ → consenso).

**Paso 4 — Historial.** Toda escritura, prueba de conexión, sincronización fallida y cambio de instancia queda registrada: fecha, usuario, instancia, tipo, `[ID]`, acción, resultado, payload enviado (sin secretos) y respuesta de Procore. Filtrable y exportable a CSV.

Plantillas CSV por tipo: botón **Plantilla CSV** en Cargar.

## 6. Limitaciones y pendientes conocidos

**Diferencias detectadas frente al enunciado (gana la documentación oficial):**

1. **Company Observation Types — solo lectura.** La referencia de la API publica `GET /rest/v1.0/companies/{company_id}/observation_types` pero **no** un `POST`/`PATCH` a nivel company; la escritura existe únicamente a nivel proyecto (`/rest/v1.0/projects/{project_id}/observation_types`). No se ha inventado ningún endpoint: el tipo se lee, se gobierna en la matriz y en Cargar el dry-run muestra lo que falta, pero todo queda como `OMITIR`. **Pendiente:** si Procore publica la escritura a nivel company, basta con implementar `apply` en `lib/adapters/server/observation-types.ts`; la creación por proyecto podría añadirse como opción (requiere elegir proyectos por instancia).
2. **Tipos de dato de custom fields.** `custom_field_metadata` describe la *ubicación* de un campo dentro de un field set, no el catálogo de tipos. Para los selectores y la validación se usa `GET /rest/v2.0/companies/{company_id}/custom_field/data_types`. Si no responde, se valida contra una lista conocida (como advertencia).
3. **LOV entries: no hay PATCH.** La API solo permite crear (`bulk_create`) y listar. Por eso las opciones se comparan por `[ID]` y solo se pueden **crear**; renombrar, reordenar o reactivar una opción inactiva se marca como `OMITIR` con explicación.
4. **Orden de LOV.** `bulk_create` ordena la posición de forma descendente: la app envía las opciones en orden inverso y verifica el resultado. Las opciones nuevas quedan por encima de las existentes; si el orden no coincide se avisa en el resultado.
5. **`label` obligatorio en el PATCH de custom fields.** Se reenvía el nombre local actual para no cambiar el idioma (salvo que se active “Sobrescribir también textos”).
6. **`data_type` no se cambia.** Si un `[ID]` existe con otro tipo de dato se marca como conflicto (`OMITIR`); requiere intervención manual.
7. **Field Sets.** Cuerpo según el contrato de `POST /rest/v2.1/companies/{id}/configurable_field_sets`: `name`, `class_name` (`Observations::Item`, `PunchItem` o `Rfi::Header`), `fields` y, en Observaciones, `category` (`quality`, `safety`, `commissioning`, `warranty`, `work_to_complete`). `fields` (la configuración de campos, cuyo esquema depende de la herramienta) se copia de un field set de la misma herramienta en la instancia destino —preferentemente de la misma categoría y el *company default*—; si la instancia no tiene ninguno, se toma de esa herramienta en otra instancia sincronizada. Los ids locales de ámbito (`observations_category_id`…) solo se copian si la plantilla es de la misma categoría. Si no hay ningún field set de esa herramienta en ninguna instancia, el dry-run lo marca como `OMITIR` con la explicación. Los `custom_field_sections` se envían con IDs numéricos resueltos por instancia a partir del `[ID]`; si falta un custom field en el destino, queda **bloqueado por dependencia**.

**Pendientes / por validar:**

- **Probar contra el sandbox de Procore.** Desde el entorno de desarrollo no hubo acceso a developers.procore.com ni credenciales de sandbox: los contratos se verificaron contra la referencia OpenAPI de Procore y todo se probó con tests unitarios y un **servidor Procore simulado** (`npm run mock:procore`). Los formatos de respuesta se parsean de forma defensiva, pero conviene una primera ejecución en sandbox, sobre todo para Field Sets (forma exacta de `fields`/`custom_field_sections` en la respuesta v2.1).
- **Borrado:** v1 no incluye ninguna operación DELETE en Procore. Para retirar algo se usa `active: false` (custom fields). Un borrado futuro requeriría doble confirmación y quedaría en el historial.
- **Asignación de field sets a proyectos** (`/configurable_field_sets/{id}/projects`) y **sections por herramienta**: fase 2, no implementado.
- **Autenticación de la app:** contraseña de entorno + lista blanca opcional de correos. Para SSO/usuarios individuales con contraseña propia, migrar a Auth.js.
- **Remediación entre idiomas:** “Crear donde falta” crea el elemento con el nombre de la referencia (su idioma); luego puede renombrarse en Procore manteniendo el `[ID]`.
- La lectura de LOV hace una llamada por custom field de tipo lista; en companies con cientos de listas la sincronización tarda más (limitada a 3 peticiones simultáneas por instancia).

## 7. Arquitectura y decisiones

```
app/
  (app)/cargar | gobierno | instancias | historial   → pestañas (UI)
  api/instancias, sync, gobierno, plan, execute, runs, historial, catalog, auth/procore/{start,callback}
lib/
  procore/   client.ts (OAuth, reintentos 429 con Retry-After, backoff, 401→renovar, paginación, concurrencia)
             endpoints.ts (TODOS los paths y versiones), oauth.ts, errors.ts (401/403/404/422/429/5xx legibles)
  adapters/  specs/*      → parte "client-safe": columnas, parseo y validación de filas por tipo
             server/*     → list / normalize / plan / apply por tipo (misma interfaz ServerAdapter)
  ids/       parseo y normalización de [ID] al final del nombre (regex ^(.*?)\s*\[([^\]]+)\]\s*$, trim + mayúsculas;
             reconoce también el formato antiguo "[ID] Nombre")
  naming.ts  naming convention: disciplinas QE / HS / DE
  diff/      plan.ts (CREAR/ACTUALIZAR/SIN CAMBIOS/OMITIR) y matrix.ts (matriz de alineación)
  db/        schema Drizzle + migraciones
  crypto/    AES-256-GCM
  services/  instancias/tokens, motor de ejecución, gobierno, audit
components/  cuadrícula de pegado, matriz virtualizada, flujo dry-run/ejecución, badges, diálogos
tests/       Vitest
scripts/     migrate.ts, mock-procore.ts
```

**Añadir un tipo de objeto** = crear `lib/adapters/specs/<tipo>.ts` (columnas + `parseRow`) y `lib/adapters/server/<tipo>.ts` (`list`, `normalize`, `plan`, `apply`, `toDesired`) y registrarlos en los dos `index.ts`.

**Ejecuciones largas en Vercel (decisión).** El navegador orquesta muchas llamadas cortas a Route Handlers, sin colas ni workers:
- *Sincronizar*: una llamada por instancia × tipo (`POST /api/sync`).
- *Dry-run*: `POST /api/plan` crea la ejecución (el servidor re-valida las filas; nunca confía en el cliente) y `POST /api/plan/{runId}` calcula el plan de **una** instancia leyendo su estado en vivo.
- *Ejecutar*: `POST /api/runs/{id}/confirm` (exige que el nº de escrituras coincida con el dry-run mostrado) y después `POST /api/execute` en tandas de ≤10 elementos por instancia (las opciones LOV se agrupan por custom field padre). 2 instancias en paralelo.
- Antes de escribir cada tanda, el servidor **vuelve a leer** la instancia y **re-planifica** cada elemento: si ya existe, se marca “sin cambios”. Esto hace la ejecución **idempotente** y segura ante reintentos, cortes o pestañas cerradas (el estado queda en `run_items`).
- Solo se ejecuta lo que pasó por dry-run: `execute` carga las filas deseadas de la BD, no del navegador.

**Seguridad.** Todas las llamadas a Procore ocurren en el servidor. Secrets y tokens se guardan cifrados (AES-256-GCM) y nunca se envían al navegador ni se registran. El token se cachea por instancia (memoria + BD cifrada) hasta 60 s antes de expirar; refresh tokens rotados se persisten. Middleware que exige sesión en todas las páginas y APIs (cookie `httpOnly` firmada con HMAC). El historial elimina cualquier clave con aspecto de secreto. Límite de filas por lote, validación Zod en todas las entradas y sin operaciones de borrado.

**Comparación.** Por `[ID]`, ignorando nombre/idioma. Atributos estructurales: custom fields → `data_type`, `variant`, `active` y conjunto de `[ID]` de opciones LOV; LOV → `active`; field sets → `class_name` y conjunto de `[ID]` de custom fields; inspection types → `grouping`; observation types → `category`, `active`. Las LOV se identifican como `[ID padre]/[ID opción]` (el mismo ID de opción puede repetirse en listas distintas). La referencia para el % de alineación es el catálogo maestro, si no la instancia ★, si no el consenso (valor más frecuente).

## 8. Desarrollo local y tests

```bash
npm install
cp .env.example .env.local     # completa los valores
npm run db:migrate
npm run dev                    # http://localhost:3000
npm test                       # Vitest: parser, [ID], motor de plan/matriz, cliente Procore y adaptadores con mocks
npm run typecheck && npm run lint
```

**Sin credenciales de Procore:** `npm run mock:procore` levanta un Procore simulado en `http://localhost:4010` con dos companies (`1001` en español y `1002` en inglés) y datos de ejemplo. Pon `PROCORE_BASE_URL` y `PROCORE_LOGIN_URL` (y las de sandbox) a `http://localhost:4010` y cualquier `PROCORE_CLIENT_ID/SECRET`. `MOCK_429=1` inyecta respuestas 429 periódicas para probar los reintentos.
