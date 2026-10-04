# -*- coding: utf-8 -*-
"""
Projeto Garrafão — cria os materiais da quadra realista (rodar UMA vez no editor da Unreal 5.8).

Como rodar:  Tools → Execute Python Script... → escolha este arquivo.
(precisa dos plugins "Python Editor Script Plugin" e "Editor Scripting Utilities", já ativados no .uproject)

O que faz:
  1. Baixa texturas de madeira CC0 do Poly Haven (https://polyhaven.com, licença CC0: uso comercial livre).
  2. Importa em /Game/Hoops/Textures.
  3. Cria /Game/Hoops/Materials/M_HoopsWoodFloor (piso de madeira envernizado, UV por posição no mundo,
     então não estica em pisos grandes) e /Game/Hoops/Materials/M_HoopsSolid (cor + rugosidade, usado
     nas linhas, aro, tabela, bola e manequim).
  4. Salva tudo. No próximo Play, a quadra usa os materiais automaticamente.

Se algo falhar, copie o Output Log (filtro "LogPython") e mande para o Claude.
"""

import json
import os
import urllib.request

import unreal

POLYHAVEN_CANDIDATES = ["wood_floor", "plank_flooring", "rectangular_parquet"]
RESOLUTION = "2k"
USER_AGENT = "ProjetoGarrafao/0.1 (setup_quadra_realista.py)"

TEXTURE_DIR = "/Game/Hoops/Textures"
MATERIAL_DIR = "/Game/Hoops/Materials"

# Tamanho do "azulejo" da textura no mundo (cm). Tábuas da quadra são estreitas: 1,5 m dá tábuas finas.
WOOD_TILE_CM = 150.0

MEL = unreal.MaterialEditingLibrary
EAL = unreal.EditorAssetLibrary


def log(msg):
    unreal.log("[Garrafao] " + msg)


def http_get(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def find_map(files, names):
    """Procura um mapa (ex.: Diffuse) no JSON do Poly Haven ignorando maiúsculas."""
    lower = {key.lower(): key for key in files.keys()}
    for name in names:
        key = lower.get(name.lower())
        if key:
            return files[key]
    return None


def pick_url(entry):
    """entry = {"2k": {"jpg": {"url": ...}, "png": {...}}, ...}"""
    if not entry:
        return None
    by_res = entry.get(RESOLUTION) or entry.get("1k") or next(iter(entry.values()))
    for fmt in ("jpg", "png"):
        if fmt in by_res and "url" in by_res[fmt]:
            return by_res[fmt]["url"]
    return None


def download_wood_textures():
    download_dir = os.path.join(unreal.Paths.project_saved_dir(), "Downloads", "PolyHaven")
    os.makedirs(download_dir, exist_ok=True)

    for asset_id in POLYHAVEN_CANDIDATES:
        try:
            files = json.loads(http_get("https://api.polyhaven.com/files/" + asset_id))
        except Exception as error:  # noqa: BLE001
            log("Poly Haven: '{}' indisponível ({}). Tentando o próximo.".format(asset_id, error))
            continue

        urls = {
            "BaseColor": pick_url(find_map(files, ["Diffuse", "diff"])),
            "Normal": pick_url(find_map(files, ["nor_dx", "Normal"])),
            "Roughness": pick_url(find_map(files, ["Rough", "roughness"])),
        }
        if not urls["BaseColor"]:
            log("Poly Haven: '{}' sem textura de cor. Tentando o próximo.".format(asset_id))
            continue

        paths = {}
        for kind, url in urls.items():
            if not url:
                continue
            extension = os.path.splitext(url)[1] or ".jpg"
            local = os.path.join(download_dir, "T_HoopsWood_{}{}".format(kind, extension))
            if not os.path.exists(local):
                log("Baixando {} ({})".format(kind, url))
                with open(local, "wb") as handle:
                    handle.write(http_get(url))
            paths[kind] = local
        log("Texturas de madeira: Poly Haven '{}' (CC0).".format(asset_id))
        return paths

    raise RuntimeError("Não consegui baixar texturas do Poly Haven. Verifique a internet e rode de novo.")


def import_texture(local_path, kind):
    asset_name = "T_HoopsWood_" + kind
    asset_path = TEXTURE_DIR + "/" + asset_name
    if not EAL.does_asset_exist(asset_path):
        task = unreal.AssetImportTask()
        task.set_editor_property("filename", local_path)
        task.set_editor_property("destination_path", TEXTURE_DIR)
        task.set_editor_property("destination_name", asset_name)
        task.set_editor_property("automated", True)
        task.set_editor_property("replace_existing", True)
        task.set_editor_property("save", True)
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

    texture = EAL.load_asset(asset_path)
    if texture is None:
        raise RuntimeError("Falha ao importar " + local_path)

    if kind == "Normal":
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        texture.set_editor_property("srgb", False)
    elif kind == "Roughness":
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_GRAYSCALE)
        texture.set_editor_property("srgb", False)
    EAL.save_loaded_asset(texture)
    return texture


def new_material(name):
    path = MATERIAL_DIR + "/" + name
    if EAL.does_asset_exist(path):
        EAL.delete_asset(path)  # recria do zero (o script pode ser rodado de novo)
    factory = unreal.MaterialFactoryNew()
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, MATERIAL_DIR, unreal.Material, factory)


def expr(material, cls, x, y):
    return MEL.create_material_expression(material, cls, x, y)


def build_wood_material(textures):
    material = new_material("M_HoopsWoodFloor")
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_CLEAR_COAT)

    # UV = posição no mundo (XY) / tamanho do azulejo: textura não estica em pisos grandes.
    world = expr(material, unreal.MaterialExpressionWorldPosition, -1400, 0)
    mask = expr(material, unreal.MaterialExpressionComponentMask, -1200, 0)
    mask.set_editor_property("r", True)
    mask.set_editor_property("g", True)
    mask.set_editor_property("b", False)
    mask.set_editor_property("a", False)
    MEL.connect_material_expressions(world, "", mask, "")
    tile = expr(material, unreal.MaterialExpressionDivide, -1000, 0)
    tile.set_editor_property("const_b", WOOD_TILE_CM)
    MEL.connect_material_expressions(mask, "", tile, "A")

    # Cor: textura x tom de maple (parâmetro "Tint").
    base = expr(material, unreal.MaterialExpressionTextureSample, -700, -300)
    base.set_editor_property("texture", textures["BaseColor"])
    MEL.connect_material_expressions(tile, "", base, "UVs")
    tint = expr(material, unreal.MaterialExpressionVectorParameter, -700, -500)
    tint.set_editor_property("parameter_name", "Tint")
    tint.set_editor_property("default_value", unreal.LinearColor(1.15, 0.98, 0.80, 1.0))
    tinted = expr(material, unreal.MaterialExpressionMultiply, -400, -350)
    MEL.connect_material_expressions(base, "RGB", tinted, "A")
    MEL.connect_material_expressions(tint, "", tinted, "B")
    MEL.connect_material_property(tinted, "", unreal.MaterialProperty.MP_BASE_COLOR)

    # Rugosidade: textura x escala (piso envernizado é mais liso que a madeira crua).
    if "Roughness" in textures:
        rough = expr(material, unreal.MaterialExpressionTextureSample, -700, 0)
        rough.set_editor_property("texture", textures["Roughness"])
        rough.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE)
        MEL.connect_material_expressions(tile, "", rough, "UVs")
        rough_scale = expr(material, unreal.MaterialExpressionScalarParameter, -700, 200)
        rough_scale.set_editor_property("parameter_name", "RoughnessScale")
        rough_scale.set_editor_property("default_value", 0.55)
        rough_mul = expr(material, unreal.MaterialExpressionMultiply, -400, 50)
        MEL.connect_material_expressions(rough, "R", rough_mul, "A")
        MEL.connect_material_expressions(rough_scale, "", rough_mul, "B")
        MEL.connect_material_property(rough_mul, "", unreal.MaterialProperty.MP_ROUGHNESS)

    if "Normal" in textures:
        normal = expr(material, unreal.MaterialExpressionTextureSample, -700, 350)
        normal.set_editor_property("texture", textures["Normal"])
        normal.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
        MEL.connect_material_expressions(tile, "", normal, "UVs")
        MEL.connect_material_property(normal, "RGB", unreal.MaterialProperty.MP_NORMAL)

    # Verniz (clear coat): o brilho que reflete os refletores do ginásio.
    clear_coat = expr(material, unreal.MaterialExpressionScalarParameter, -400, 550)
    clear_coat.set_editor_property("parameter_name", "ClearCoat")
    clear_coat.set_editor_property("default_value", 0.85)
    MEL.connect_material_property(clear_coat, "", unreal.MaterialProperty.MP_CUSTOM_DATA0)
    clear_coat_rough = expr(material, unreal.MaterialExpressionScalarParameter, -400, 700)
    clear_coat_rough.set_editor_property("parameter_name", "ClearCoatRoughness")
    clear_coat_rough.set_editor_property("default_value", 0.06)
    MEL.connect_material_property(clear_coat_rough, "", unreal.MaterialProperty.MP_CUSTOM_DATA1)

    MEL.recompile_material(material)
    EAL.save_loaded_asset(material)
    log("Criado " + MATERIAL_DIR + "/M_HoopsWoodFloor")


def build_solid_material():
    material = new_material("M_HoopsSolid")
    color = expr(material, unreal.MaterialExpressionVectorParameter, -500, -100)
    color.set_editor_property("parameter_name", "Color")
    color.set_editor_property("default_value", unreal.LinearColor(0.8, 0.8, 0.8, 1.0))
    MEL.connect_material_property(color, "", unreal.MaterialProperty.MP_BASE_COLOR)

    roughness = expr(material, unreal.MaterialExpressionScalarParameter, -500, 100)
    roughness.set_editor_property("parameter_name", "Roughness")
    roughness.set_editor_property("default_value", 0.45)
    MEL.connect_material_property(roughness, "", unreal.MaterialProperty.MP_ROUGHNESS)

    metallic = expr(material, unreal.MaterialExpressionScalarParameter, -500, 250)
    metallic.set_editor_property("parameter_name", "Metallic")
    metallic.set_editor_property("default_value", 0.0)
    MEL.connect_material_property(metallic, "", unreal.MaterialProperty.MP_METALLIC)

    MEL.recompile_material(material)
    EAL.save_loaded_asset(material)
    log("Criado " + MATERIAL_DIR + "/M_HoopsSolid")


def main():
    for folder in (TEXTURE_DIR, MATERIAL_DIR):
        if not EAL.does_directory_exist(folder):
            EAL.make_directory(folder)

    local = download_wood_textures()
    textures = {kind: import_texture(path, kind) for kind, path in local.items()}
    build_wood_material(textures)
    build_solid_material()
    log("Pronto! Aperte Play: a quadra agora usa o piso de madeira envernizado e a iluminação de ginásio.")


main()
