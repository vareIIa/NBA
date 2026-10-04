# -*- coding: utf-8 -*-
"""
Projeto Garrafão — (re)importa o boneco animado na Unreal 5.8 à força.

Normalmente NÃO precisa: o editor importa sozinho ao abrir (Content/Python/init_unreal.py), sempre que o FBX
mudar. Use este script se quiser forçar: Tools → Execute Python Script... → escolha este arquivo.

O que faz: importa Art/Characters/HoopsDummy/SK_HoopsDummy.fbx (malha + esqueleto + animações) em
/Game/Hoops/Characters/Dummy, renomeia as animações para A_Hoops_<Clipe> e salva.

Sem script: arraste o FBX para /Game/Hoops/Characters/Dummy no Content Browser com "Import Animations" ligado.
Se algo falhar, copie o Output Log (filtro "LogPython") e mande para o Claude.
"""

import os
import sys

import unreal

sys.path.insert(0, os.path.join(unreal.Paths.project_content_dir(), "Python"))
import garrafao_boneco  # noqa: E402

garrafao_boneco.importar(forcar=True)
