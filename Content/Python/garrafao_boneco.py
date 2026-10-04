# -*- coding: utf-8 -*-
"""
Projeto Garrafão — importação do boneco animado (Art/Characters/HoopsDummy/SK_HoopsDummy.fbx) na Unreal.

Usado de dois jeitos:
  - automático: Content/Python/init_unreal.py chama importar() quando o editor abre; só importa se o FBX
    mudou (hash guardado em Saved/Garrafao/boneco_importado.txt) ou se faltar algum asset;
  - manual: Tools/Editor/importar_personagem.py chama importar(forcar=True).
"""

import hashlib
import os

import unreal

DEST = "/Game/Hoops/Characters/Dummy"
FBX_RELATIVE = os.path.join("Art", "Characters", "HoopsDummy", "SK_HoopsDummy.fbx")
MESH_NAME = "SK_HoopsDummy"

CLIPS = [
    "Hold_Idle", "Walk", "Run",
    "Dribble_Idle_R", "Dribble_Idle_L",
    "Dribble_Walk_R", "Dribble_Walk_L",
    "Dribble_Run_R", "Dribble_Run_L",
    "Dribble_Back_R", "Dribble_Back_L",
    "Dribble_Side_R", "Dribble_Side_L",
    "JumpShot_R", "JumpShot_L",
]

EAL = unreal.EditorAssetLibrary


def log(msg):
    unreal.log("[Garrafao] " + msg)


def warn(msg):
    unreal.log_warning("[Garrafao] " + msg)


def fbx_path():
    path = os.path.abspath(os.path.join(unreal.Paths.project_dir(), FBX_RELATIVE))
    if not os.path.isfile(path):
        raise RuntimeError("FBX nao encontrado: {} (rode 'git lfs pull' na pasta do projeto)".format(path))
    if os.path.getsize(path) < 10000:
        raise RuntimeError("O FBX parece um ponteiro do Git LFS, nao o arquivo: rode 'git lfs pull'.")
    return path


def legacy_options():
    """Opções do importador FBX clássico. Com o Interchange (padrão na 5.8) elas podem ser ignoradas;
    o padrão do Interchange já importa malha, esqueleto, materiais e animações."""
    ui = unreal.FbxImportUI()
    ui.set_editor_property("import_mesh", True)
    ui.set_editor_property("import_as_skeletal", True)
    ui.set_editor_property("import_animations", True)
    ui.set_editor_property("import_materials", True)
    ui.set_editor_property("import_textures", False)
    ui.set_editor_property("create_physics_asset", True)
    ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_SKELETAL_MESH)
    ui.skeletal_mesh_import_data.set_editor_property("import_morph_targets", False)
    ui.anim_sequence_import_data.set_editor_property(
        "animation_length", unreal.FBXAnimationLengthImportType.FBXALIT_EXPORTED_TIME)
    return ui


def import_fbx(path, with_options):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", path)
    task.set_editor_property("destination_path", DEST)
    task.set_editor_property("destination_name", MESH_NAME)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    if with_options:
        task.set_editor_property("options", legacy_options())
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    return list(task.get_editor_property("imported_object_paths") or [])


def class_name(asset_data):
    try:
        return str(asset_data.asset_class_path.asset_name)
    except AttributeError:
        return str(asset_data.asset_class)


def assets_by_class():
    found = {}
    for path in EAL.list_assets(DEST, recursive=True, include_folder=False):
        data = EAL.find_asset_data(path)
        found.setdefault(class_name(data), []).append((str(data.asset_name), str(data.package_name)))
    return found


def clip_of(asset_name):
    """Clipe pelo FIM do nome (do mais longo para o mais curto: 'Dribble_Walk_R' antes de 'Walk')."""
    for clip in sorted(CLIPS, key=len, reverse=True):
        if asset_name.lower() == clip.lower() or asset_name.lower().endswith("_" + clip.lower()):
            return clip
    return None


def rename_clips():
    renamed = {}
    for asset_name, package in assets_by_class().get("AnimSequence", []):
        clip = clip_of(asset_name)
        if not clip:
            continue
        target = "{}/A_Hoops_{}".format(DEST, clip)
        if package == target:
            renamed[clip] = target
            continue
        if EAL.does_asset_exist(target):
            EAL.delete_asset(target)  # sobra de uma importação anterior
        if EAL.rename_asset(package, target):
            renamed[clip] = target
        else:
            warn("Nao consegui renomear {} -> {}".format(package, target))
    return renamed


MARKER = os.path.join("Saved", "Garrafao", "boneco_importado.txt")


def marker_path():
    return os.path.abspath(os.path.join(unreal.Paths.project_dir(), MARKER))


def file_hash(path):
    digest = hashlib.sha1()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def imported_state():
    """(tem malha, clipes com nome canônico)"""
    by_class = assets_by_class()
    clips = [name for name, _ in by_class.get("AnimSequence", []) if name.startswith("A_Hoops_")]
    return bool(by_class.get("SkeletalMesh")), len(clips)


def precisa_importar():
    try:
        path = fbx_path()
    except RuntimeError as error:
        warn(str(error))
        return False
    has_mesh, clip_count = imported_state()
    if not has_mesh or clip_count < len(CLIPS):
        return True
    try:
        with open(marker_path(), "r") as handle:
            return handle.read().strip() != file_hash(path)
    except OSError:
        return True


def importar(forcar=False):
    path = fbx_path()
    if not forcar and not precisa_importar():
        log("Boneco animado ja importado e atualizado.")
        return True
    log("Importando " + path)
    imported = []
    try:
        imported = import_fbx(path, with_options=True)
    except Exception as error:  # noqa: BLE001 (mostra o erro e tenta sem as opções clássicas)
        warn("Importacao com opcoes classicas falhou ({}); tentando com o padrao da engine.".format(error))
    if not assets_by_class().get("SkeletalMesh"):
        imported = import_fbx(path, with_options=False)
    log("Importados: {}".format(len(imported)))

    meshes = assets_by_class().get("SkeletalMesh", [])
    if not meshes:
        raise RuntimeError("Nenhuma SkeletalMesh em {}: veja o Output Log.".format(DEST))

    renamed = rename_clips()
    missing = [clip for clip in CLIPS if clip not in renamed]
    EAL.save_directory(DEST, only_if_is_dirty=True, recursive=True)

    log("Malha: {}".format(", ".join(name for name, _ in meshes)))
    log("Animacoes: {}/{}".format(len(renamed), len(CLIPS)))
    if missing:
        warn("Faltando: {}. Confira se o FBX veio inteiro (git lfs pull) e se 'Import Animations' estava ligado."
             .format(", ".join(missing)))
        return False

    os.makedirs(os.path.dirname(marker_path()), exist_ok=True)
    with open(marker_path(), "w") as handle:
        handle.write(file_hash(path))
    log("Pronto! Aperte Play: o jogador agora e o boneco animado.")
    return True
