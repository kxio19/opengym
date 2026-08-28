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

  $remoteCommand = "set -eu; mkdir -p '$RemotePath'; tar -xzf '$remoteArchive' -C '$RemotePath'; rm -f '$remoteArchive'; cd '$RemotePath'; test -f .env; docker compose up -d --build --remove-orphans; docker compose ps"
  & ssh.exe ("${PiUser}@${PiHost}") $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'El despliegue remoto falló.' }
}
finally {
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}

