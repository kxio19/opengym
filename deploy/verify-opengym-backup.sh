#!/bin/sh
set -eu

archive=${1:?Usage: verify-opengym-backup.sh /path/to/opengym-backup.tar.gz}
work_dir=$(mktemp -d)
container="opengym-restore-check-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

tar -xzf "$archive" -C "$work_dir"
test -s "$work_dir/db.json"
compose_dir=/home/admin/servicios/opengym
docker compose -f "$compose_dir/docker-compose.yml" run --rm --no-deps -v "$work_dir:/verify:ro" api \
  node -e "JSON.parse(require('fs').readFileSync('/verify/db.json','utf8')); const p='/verify/social.json'; if(require('fs').existsSync(p)){const d=JSON.parse(require('fs').readFileSync(p,'utf8'));if(d.version!==1)throw Error('social version')} console.log('JSON OK')"

# Restore rehearsal: boot the deployed API image against only the extracted
# copy, without publishing a port or touching the production data directory.
docker run -d --name "$container" --env-file "$compose_dir/.env" \
  -e PORT=3000 -e DATA_DIR=/data -v "$work_dir:/data" opengym-api >/dev/null
attempt=0
until docker exec "$container" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(d=>{if(!d.ok||d.users<1)process.exit(1)})"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then
    docker logs "$container"
    echo "La API restaurada no superó el healthcheck" >&2
    exit 1
  fi
  sleep 0.5
done
count=$(find "$work_dir" -type f -name 'state-*.json' | wc -l)
echo "Backup válido y API restaurada: $count perfiles con estado"
