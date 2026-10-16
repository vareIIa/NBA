#!/bin/sh
# Baixa os resultados de uma fila do HY 3D (formato impresso pela aba: "<pasta da conta>|nome glb rig;nome glb rig;...").
#   sh web/tools/hy3d-baixar.sh '<saída da aba>' web/public/assets/models_raw/arena
# Pula o que já existe; 6 downloads em paralelo. As URLs do COS são públicas (sem cookie).
set -e
ENTRADA="$1"
DEST="${2:-web/public/assets/models_raw/arena}"
CONTA="${ENTRADA%%|*}"
LISTA="${ENTRADA#*|}"
B="https://hy-3d-studio-pre-sg-1258344703.cos.ap-singapore.myqcloud.com/3DGameStudio/$CONTA"
mkdir -p "$DEST"
echo "$LISTA" | tr ';' '\n' | while read -r n g r; do
  [ -n "$g" ] && [ ! -s "$DEST/$n.glb" ] && echo "$B/$g.glb $DEST/$n.glb"
  [ -n "$r" ] && [ ! -s "$DEST/${n}_rig.fbx" ] && echo "$B/$r.fbx $DEST/${n}_rig.fbx"
done | xargs -P 6 -n 2 sh -c 'curl -sSfL "$0" -o "$1" && echo "ok $1" || echo "FALHOU $1"'
