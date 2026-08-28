#!/bin/sh
set -eu

data_dir=/DATA/AppData/opengym
backup_dir=/DATA/Backups/opengym
stamp=$(date +%Y-%m-%d_%H%M%S)
tmp_file="$backup_dir/.opengym-$stamp.tar.gz.tmp"
final_file="$backup_dir/opengym-$stamp.tar.gz"

mkdir -p "$backup_dir"
test -f "$data_dir/db.json"
tar -C "$data_dir" -czf "$tmp_file" .
tar -tzf "$tmp_file" >/dev/null
mv "$tmp_file" "$final_file"
find "$backup_dir" -type f -name 'opengym-*.tar.gz' -mtime +30 -delete
echo "$final_file"

