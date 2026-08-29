param(
  [string]$PiHost = '10.30.0.45',
  [string]$PiUser = 'admin',
  [string]$RemotePath = '/home/admin/servicios/opengym'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$archive = Join-Path ([IO.Path]::GetTempPath()) ('opengym-release-' + [guid]::NewGuid().ToString('N') + '.tar.gz')
$remoteArchive = '/tmp/opengym-release.tar.gz'

try {
  & tar.exe -czf $archive -C $repoRoot `
    --exclude='.git' --exclude='.env' --exclude='data' --exclude='media' `
    --exclude='node_modules' --exclude='frontend/node_modules' --exclude='api/node_modules' `
    --exclude='frontend/dist' .
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el paquete de despliegue.' }

  & scp.exe $archive ("${PiUser}@${PiHost}:${remoteArchive}")
  if ($LASTEXITCODE -ne 0) { throw 'SCP falló.' }

  # Se extrae a un directorio de paso y se sincroniza con --delete, en vez de extraer
  # encima. `tar -xzf` solo añade y sobrescribe: un fichero borrado del repo sobrevivia en la
  # Pi para siempre y seguia entrando en el contexto de cada build. Asi se descubrio
  # frontend/src/views/Social.jsx, borrado en 5f37627 y todavia alli cinco versiones despues.
  # .env y sus copias de seguridad viven solo en la Pi: se excluyen o el despliegue se las lleva.
  $remoteCommand = "set -eu; mkdir -p '$RemotePath'; STAGE=`$(mktemp -d); tar -xzf '$remoteArchive' -C `"`$STAGE`"; rm -f '$remoteArchive'; rsync -a --delete --exclude='.env*' --exclude='data' --exclude='media' --exclude='node_modules' `"`$STAGE`"/ '$RemotePath'/; rm -rf `"`$STAGE`"; cd '$RemotePath'; test -f .env; docker compose up -d --build --remove-orphans; docker compose ps"
  & ssh.exe ("${PiUser}@${PiHost}") $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'El despliegue remoto falló.' }
}
finally {
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}

