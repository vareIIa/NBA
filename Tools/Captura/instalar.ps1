# Instala o ambiente de captura no Windows: Pose2Sim + rtmlib (RTMPose/RTMW, onnxruntime/OpenVINO) + OpenSim,
# num ambiente virtual FORA do repositório (nunca commitar o venv).
#
# Uso (PowerShell, dentro de Tools\Captura):
#   powershell -ExecutionPolicy Bypass -File .\instalar.ps1 [-Venv C:\garrafao-captura\venv] [-Gpu] [-Testar]
#   -Gpu     troca o onnxruntime pelo onnxruntime-gpu (placa NVIDIA; precisa de CUDA 12 e cuDNN 9 instalados)
#   -Testar  roda o demo de 4 câmeras do Pose2Sim de ponta a ponta (~3 min na CPU) para conferir a instalação
param(
    [string]$Venv = "$env:USERPROFILE\garrafao-captura\venv",
    [switch]$Gpu,
    [switch]$Testar
)

function Checar($passo) {
    # Programas externos (py, pip) não param o script sozinhos: conferimos o código de saída de cada passo.
    if ($LASTEXITCODE -ne 0) { Write-Host "Falhou: $passo (código $LASTEXITCODE)"; exit 1 }
}

# O Pose2Sim 0.10 pede Python >= 3.11. O lançador "py" vem com o instalador do python.org (e com o winget).
$versao = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($v in @("3.12", "3.11", "3.13")) {
        & py "-$v" -c "import sys" *> $null
        if ($LASTEXITCODE -eq 0) { $versao = $v; break }
    }
}
if (-not $versao) {
    Write-Host "Instale o Python 3.12:  winget install Python.Python.3.12  (ou python.org) e abra um PowerShell novo."
    exit 1
}
Write-Host "Usando Python $versao -> venv em $Venv"
New-Item -ItemType Directory -Force -Path (Split-Path $Venv) | Out-Null
& py "-$versao" -m venv $Venv; Checar "criar o venv"
$py = Join-Path $Venv "Scripts\python.exe"
& $py -m pip install --upgrade pip; Checar "atualizar o pip"
# Versão testada no repositório (pose2sim traz rtmlib, opensim, openvino, opencv, caliscope e PyAV).
& $py -m pip install "pose2sim==0.10.49" onnxruntime; Checar "instalar o pose2sim"
if ($Gpu) {
    & $py -m pip uninstall -y onnxruntime; Checar "remover o onnxruntime"
    & $py -m pip install onnxruntime-gpu; Checar "instalar o onnxruntime-gpu"
}
& $py -c "import Pose2Sim, rtmlib, opensim, onnxruntime as o; print('OK: Pose2Sim, rtmlib, OpenSim', opensim.__version__, '| provedores:', o.get_available_providers())"
Checar "importar Pose2Sim/rtmlib/OpenSim"

if ($Testar) {
    $demo = Join-Path (Split-Path $Venv) "teste_demo"
    if (Test-Path $demo) { Remove-Item -Recurse -Force $demo }
    & $py -c "import Pose2Sim, shutil, os, sys; shutil.copytree(os.path.join(os.path.dirname(Pose2Sim.__file__), 'Demo_SinglePerson'), sys.argv[1])" $demo
    Checar "copiar o demo"
    & $py (Join-Path $PSScriptRoot "rodar_pose2sim.py") $demo --sync auto --sem-janelas; Checar "rodar o demo"
    Write-Host "Demo OK: veja $demo\pose-3d (.trc) e $demo\kinematics (.mot)"
}
Write-Host "Pronto. Ative com:  $Venv\Scripts\Activate.ps1"
Write-Host "(se o PowerShell bloquear scripts: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned)"
