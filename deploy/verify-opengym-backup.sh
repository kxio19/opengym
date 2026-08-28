#!/bin/sh
set -eu

archive=${1:?Usage: verify-opengym-backup.sh /path/to/opengym-backup.tar.gz}
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

tar -xzf "$archive" -C "$work_dir"
test -s "$work_dir/db.json"
compose_dir=/home/admin/servicios/opengym
docker compose -f "$compose_dir/docker-compose.yml" run --rm --no-deps -v "$work_dir:/verify:ro" api \
  node -e "JSON.parse(require('fs').readFileSync('/verify/db.json','utf8')); const p='/verify/social.json'; if(require('fs').existsSync(p)){const d=JSON.parse(require('fs').readFileSync(p,'utf8'));if(d.version!==1)throw Error('social version')} console.log('JSON OK')"
count=$(find "$work_dir" -type f -name 'state-*.json' | wc -l)
echo "Backup válido: $count perfiles con estado"
