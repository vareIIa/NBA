# -*- coding: utf-8 -*-
"""
Roda sozinho quando o editor da Unreal abre (Python Editor Script Plugin procura init_unreal.py em Content/Python).
Projeto Garrafão: importa/atualiza o boneco animado sem precisar de nenhum passo manual. Espera o Asset
Registry terminar de escanear o projeto antes de importar.
"""

import unreal

_state = {"handle": None, "ticks": 0}


def _tick(_delta):
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    if registry.is_loading_assets():
        return
    _state["ticks"] += 1
    if _state["ticks"] < 30:  # alguns frames de folga depois do scan
        return
    unreal.unregister_slate_post_tick_callback(_state["handle"])
    try:
        import garrafao_boneco
        garrafao_boneco.importar()
    except Exception as error:  # noqa: BLE001 (nunca derrubar o editor por causa disso)
        unreal.log_error("[Garrafao] Importacao automatica do boneco falhou: {} "
                         "(rode Tools/Editor/importar_personagem.py e mande o Output Log)".format(error))


if unreal.is_editor():
    _state["handle"] = unreal.register_slate_post_tick_callback(_tick)
