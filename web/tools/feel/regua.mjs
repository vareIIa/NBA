// Régua do feel (docs/27 §5, Fase 1): um comando que mede o NOSSO drible com as métricas extraídas do NBA 2K27 e escreve
// a tabela "nós × 2K" com aprovado/reprovado por tolerância. Não muda nada no jogo.
//
//   node tools/feel/regua.mjs [--sem-video] [--porta 5191] [--saida ../Saved/feel/<data>]
//                             [--relatorio ../docs/dev/drible-2k/linha-de-base.md] [--dados ../docs/dev/drible-2k/dados]
//                             [--so-comparar <pasta de uma rodada>]
//
// Passos: 1) testes da derivação (python -I -m unittest); 2) Vite próprio sem HMR (ou LAB_ORIGIN); 3) verdade do motor
// (motor.mjs: cenários de tools/cenarios-feel.mjs, quadro a quadro); 4) vídeo dos mesmos cenários a 30 fps com a câmera
// atrás e acima -> medir.py (MediaPipe) -> calibrar.py (erro do pipeline); 5) golpes.py (métricas na régua do 2K);
// 6) comparar.py -> linha-de-base.md. Saídas pesadas (JSON por quadro, vídeos do NOSSO jogo) ficam em Saved/feel/
// (ignorado pelo git). Vídeo e quadros do 2K nunca entram aqui.
//
// Python: FEEL_PYTHON, senão tools/feel/.venv, senão `python`. O MediaPipe só é preciso para o passo 4 (sem ele, ou com
// --sem-video, a comparação usa a calibração da última rodada com vídeo, se houver).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { medirMotor } from './motor.mjs';
import { repoDir, startViteProprio, webDir } from './vite-proprio.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const saida = resolve(opt('--saida', join(repoDir, 'Saved', 'feel', stamp)));
const relatorio = resolve(opt('--relatorio', join(repoDir, 'docs', 'dev', 'drible-2k', 'linha-de-base.md')));
const dados = opt('--dados', join(repoDir, 'docs', 'dev', 'drible-2k', 'dados'));
const soComparar = opt('--so-comparar');
const semVideo = args.includes('--sem-video');
const modelo = join(here, 'modelos', 'pose_landmarker_heavy.task');
// Bola do nosso jogo no vídeo de calibração (HSV do OpenCV; a pintura do garrafão é H 4–5, a bola H 5–12 com costuras
// escuras, e o protetor laranja da tabela fica acima de 70% da altura da tela).
const BolaNossa = ['--bola-h', '7', '14', '--bola-s', '140', '--bola-v', '60', '250', '--topo', '0.70', '--raio', '10', '45', '--fechar', '15'];

function python() {
  if (process.env.FEEL_PYTHON) return process.env.FEEL_PYTHON;
  for (const p of [join(here, '.venv', 'Scripts', 'python.exe'), join(here, '.venv', 'bin', 'python')]) if (existsSync(p)) return p;
  return 'python';
}
const PY = python();

function py(script, pyArgs, { exe = PY, quiet = false } = {}) {
  const r = spawnSync(exe, ['-I', join(here, script), ...pyArgs], { cwd: webDir, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '').split('\n').filter((l) => !/^(W|I)0000|absl|inference_feedback|warning/i.test(l)).join('\n');
  if (!quiet && out.trim()) console.log(out.trim());
  if (r.status !== 0) throw new Error(`${script} falhou (código ${r.status})\n${out}`);
  return out;
}

function temMediapipe() {
  const r = spawnSync(PY, ['-I', '-c', 'import mediapipe, cv2, numpy'], { encoding: 'utf8' });
  return r.status === 0;
}

function rodada() {
  let head = '?';
  let sujo = '';
  try {
    head = execFileSync('git', ['-C', repoDir, 'rev-parse', '--short', 'HEAD']).toString().trim();
    const st = execFileSync('git', ['-C', repoDir, 'status', '--porcelain', '--', 'web/src']).toString().trim();
    const n = st ? st.split('\n').length : 0;
    if (n) sujo = `, com ${n} ${n === 1 ? 'arquivo' : 'arquivos'} de web/src alterado${n === 1 ? '' : 's'} e não commitado${n === 1 ? '' : 's'} (sessões em paralelo)`;
  } catch {
    /* sem git */
  }
  return `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, código em ${head}${sujo}`;
}

function ultimaCalibracao() {
  const base = join(repoDir, 'Saved', 'feel');
  if (!existsSync(base)) return null;
  const cands = readdirSync(base)
    .map((d) => join(base, d, 'calibracao.json'))
    .filter((p) => existsSync(p))
    .sort();
  return cands.pop() ?? null;
}

const t0 = Date.now();
console.log(`régua do feel -> ${relative(webDir, saida)}`);

// 1) Testes da derivação (quadro sintético -> números esperados).
{
  const r = spawnSync(PY, ['-I', '-m', 'unittest', 'discover', '-s', here, '-p', 'teste_*.py'], { cwd: webDir, encoding: 'utf8' });
  const resumo = (r.stderr || '').trim().split('\n').slice(-3).join(' ');
  console.log(`testes da derivação: ${resumo}`);
  if (r.status !== 0) {
    console.log(r.stderr);
    process.exit(1);
  }
}

let pasta = saida;
if (soComparar) {
  pasta = resolve(soComparar);
} else {
  mkdirSync(saida, { recursive: true });
  // 2) Vite próprio (sem HMR, nunca a 5173), a não ser que LAB_ORIGIN aponte para um.
  let vite = null;
  let origin = process.env.LAB_ORIGIN;
  if (!origin) {
    vite = await startViteProprio(Number(opt('--porta', 5191)));
    origin = vite.origin;
    console.log(`Vite próprio sem HMR em ${origin}`);
  }
  try {
    // 3) e 4a) Verdade do motor e vídeo dos cenários. A rodada (hora e estado do git) é a da medição.
    writeFileSync(join(saida, 'rodada.txt'), rodada() + '\n');
    await medirMotor(saida, { origin, video: !semVideo });
  } finally {
    await vite?.close();
  }
}

// 4b) Pipeline de vídeo no nosso jogo -> calibração.
let calibracao = join(pasta, 'calibracao.json');
const dirVideo = join(pasta, 'video');
if (!soComparar && !semVideo) {
  if (!existsSync(modelo) || !temMediapipe()) {
    console.log(`sem MediaPipe (${PY}) ou sem o modelo em ${relative(webDir, modelo)}: rode "python -I tools/feel/preparar.py" (README). Calibração pulada.`);
  } else {
    const idx = JSON.parse(readFileSync(join(dirVideo, 'indice.json'), 'utf8'));
    for (const v of idx.videos) {
      py('medir.py', [join(dirVideo, v.mp4), join(dirVideo, `${v.cenario}.medidas.csv`), '--modelo', modelo, ...BolaNossa], { quiet: true });
    }
    console.log(`medir.py (MediaPipe) em ${idx.videos.length} vídeos`);
    py('calibrar.py', [dirVideo, calibracao]);
  }
}
if (!existsSync(calibracao)) {
  const antiga = ultimaCalibracao();
  calibracao = antiga;
  console.log(antiga ? `usando a calibração de ${relative(webDir, antiga)}` : 'sem calibração: a margem do pipeline fica em branco');
}

// 5) Métricas do motor na régua do 2K.
const nos = join(pasta, 'nos.json');
py('golpes.py', [join(pasta, 'motor'), nos], { quiet: true });

// 6) Comparação e relatório.
mkdirSync(dirname(relatorio), { recursive: true });
const comp = join(pasta, 'comparacao.json');
const rodadaTxt = existsSync(join(pasta, 'rodada.txt')) ? readFileSync(join(pasta, 'rodada.txt'), 'utf8').trim() : rodada();
const cmpArgs = [join(here, 'referencia-2k.json'), nos, relatorio, '--json', comp, '--rodada', rodadaTxt, '--anexo', join(here, 'linha-de-base-anexo.md')];
if (calibracao) cmpArgs.push('--calibracao', calibracao);
py('comparar.py', cmpArgs);

// Números (pequenos) ao lado do relatório, para versionar junto: só nossos dados, nada do 2K.
if (dados && dados !== 'nao') {
  mkdirSync(dados, { recursive: true });
  copyFileSync(comp, join(dados, 'linha-de-base-comparacao.json'));
  copyFileSync(nos, join(dados, 'linha-de-base-nos.json'));
  if (calibracao) copyFileSync(calibracao, join(dados, 'linha-de-base-calibracao.json'));
}
writeFileSync(join(pasta, 'relatorio.txt'), relatorio + '\n');
console.log(`\nPronto em ${Math.round((Date.now() - t0) / 1000)} s. Relatório: ${relatorio}`);
console.log(`Dados da rodada: ${pasta}`);
