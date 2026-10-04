#!/usr/bin/env bash
# Instala o ambiente de captura (Linux; no macOS também funciona, só na CPU): Pose2Sim + rtmlib (RTMPose/RTMW,
# onnxruntime/OpenVINO) + OpenSim, num ambiente virtual FORA do repositório (nunca commitar o venv).
#
# Uso:  bash instalar.sh [--venv ~/garrafao-captura/venv] [--gpu] [--testar]
#   --gpu     troca o onnxruntime pelo onnxruntime-gpu (NVIDIA; precisa de CUDA 12 e cuDNN 9 instalados)
#   --testar  roda o demo de 4 câmeras do Pose2Sim de ponta a ponta (~3 min na CPU) para conferir a instalação
set -euo pipefail

VENV="$HOME/garrafao-captura/venv"
GPU=0
TESTAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --venv) VENV="$2"; shift ;;
    --gpu) GPU=1 ;;
    --testar) TESTAR=1 ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
  shift
done

# O Pose2Sim 0.10 pede Python >= 3.11 (testado com 3.11; o OpenSim 4.6 tem pacote para 3.11, 3.12 e 3.13).
PY=$(command -v python3.12 || command -v python3.11 || command -v python3.13 || true)
if [ -z "$PY" ]; then
  echo "Instale o Python 3.11 ou 3.12 (ex.: sudo apt install python3.12 python3.12-venv)."
  exit 1
fi
echo "Usando $PY → venv em $VENV"
mkdir -p "$(dirname "$VENV")"
"$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
# Versão testada no repositório (pose2sim traz rtmlib, opensim, openvino, opencv, caliscope e PyAV).
"$VENV/bin/python" -m pip install "pose2sim==0.10.49" onnxruntime
if [ "$GPU" = 1 ]; then
  "$VENV/bin/python" -m pip uninstall -y onnxruntime
  "$VENV/bin/python" -m pip install onnxruntime-gpu
fi
"$VENV/bin/python" -c "import Pose2Sim, rtmlib, opensim, onnxruntime as o; \
print('OK: Pose2Sim, rtmlib, OpenSim', opensim.__version__, '| provedores:', o.get_available_providers())"

if [ "$TESTAR" = 1 ]; then
  AQUI="$(cd "$(dirname "$0")" && pwd)"
  DEMO="$(dirname "$VENV")/teste_demo"
  rm -rf "$DEMO"
  "$VENV/bin/python" -c "import Pose2Sim, shutil, os, sys; \
shutil.copytree(os.path.join(os.path.dirname(Pose2Sim.__file__), 'Demo_SinglePerson'), sys.argv[1])" "$DEMO"
  "$VENV/bin/python" "$AQUI/rodar_pose2sim.py" "$DEMO" --sync auto --sem-janelas
  echo "Demo OK: veja $DEMO/pose-3d (.trc) e $DEMO/kinematics (.mot)"
fi
echo "Pronto. Ative com: source $VENV/bin/activate"
