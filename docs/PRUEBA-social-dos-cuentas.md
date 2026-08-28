# Prueba de Social con dos cuentas

La casilla «probar dos cuentas» lleva días sin marcarse porque no dice qué hay que
hacer. Esto es el guion. Se hace **contra producción** (`https://gym.kaiohub.dev`) con
dos perfiles reales, uno de ellos desde el iPhone.

Antes de empezar: `/DATA/AppData/opengym/social-photos/` está vacía, así que cualquier
foto que aparezca ahí es de esta prueba.

Cada paso dice **qué mirar** y **qué sería un fallo**. Si algo falla, anótalo y sigue —
la mayoría de los pasos son independientes.

---

## 0. Preparación

- Perfil A: el de Kaio, desde el iPhone, con la app instalada en la pantalla de inicio
  (no en una pestaña de Safari — el fallo de la barra solo se veía instalada).
- Perfil B: la segunda persona, en su propio móvil o en un navegador cualquiera.
- Los dos tienen que estar dados de alta en el grupo; Social es obligatorio desde el
  alta, así que basta con que hayan creado el perfil.

---

## 1. La barra de pestañas durante el entrenamiento *(el fallo de 1.5.2)*

1. Perfil A, iPhone: empieza un entrenamiento con al menos un ejercicio.
2. Toca el campo de **peso** de una serie. Se abre el teclado numérico.

   **Mirar**: la barra inferior (Inicio · Plan · Seguir · Progreso · Ejercicios)
   desaparece mientras escribes. El reloj de descanso, si lo hay, se queda visible y
   sube por encima del teclado.
   **Fallo**: que la barra siga ahí tapada por el teclado, o que se quede encima del
   contenido.

3. Cierra el teclado y **haz scroll por la pantalla del entrenamiento**.

   **Mirar**: la barra vuelve abajo del todo, pegada al borde inferior.
   **Fallo**: la barra flotando en mitad de la pantalla con contenido dibujándose por
   debajo, y un rectángulo negro abajo. Es exactamente el fallo que se está arreglando.

4. Repite escribiendo unas **reps** y con el teclado abierto **gira el móvil**.

   **Fallo**: cualquier posición de la barra que no sea abajo del todo o escondida.

---

## 2. Publicar con foto

5. Termina el entrenamiento. Se abre el resumen.

   **Mirar**: el resumen se desliza; llegas al botón **«Publicar entrenamiento»**
   aunque hayas puesto foto.
   **Fallo**: no poder alcanzar el botón. Eso era el fallo de 1.5.1 y no debería volver.

6. Pon un **título**, una **descripción** y **añade una foto real** hecha con la cámara.

   **Mirar**: la vista previa de la foto ocupa una franja acotada, no media pantalla.
7. Publica.

---

## 3. Que el otro perfil lo vea

8. Perfil B: abre Inicio.

   **Mirar**: la publicación de A aparece en el feed, bajo la tarjeta de la semana, con
   su título, su descripción y su foto.
   **Fallo**: que no aparezca, que la foto salga rota, o que el hueco de la foto se
   quede gris.

9. Perfil B: dale **apoyo** y escribe un **comentario**.
10. Perfil A: comprueba que ve el apoyo y el comentario.

---

## 4. El detalle y el mapa muscular

11. Perfil B: toca la publicación para abrir su detalle.

    **Mirar**: el **mapa muscular** está pintado, con músculos coloreados. Es lo que
    verifica que el `setCount` llega en el snapshot aun con la privacidad por defecto
    (nombres de ejercicio sí, series y pesos exactos no).
    **Fallo**: el mapa en blanco. Significaría que el recuento de series no viaja.

12. Desliza el carrusel de la tarjeta entre la foto y la lista de ejercicios.

    **Mirar**: al llegar al final no se dispara el gesto de «atrás» del móvil, y
    bajar por la lista de ejercicios no cambia de página del carrusel.

13. Vuelve atrás con el gesto del sistema y comprueba que caes en Inicio.

---

## 5. Rankings y retos

14. Los dos perfiles: **Estadísticas** → rankings.

    **Mirar**: los dos perfiles aparecen, los pesos están en kg (no en lb) y el podio
    coincide con las cifras de la tabla de debajo.
15. Crea un reto desde un perfil y compruébalo desde el otro.

---

## 6. Nada del pasado se ha publicado

16. Perfil A y B: baja por el feed hasta el final.

    **Mirar**: no hay ninguna publicación anterior a cuando se creó el perfil, ni nada
    importado de Hevy.
    **Fallo**: cualquier entrenamiento antiguo publicado. Sería la trampa B del plan de
    1.5.0 (`enabledAt` puesto en el pasado) y hay que parar y avisar.

---

## 7. El respaldo se lleva las fotos

Esto lo puede comprobar Claude por SSH cuando termines; queda anotado aquí para que no
se olvide:

- Que `/DATA/AppData/opengym/social-photos/` ya no está vacía y ninguna foto pasa de 1 MB.
- Que en `social.json` ninguna publicación apunta a un entrenamiento con
  `origin === 'tracked'` ni anterior al `enabledAt` de su perfil.
- Que el backup de las 03:30 siguiente incluye `social-photos/`, restaurándolo en un
  directorio temporal.
- Cuánto ha crecido `/DATA/AppData/opengym`.

---

## Al terminar

Marcar en la bóveda ([[OpenGym - Roadmap y Estado]]) lo que haya salido bien, y abrir
una nota de lo que no. Mientras esta prueba no esté hecha, el criterio de «producción
con amigos» no se cumple.
