# opengym.duarte-santos.ch

Source of the project website — plain hand-written HTML/CSS/JS, no build step,
served by nginx.

Not in this folder (added at deploy time):

- `img/` — the five screenshots from `../assets/screenshots/` plus `banner.png`
- `icon-180.png` / `icon-512.png` — copied from `../frontend/public/` (the same
  icons the PWA uses, so the browser tab, home screen and app all match)
- `openGym.apk` — the signed release build (see `../docs/MOBILE.md`)

`site.js` fetches the star/fork counts from the public GitHub API at view time.

## Private group presentation

`amigos.html` is the Spanish presentation page for Kaio's invite-only instance. It
uses `amigos.css`, `amigos.js` and the real, privacy-safe Spanish screenshots in
`amigos-assets/`. The same folder includes desktop and mobile page previews; the
desktop one is the Open Graph share image. It is intentionally independent from
the upstream English home page so it can be shared or deployed separately.
