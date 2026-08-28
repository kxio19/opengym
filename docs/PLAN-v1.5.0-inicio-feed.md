# v1.5.0 — Inicio al estilo Hevy

Documento vivo del avance. **Se actualiza en el mismo commit que el código que describe**, nunca
al final del día, para que `git log` y esta lista no puedan contradecirse.

## Estado — 28 ago 2026

    Último commit del plan: (se rellena al commitear este trozo)
    En curso:  nada — racha + Inicio + tarjeta + detalle cerrados y verificados en vivo
    Bloqueado: el despliegue de 1.3.3/1.4.0 está a la espera de permiso de Kaio
    Siguiente: backend — foto, snapshot con título/descripción, Social obligatorio, check de términos

Producción está en `1.3.3-ddf83c0`. Publicados y **sin desplegar**: `1456d2e` (rescate de cuentas
por el administrador) y `badbc75` (traducción del panel de administración). Esta versión se
desplegará junto con ellos.

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
- [ ] `POST /api/social/photo` — cuerpo binario, solo miembros, tope 1 MB, tipo validado por los bytes de cabecera
- [ ] `GET /api/social/photo/:id` — exige sesión y pertenencia al grupo
- [ ] `GET /api/social/post?id=` — una publicación con todos sus comentarios
- [ ] `workoutSnapshot`: añadir `title`, `desc`, `photoId`
- [ ] `syncUserState`: borrar del disco la foto de una publicación que deja de existir
- [ ] `defaultSocialProfile`: `enabled: true`; `requireMember` se mantiene
- [ ] `PUT /api/social/me` con `purge`: borra publicaciones, no da de baja
- [ ] Alta: exigir `termsAccepted`, guardar `termsAcceptedAt`

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
- [x] `GET /api/social/post` — **pendiente aún en el backend**: el frontend ya llama a
      `socialPost(id)`, pero el endpoint no existe hasta el siguiente trozo. La ruta `/post/:id`
      no crashea (muestra el estado de carga) mientras tanto.

### Fin de entrenamiento
- [ ] Título (precargado con el nombre de la rutina), descripción y foto
- [ ] Reescalado con `canvas` antes de subir
- [ ] «¿Usar esta configuración para las próximas?» → `askFields`

### Traslados
- [ ] `Rankings` y `Challenges` → `views/Stats.jsx`
- [ ] `ProfileSetup` → sección de `views/Settings.jsx`, con «Borrar mis publicaciones»
- [ ] Borrar `views/Social.jsx` y la ruta `/social`; revisar los enlaces `#/social` de las push
- [ ] Check obligatorio en el alta de perfil

### Idioma y cierre
- [ ] Traducir las cadenas nuevas en `frontend/src/locales/es.js`
- [ ] La auditoría de `t()` contra `es.js` debe volver a dar cero
- [ ] Subir versión a 1.5.0 y actualizar el README

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
- Todas las cadenas nuevas de este trozo (p. ej. «Log your weight», «No shared workouts yet…»)
  se ven en inglés en la app ahora mismo: la traducción a `es.js` es su propia tarea al final
  («Idioma y cierre»), auditada automáticamente en vez de traducirse una a una sobre la marcha.

---

## Reglas de trabajo

1. Un commit por trozo coherente, con esta lista actualizada dentro.
2. Nada sin commitear al terminar una sesión. Si algo queda a medias, se commitea diciéndolo.
3. Este repositorio es público: ningún secreto, credencial ni dato de los perfiles en este archivo.
4. La bóveda de Obsidian se actualiza **al desplegar**, no antes. Este documento cuenta *cómo va*;
   la bóveda cuenta *qué hay en producción*.
5. Al cerrar la versión, este documento se resume en el MOC del proyecto y se archiva.
