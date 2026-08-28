# OpenGym en KaioHUB

Esta guía describe el despliegue reproducible preparado para la Raspberry Pi 5. Crear la entrada DNS/proxy, copiar archivos, iniciar contenedores y registrar passkeys son acciones de producción y requieren autorización explícita de Kaio.

## Destinos fijos

- URL: `https://gym.kaiohub.dev`
- RP ID: `gym.kaiohub.dev` (no cambiar después de registrar passkeys)
- Código/Compose: `/home/admin/servicios/opengym`
- Datos: `/DATA/AppData/opengym`
- Puerto del host: `3012`
- Zona horaria social: `Europe/Madrid`

## Primera instalación

1. Copiar `.env.example` a `.env` en el directorio remoto y completar `ADMIN_UIDS` después de crear el perfil propietario.
2. En Nginx Proxy Manager, instalar `deploy/nginx-proxy-manager-http_top.conf` en `/data/nginx/custom/http_top.conf`, crear `gym.kaiohub.dev` hacia `10.30.0.45:3012`, activar WebSockets, certificado Let's Encrypt, HTTPS forzado y protección contra exploits comunes. En la configuración avanzada del host usar `limit_req zone=opengym_proxy burst=40 nodelay;`.
3. Desplegar desde PowerShell con `deploy/deploy-opengym.ps1`. El script empaqueta el árbol local, lo copia por SCP y ejecuta `docker compose up -d --build`; no usa Git en la Pi.
4. Comprobar `/api/health`, crear la passkey de Kaio y configurar su UID en `ADMIN_UIDS`.
5. Mantener `INVITE_ONLY=1`, `COACH_DISABLED=1` y `SOCIAL_ENABLED=0` durante la validación base.

## Activación social

1. Hacer backup y verificarlo.
2. Cambiar `SOCIAL_ENABLED=1` y recrear los contenedores.
3. Activar Social solo en los perfiles de prueba desde la propia UI.
4. Verificar con dos cuentas que los campos ocultos no aparecen en el tráfico ni en el feed.
5. Probar una semana completa antes de emitir invitaciones adicionales.

El historial anterior y las importaciones llevan `origin: import` o carecen de elegibilidad, por lo que nunca se publican ni puntúan. Solo un entrenamiento terminado tras el consentimiento recibe `social.eligible=true`.

## Backups y recuperación

Instalar `deploy/opengym-backup.sh` como `/usr/local/sbin/opengym-backup`, `deploy/verify-opengym-backup.sh` como `/usr/local/sbin/opengym-verify-backup` y `deploy/opengym-backup.cron` como `/etc/cron.d/opengym-backup`. Se ejecuta cada día a las 03:30, conserva 30 días y valida el archivo antes de publicarlo. `opengym-verify-backup ARCHIVO` realiza una restauración aislada en un directorio temporal y comprueba `db.json`, `social.json` y los estados sin tocar producción.

Para una restauración real: detener los contenedores, mover `/DATA/AppData/opengym` a una ruta fechada de seguridad, extraer el backup en una carpeta nueva con el mismo nombre, comprobar propietario/permisos y arrancar. No sobrescribir nunca la carpeta viva sin conservar primero la anterior.

## Verificación posterior

- `docker compose ps` muestra `api` y `web` sanos y `media` completado.
- `https://gym.kaiohub.dev/api/health` devuelve `ok`, versión y número de usuarios.
- Registro sin invitación rechazado; registro con invitación aceptado.
- Passkeys desde dos dispositivos, PWA instalada y sincronización confirmada.
- Reinicio de Docker no pierde perfiles, entrenamientos ni Social.
- Feed, podios, comentarios, retos y moderación probados con al menos tres configuraciones de privacidad.
- El enlace “source code” apunta al fork público que contiene exactamente la versión desplegada.
