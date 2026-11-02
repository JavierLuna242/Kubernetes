# Compila la imagen de un servicio dentro del clúster (BuildKit), la sube al registro (ACR) y la despliega.
# Uso:  .\desplegar.ps1 backend | frontend | analisis      (plataforma IoT)
#       .\desplegar.ps1 wordpress                          (Laboratorio)
param([Parameter(Mandatory)][ValidateSet('backend', 'frontend', 'analisis', 'wordpress')][string]$Servicio)
$acr = 'iotproyectojavierbr'
$ver = 'v0.34.1'
# Servicio -> carpeta del código, nombre del Deployment y de la imagen, namespace y manifiesto.
$s = @{
    backend   = @{ dir = 'servicios\backend';      nombre = 'back';      ns = 'iot';       yaml = 'kubernetes\backend.yaml' }
    frontend  = @{ dir = 'servicios\frontend';     nombre = 'front';     ns = 'iot';       yaml = 'kubernetes\frontend.yaml' }
    analisis  = @{ dir = 'servicios\analisis';     nombre = 'analysis';  ns = 'iot';       yaml = 'kubernetes\analisis.yaml' }
    wordpress = @{ dir = 'laboratorio\wordpress'; nombre = 'wordpress'; ns = 'wordpress'; yaml = 'laboratorio\kubernetes\wordpress.yaml' }}[$Servicio]
$nombre = $s.nombre

# buildctl (cliente de BuildKit): se descarga una sola vez.
$bin = "$env:LOCALAPPDATA\buildkit\bin\buildctl.exe"
if (-not (Test-Path $bin)) {
    $tgz = "$env:TEMP\buildkit-$ver.tar.gz"
    Invoke-WebRequest "https://github.com/moby/buildkit/releases/download/$ver/buildkit-$ver.windows-amd64.tar.gz" -OutFile $tgz
    New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\buildkit" | Out-Null
    tar -xzf $tgz -C "$env:LOCALAPPDATA\buildkit"
}

# Credencial temporal (3 h) del ACR; BuildKit la toma de este config.json para subir la imagen.
$token = az acr login -n $acr --expose-token --query accessToken -o tsv --only-show-errors
if (-not $token) { throw "No se pudo obtener el token del ACR (¿hiciste az login?)" }
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("00000000-0000-0000-0000-000000000000:$token"))
$env:DOCKER_CONFIG = Join-Path $env:TEMP "acr-$acr"
New-Item -ItemType Directory -Force $env:DOCKER_CONFIG | Out-Null
@{ auths = @{ "$acr.azurecr.io" = @{ auth = $auth } } } | ConvertTo-Json -Depth 3 |
    Set-Content "$env:DOCKER_CONFIG\config.json" -Encoding ascii

kubectl apply -f "$PSScriptRoot\kubernetes\compilador-imagenes.yaml" | Out-Null
kubectl -n iot rollout status deploy/buildkitd --timeout=180s | Out-Null
$pod = kubectl -n iot get pod -l app=buildkitd --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}'

$dir = Join-Path $PSScriptRoot $s.dir
& $bin --addr "kube-pod://$pod`?namespace=iot" build `
    --frontend dockerfile.v0 --local context=$dir --local dockerfile=$dir `
    --output "type=image,name=$acr.azurecr.io/${nombre}:latest,push=true"
if ($LASTEXITCODE) { throw "Falló la compilación de $Servicio" }

kubectl apply -f (Join-Path $PSScriptRoot $s.yaml)
kubectl -n $s.ns rollout restart deploy/$nombre
kubectl -n $s.ns rollout status deploy/$nombre --timeout=300s
