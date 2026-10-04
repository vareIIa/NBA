"""
Roda o Pose2Sim (BSD-3) num take: calibração → pose 2D (RTMPose/RTMW via rtmlib) → sincronização →
associação → triangulação → filtro → (aumento de marcadores) → cinemática (OpenSim) → (opcional) BVH do
jogo.

Uso (Windows ou Linux, com o ambiente de instalar.ps1 / instalar.sh ativo):

    python rodar_pose2sim.py <pasta_do_take> [--calib Calib.toml] [--sync som|audio|auto|gui|nenhum]
                             [--modelo corpo_todo|corpo] [--modo leve|equilibrado|preciso]
                             [--dispositivo auto|cpu|cuda] [--etapas calib,pose,sync,assoc,tri,filtro,ik]
                             [--sem-janelas]
                             [--altura 1.88] [--massa 85] [--corte-hz 12] [--bvh saida.bvh --asf 06.asf]

<pasta_do_take>: videos/ (um vídeo por câmera: cam01.mp4, cam02.mp4...) e calibration/ (ou passe --calib).

Configuração usada (cada uma sobrescreve a anterior):
  1. padrão do Pose2Sim instalado (Demo_SinglePerson/Config.toml);
  2. Config_garrafao.toml (esta pasta): o nosso padrão, comentado em português;
  3. Config.toml da pasta do take, se existir (ajustes de um take só);
  4. as opções desta linha de comando.
--sync som    (padrão) acha o "pulo de sincronia" pelo som (sincronizar_audio.py) e desloca a pose 2D de cada
              câmera por esses tempos (exato se os celulares gravam som e imagem alinhados).
--sync audio  o mesmo instante pelo som, mas o Pose2Sim refina pelo movimento numa janela de ±0,5 s.
--sync auto   correlação do movimento no vídeo inteiro (bom se os vídeos já começam quase juntos e sem drible).
--sync gui    janela do Pose2Sim para escolher o atleta e o instante do evento à mão.
--sync nenhum vídeos já sincronizados (pula a etapa).
--bvh         no fim, grava o BVH com pose2sim_para_bvh.py (ângulos do OpenSim + mãos do .trc; precisa de --asf).
Saídas na pasta do take: pose/ (2D), pose-3d/*.trc (3D), kinematics/*.mot e *.osim (OpenSim).
"""
import argparse
import copy
import glob
import os
import shutil
import sys
import tomllib
from pathlib import Path

AQUI = Path(__file__).resolve().parent
MODELOS = {"corpo": "Body_with_feet", "corpo_todo": "Whole_body"}
MODOS = {"leve": "lightweight", "equilibrado": "balanced", "preciso": "performance"}
ETAPAS = ["calib", "pose", "sync", "assoc", "tri", "filtro", "aumento", "ik"]
PADRAO = "calib,pose,sync,assoc,tri,filtro,ik"  # "aumento" (marcadores LSTM) é opcional: ver Config_garrafao.toml


def mesclar(base, novo):
    for chave, valor in novo.items():
        if isinstance(valor, dict) and isinstance(base.get(chave), dict):
            mesclar(base[chave], valor)
        else:
            base[chave] = copy.deepcopy(valor)
    return base


def ler_toml(caminho):
    with open(caminho, "rb") as arq:
        return tomllib.load(arq)


def montar_config(args, take, tempos):
    import Pose2Sim
    cfg = ler_toml(Path(Pose2Sim.__file__).parent / "Demo_SinglePerson" / "Config.toml")
    mesclar(cfg, ler_toml(AQUI / "Config_garrafao.toml"))
    if (take / "Config.toml").is_file():
        mesclar(cfg, ler_toml(take / "Config.toml"))
    opcoes = {"project": {"project_dir": str(take)}, "pose": {}, "synchronization": {}, "filtering": {}}
    if args.modelo:
        opcoes["pose"]["pose_model"] = MODELOS[args.modelo]
    if args.modo:
        opcoes["pose"]["mode"] = MODOS[args.modo]
    if args.dispositivo == "cuda":  # explícito: não depende do torch para detectar a GPU
        opcoes["pose"].update({"device": "CUDA", "backend": "onnxruntime"})
    elif args.dispositivo == "cpu":
        opcoes["pose"].update({"device": "CPU", "backend": "openvino"})
    if args.altura:
        opcoes["project"]["participant_height"] = args.altura
    if args.massa:
        opcoes["project"]["participant_mass"] = args.massa
    if args.corte_hz:
        opcoes["filtering"]["butterworth"] = {"cut_off_frequency": args.corte_hz}
    if args.sync == "gui":
        opcoes["synchronization"]["synchronization_gui"] = True
    elif args.sync in ("auto", "audio"):
        opcoes["synchronization"]["synchronization_gui"] = False
    if args.sync == "audio" and tempos:
        opcoes["synchronization"].update({"approx_time_maxspeed": [float(t) for t in tempos.values()],
                                          "time_range_around_maxspeed": 0.5, "keypoints_to_consider": "all"})
    if args.sem_janelas:
        opcoes["pose"].update({"display_detection": False})
        opcoes["synchronization"].update({"synchronization_gui": False, "display_sync_plots": False})
        opcoes["calibration"] = {"calculate": {"intrinsics": {"show_detection_intrinsics": False},
                                               "extrinsics": {"show_reprojection_error": False}}}
        opcoes["filtering"].update({"display_figures": False, "save_filt_plots": False})  # os gráficos exigem Qt
    return mesclar(cfg, opcoes)


def extrair_quadros(sessao, cada_s):
    """Tira PNGs dos vídeos de calibração (a extração de vídeo do Pose2Sim 0.10.49 está quebrada):
    intrinsics/camNN/*.mp4 → 1 quadro a cada `cada_s` segundos; extrinsics/camNN/*.mp4 → o quadro de 1 s."""
    import cv2
    pastas = [p for p in sessao.iterdir() if p.is_dir() and "calib" in p.name.lower()]
    if not pastas:
        sys.exit("Falta a pasta calibration/ em " + str(sessao))
    for tipo, intervalo in (("intrinsics", cada_s), ("extrinsics", None)):
        for video in sorted((pastas[0] / tipo).glob("*/*")):
            if video.suffix.lower() not in (".mp4", ".mov") or list(video.parent.glob(video.stem + "*.png")):
                continue
            cap = cv2.VideoCapture(str(video))
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            passo = max(1, round(fps * intervalo)) if intervalo else None
            n = salvos = 0
            while True:
                ok, quadro = cap.read()
                if not ok:
                    break
                if (passo and n % passo == 0) or (not passo and n == round(fps)):
                    cv2.imwrite(str(video.parent / "{}_{:05d}.png".format(video.stem, n)), quadro)
                    salvos += 1
                    if not passo:
                        break
                n += 1
            cap.release()
            print("{}: {} quadro(s) extraído(s)".format(video, salvos))


def sincronizar_por_som(take, tempos):
    """Desloca os JSON da pose 2D (pose/camNN_json → pose-sync/) para o pulo de sincronia cair no mesmo quadro em
    todas as câmeras. Mesma convenção do fim da sincronização do Pose2Sim (quadro novo = antigo − deslocamento).
    """
    import re
    import cv2
    videos = {Path(nome).stem: t for nome, t in tempos.items()}
    cap = cv2.VideoCapture(str(next((take / "videos").glob(next(iter(tempos))))))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    pastas = sorted(d for d in (take / "pose").iterdir() if d.is_dir() and "json" in d.name)
    evento = {d: round(videos[d.name.split("_")[0]] * fps) for d in pastas}
    base = min(evento.values())
    destino = take / "pose-sync"
    shutil.rmtree(destino, ignore_errors=True)
    for d in pastas:
        desloc = evento[d] - base
        (destino / d.name).mkdir(parents=True)
        for arq in d.glob("*.json"):
            partes = re.split(r"(\d+)", arq.name)
            novo = int(partes[-2]) - desloc
            if novo > 0:
                partes[-2] = "{:06d}".format(novo)
                shutil.copy(arq, destino / d.name / "".join(partes))
        print("{}: deslocamento de {} quadros ({:.0f} fps)".format(d.name, desloc, fps))


def converter_bvh(take, args):
    """Prefere os ângulos do OpenSim (.mot + .osim: ossos de comprimento fixo, menos tremor e deslize) com as mãos
    do .trc; sem a etapa ik, usa só o .trc filtrado."""
    import subprocess
    trcs = sorted(glob.glob(str(take / "pose-3d" / "*_filt_*.trc")), key=os.path.getmtime)
    trcs = [t for t in trcs if "_LSTM" not in t] or trcs
    if not trcs:
        sys.exit("Nenhum .trc filtrado em {}/pose-3d".format(take))
    cmd = [sys.executable, str(AQUI / "pose2sim_para_bvh.py")]
    mots = sorted(glob.glob(str(take / "kinematics" / "*.mot")), key=os.path.getmtime)
    osim = mots and mots[-1][:-4] + ".osim"
    if osim and os.path.isfile(osim):
        cmd += [mots[-1], args.bvh, "--osim", osim, "--maos-de", trcs[-1]]
    else:
        cmd += [trcs[-1], args.bvh]
    cmd += ["--asf", args.asf]
    print("\n==== bvh ====\n" + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("take", help="pasta do take (videos/ e calibration/)")
    p.add_argument("--calib", help="arquivo Calib_*.toml da sessão (é copiado para <take>/calibration/)")
    p.add_argument("--sync", choices=["som", "audio", "auto", "gui", "nenhum"], default="som")
    p.add_argument("--modelo", choices=list(MODELOS), default=None, help="padrão: o do Config_garrafao.toml")
    p.add_argument("--modo", choices=list(MODOS), default=None)
    p.add_argument("--dispositivo", choices=["auto", "cpu", "cuda"], default="auto")
    p.add_argument("--etapas", default=PADRAO,
                   help="subconjunto de: " + ",".join(ETAPAS) + " (padrão: " + PADRAO + ")")
    p.add_argument("--sem-janelas", action="store_true", help="não abre janelas (servidor; calibração já pronta)")
    p.add_argument("--altura", type=float, help="altura do atleta em metros (escala do OpenSim)")
    p.add_argument("--massa", type=float, help="massa do atleta em kg (só afeta forças)")
    p.add_argument("--corte-hz", type=float, help="corte do filtro Butterworth (Hz): drible 12, arremesso 8")
    p.add_argument("--bvh", help="no fim, grava este BVH no esqueleto do jogo")
    p.add_argument("--asf", help="06.asf da CMU (com --bvh)")
    args = p.parse_args()

    take = Path(args.take).resolve()
    if args.bvh and not args.asf:
        sys.exit("--bvh precisa de --asf (o 06.asf da CMU, ver Tools/Animacao/README.md).")
    if args.sem_janelas:
        os.environ.setdefault("MPLBACKEND", "Agg")
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    # O Pose2Sim acha a pasta de calibração pela posição do Config.toml: na pasta-mãe se ela tiver um (modo
    # "sessão"), senão na do take. Sem nenhum, usaria a pasta ATUAL do terminal: criamos um Config.toml vazio.
    if not (take / "Config.toml").is_file():
        (take / "Config.toml").write_text("# Ajustes só deste take (o resto vem do Config_garrafao.toml).\n",
                                          encoding="utf-8")
    sessao = take.parent if (take.parent / "Config.toml").is_file() else take
    if args.calib:
        destino = sessao / "calibration"
        destino.mkdir(exist_ok=True)
        shutil.copy2(args.calib, destino / Path(args.calib).name)
    etapas = [e.strip() for e in args.etapas.split(",") if e.strip()]
    if set(etapas) - set(ETAPAS):
        sys.exit("Etapas desconhecidas: {}".format(", ".join(sorted(set(etapas) - set(ETAPAS)))))
    if args.calib and "calib" in etapas:
        etapas.remove("calib")  # calibração da sessão já pronta
    if args.sync == "nenhum" and "sync" in etapas:
        etapas.remove("sync")
    sys.path.insert(0, str(AQUI))
    tempos = {}
    if "sync" in etapas and args.sync in ("som", "audio"):
        import sincronizar_audio
        try:
            tempos = sincronizar_audio.tempos_do_evento(str(take / "videos"))
        except (FileNotFoundError, ValueError) as erro:  # p.ex. vídeo sem áudio
            sys.exit(str(erro))
        print("Pulo de sincronia (s): " + ", ".join("{} {:.3f}".format(k, v) for k, v in tempos.items()))

    from Pose2Sim import Pose2Sim  # import lento: só depois de validar os argumentos

    cfg = montar_config(args, take, tempos)
    if "calib" in etapas and cfg["calibration"]["calibration_type"] == "calculate":
        extrair_quadros(sessao, cfg["calibration"]["calculate"]["intrinsics"].get("extract_every_N_sec", 1))
    pipe = Pose2Sim.Pose2SimPipeline(cfg)
    sync = (lambda: sincronizar_por_som(take, tempos)) if args.sync == "som" else pipe.synchronization
    passos = {"calib": pipe.calibration, "pose": pipe.poseEstimation, "sync": sync,
              "assoc": pipe.personAssociation, "tri": pipe.triangulation, "filtro": pipe.filtering,
              "aumento": pipe.markerAugmentation, "ik": pipe.kinematics}
    for etapa in ETAPAS:  # sempre na ordem do pipeline
        if etapa in etapas:
            print("\n==== {} ====".format(etapa), flush=True)
            passos[etapa]()
    if args.bvh:
        converter_bvh(take, args)
    print("\nPronto. 3D em {}, ângulos em {}".format(take / "pose-3d", take / "kinematics"))


if __name__ == "__main__":
    main()
