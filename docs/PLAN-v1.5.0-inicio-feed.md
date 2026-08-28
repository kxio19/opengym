# v1.5.0 — Inicio al estilo Hevy

> [!archived] Cerrado y archivado — 29 ago 2026
> Esta versión está en producción y verificada de forma independiente (frontend 211/211,
> API 75/75 en Linux/ARM64 sobre la propia Pi, `npm audit` a cero en ambos paquetes,
> backup posterior restaurado). Este documento deja de actualizarse como plan vivo; el
> estado de producción vive ahora en la bóveda — [[OpenGym - MOC]] y
> [[OpenGym - Roadmap y Estado]]. Se conserva aquí como historial de las decisiones y
> trampas de diseño de esta versión, siguiendo la regla 5 de este mismo documento.

Documento vivo del avance mientras estuvo en marcha. **Se actualizaba en el mismo commit que
el código que describe**, nunca al final del día, para que `git log` y esta lista no pudieran
contradecirse.

## Estado final — 29 ago 2026

    Último commit: 129ae8d (hotfix móvil, cierra v1.5.1)
    En curso:  nada — versión cerrada
    Desplegado: 1.5.1-129ae8d en gym.kaiohub.dev, contenedores sanos, 2 perfiles conservados
    Pendiente: prueba real con dos cuentas (foto, comentarios, rankings/retos) — ver Roadmap

Cadena de commits de esta versión: `13923e3` (Inicio, tarjeta y detalle) → `5f37627` (cierre
funcional: fotos, alta obligatoria, traslados) → `6eedba3` (corrección del proxy de fotos
privadas) → `129ae8d` (hoja de fin de entrenamiento desplazable en móvil, sube la versión a
1.5.1). Los tres commits anteriores a este plan (`1456d2e`, `badbc75`, `ddf83c0`) se desplegaron
en el mismo ciclo.

---

## Qué se está construyendo

Las publicaciones del grupo viven hoy en una página aparte (`/social`) a la que solo se llega
tocando una tarjeta en Inicio, y nadie entra. Pasan a la pantalla de Inicio, justo debajo de la
semana, con scroll infinito y con título, descripción y foto, al estilo de Hevy.

---

## Decisiones ya tomadas

No hay que volver a abrirlas. Están acordadas con Kaio y algunas tienen un porqué que no es obvio.

| # | Decisión | Por qué |
|---|---|---|
| 1 | El feed va en Inicio, justo bajo la tarjeta de la semana, con scroll infinito | Escondido en `/social` no lo veía nadie |
| 2 | El peso corporal se reduce a una línea dentro de la tarjeta de la semana; la gráfica se va a Stats | Deja sitio al feed sin perder el registro rápido |
| 3 | Fuera la racha de semanas. En la cabecera, 🔥 con días consecutivos cumpliendo el plan | Un número diario motiva más que uno semanal |
| 4 | Un día cumple si el plan decía descanso, o si decía entrenar y entrenaste. Hoy no rompe la racha hasta que acabe | Reprogramar sale gratis: `effectiveRoutineId` ya resuelve los `dayPlan` |
| 5 | Una foto por publicación, reescalada en el navegador a 1080 px / calidad 0.8 | Sin reescalado, subir desde el móvil son varios MB por foto |
| 6 | Las fotos se guardan dentro de `DATA`, así que entran en el backup diario | ~20 MB al año con un par de fotos por semana |
| 7 | Se mantienen los interruptores de privacidad por campo, activos por defecto | No se tira una función que ya funciona, pero el feed se ve completo desde el primer día |
| 8 | En la primera publicación se ofrece recordar la configuración (`askFields`) | Después de aceptarla, los interruptores no vuelven a aparecer; se cambia en Ajustes |
| 9 | El detalle de una publicación va en pantalla propia (`/post/:id`) | El botón atrás del móvil funciona y el enlace se puede compartir |
| 10 | La página `/social` desaparece: rankings y retos a Stats, preferencias a Ajustes | No tener lo mismo en dos sitios |
| 11 | Social pasa a ser obligatorio, con un check al crear el perfil | Kaio confirma que sus amigos están informados y de acuerdo |
| 12 | Se conserva la regla de que el historial antiguo y lo importado nunca se publican | Ver trampa B |
| 13 | «Desactivar y borrar Social» pasa a ser «Borrar mis publicaciones» | Si Social es obligatorio no hay de qué darse de baja, pero se conserva el control sobre lo publicado |

### Trampa A — el título, la descripción y la foto van en el ENTRENAMIENTO

Las publicaciones no se escriben: `syncUserState` (`api/social/service.js`) las **regenera** desde
el estado del usuario en cada sincronización. Cualquier cosa guardada solo en el post se borra en
el siguiente sync. Por eso viven en `workout.social` y `workoutSnapshot` las copia hacia la
publicación.

    workout.social = { eligible, publish, fields, title, desc, photoId }

### Trampa B — `enabledAt` se pone al dar de alta, jamás en el pasado

`eligible()` exige que el entrenamiento sea posterior a `profile.enabledAt`. Al activar Social
automáticamente, si `enabledAt` se rellenara con la fecha de creación de la cuenta, el primer sync
publicaría el historial entero de todos, incluido lo importado de Hevy. Se pone **el momento del
alta automática**. `origin === 'tracked'` sigue excluyendo las importaciones y no se toca.

---

## Tareas

Estado: `[ ]` pendiente · `[~]` en curso · `[x]` hecha (con el commit que la cierra).

### Backend
- [x] `POST /api/social/photo` — cuerpo binario, solo miembros, tope 1 MB, tipo validado por los bytes de cabecera
- [x] `GET /api/social/photo/:id` — exige sesión y pertenencia al grupo
- [x] `GET /api/social/post?id=` — una publicación con todos sus comentarios
- [x] `workoutSnapshot`: añadir `title`, `desc`, `photoId`
- [x] `syncUserState`: borrar del disco la foto de una publicación que deja de existir
- [x] `defaultSocialProfile`: `enabled: true`; `requireMember` se mantiene
- [x] `PUT /api/social/me` con `purge`: borra publicaciones, no da de baja
- [x] Alta: exigir `termsAccepted`, guardar `termsAcceptedAt`

### Racha
- [x] `planStreak(S)` en `frontend/src/lib/history.js` — sustituye a `streakWeeks` (borrado, sin usos fuera de Home/Stats)
- [x] Pruebas de `planStreak` (4 casos: sin plan, descanso+corte, hoy incompleto no rompe, reprogramación)
- [x] `views/Stats.jsx` migrado a `planStreak` (antes mostraba "Week streak" con `streakWeeks`; unificado con el nuevo concepto)

### Inicio
- [x] Cabecera con 🔥 (abre el calendario) — se oculta si la racha es 0 (sin plan aún)
- [x] Línea compacta de peso dentro de la tarjeta de la semana, sin gráfica (la gráfica ya
      vivía en Stats desde antes — no hizo falta tocar Stats para esa parte)
- [x] Feed con scroll infinito (`IntersectionObserver` + cursor `before`)
- [x] Quitar de Inicio: `SocialPreview`, tarjeta de peso grande, tarjeta de racha semanal
- [x] La tarjeta de bienvenida **no se tocó**: su condición ya era la pedida
- [x] `views/Stats.jsx` weight card (ya existía) sin tocar; solo se migró su tile de racha a `planStreak`

### Tarjeta y detalle
- [x] `components/PostCard.jsx` con carrusel de dos páginas (`scroll-snap`, sin librerías)
- [x] Sin foto, la primera página es el `BodyMap` con las cifras
- [x] `views/Post.jsx` en la ruta `/post/:id`, cableada en `App.jsx` y `TabBar.jsx`
- [x] `GET /api/social/post` — detalle autenticado con comentarios, apoyos y estado propio.

### Fin de entrenamiento
- [x] Título (precargado con el nombre de la rutina), descripción y foto
- [x] Reescalado con `canvas` antes de subir
- [x] «¿Usar esta configuración para las próximas?» → `askFields`

### Traslados
- [x] `Rankings` y `Challenges` → `views/Stats.jsx`
- [x] `ProfileSetup` → sección de `views/Settings.jsx`, con «Borrar mis publicaciones»
- [x] Borrar `views/Social.jsx` y la ruta `/social`; revisar los enlaces `#/social` de las push
- [x] Check obligatorio en el alta de perfil

### Idioma y cierre
- [x] Traducir las cadenas nuevas en `frontend/src/locales/es.js`
- [x] La auditoría de `t()` contra `es.js` vuelve a dar cero
- [x] Subir versión a 1.5.0, y a 1.5.1 tras el hotfix móvil; actualizar el README

### Hotfix móvil (post-cierre, commit `129ae8d`)
- [x] `FinishSummary` pasa de diálogo centrado a hoja inferior desplazable (`kind: center` no
      tenía `max-height` ni `overflow`; con foto, privacidad y publicación ya no cabía)
- [x] Foto limitada a `min(220px, 28dvh)` con `object-fit: cover`
- [x] Botón renombrado a «Publicar entrenamiento», siempre alcanzable con scroll
- [x] Verificado a 390×844 px con foto real contra una instancia local aislada

---

## Gotchas encontrados sobre la marcha

Se anotan aquí en el momento de descubrirlos, no después.

- `planStreak` lee el plan a través de `S.week`/`S.dayPlan`, que no tienen historial de versiones. Editar el horario semanal reinterpreta retroactivamente los días pasados bajo el horario nuevo — la racha puede subir o bajar sola tras un cambio de plan. Aceptado como límite conocido, no como bug.
- **El mapa muscular de una publicación necesita un recuento de series por ejercicio, no solo el nombre.** `loadOf` (mapa muscular) solo necesita un *recuento* de series por ejercicio, nunca pesos ni reps — pero con la privacidad por defecto (`exerciseNames: true, exactSets: false`) el snapshot de hoy solo manda `{id, name}` por ejercicio, sin ningún recuento. `PostCard`/`Post` ya están escritos para leer `entry.setCount` (con `entry.sets.length` como alternativa si se compartieron los pesos exactos), pero **el backend todavía no lo rellena** — hasta el siguiente trozo, el mapa muscular sale vacío en publicaciones con la privacidad por defecto. Añadir `setCount` es privacy-neutral (es un recuento, no un peso) y va en el trozo de backend.
- `.social-avatar` pintaba el color del **espectador**, no el del autor: la regla usa `background:var(--acc)` (el acento del propio tema) y el `data-accent={post.accent}` que ya existía en el código no tenía ninguna regla CSS que lo leyera — inerte desde que se escribió. Corregido en `PostCard`/`Post` con un `style` inline usando `ACCENTS[post.accent]`, igual que ya hacen los selectores de color de Ajustes. Antes de este cambio, todos los avatares del feed se veían del mismo color sin importar quién publicara.
- Verificado en vivo contra un backend local real (API + `vite dev`, cuenta de prueba por
  usuario/contraseña, sin passkey): racha calculada en `1` con un plan recién cargado, tarjeta
  de bienvenida desaparece correctamente al cargar el plan, feed vacío se ve bien. Sin errores
  de consola nuevos. La verificación completa con dos cuentas reales queda para el final, cuando
  el backend ya soporte foto/título/descripción — hacerlo antes habría verificado publicaciones
  a medio construir.
- Todas las cadenas nuevas del Inicio, publicaciones, alta y ajustes están ya en `es.js`; la
  auditoría de literales `t()` usados contra el diccionario español queda a cero.

---

## Reglas de trabajo

1. Un commit por trozo coherente, con esta lista actualizada dentro.
2. Nada sin commitear al terminar una sesión. Si algo queda a medias, se commitea diciéndolo.
3. Este repositorio es público: ningún secreto, credencial ni dato de los perfiles en este archivo.
4. La bóveda de Obsidian se actualiza **al desplegar**, no antes. Este documento cuenta *cómo va*;
   la bóveda cuenta *qué hay en producción*.
5. Al cerrar la versión, este documento se resume en el MOC del proyecto y se archiva.
