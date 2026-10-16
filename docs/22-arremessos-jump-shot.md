# 22 — Jump shot desenhado e bases de jogadores (Curry primeiro)

> Sessão do arremesso, 2026-10-15/16. Complementa `03-arremessos.md` (modelo de acerto e timing) e
> `dev/PLANO-CRIADOR-ARREMESSO.md` (tela do criador). Código: `web/src/shot/ShotForms.ts` (dados, puro),
> `web/src/anim/JumpShotMotion.ts` (corpo), ganchos em `PlayerAnimator` (playShot) e `Freestyle` (soltura).

## 1. O que estava errado

1. O `hoops_player.glb` reexportado em 2026-10-15 21:32 tinha todos os clipes a 24 fps em vez de 60 (2,5x mais
   lentos que o `hoops_player.clips.json`). A sessão do boneco HY 3D corrigiu no export (`trocar_corpo.py` volta a cena
   para 60 fps antes de exportar).
2. Mesmo com o clipe certo, a bola saía no instante em que o X era solto, onde a mão estivesse. Soltar cedo fazia a bola
   sair da cintura com o braço ainda embaixo.
3. O arremesso era um clipe de mocap amador da CMU (124_05), sem forma de jogador nenhum, e o criador só misturava dois
   clipes parecidos.

## 2. Como funciona agora

**Forma do arremesso = BASE + RELEASE**, como no Jump Shot Creator do 2K:

| Parte | O que controla (campos em `ShotBase` / `ShotRelease`) |
|---|---|
| Base (corpo de baixo) | profundidade e momento do dip, altura do salto, em que ponto do salto a bola sai (subindo, ápice, descendo), deriva à frente ou fade para trás, chute das pernas, perna de fora à frente (Dirk), largura e escalonamento dos pés, giro do corpo, inclinação do tronco |
| Release (corpo de cima) | bola no bolso, set point e soltura (posição no corpo), quando chega ao set point e quanto para nele (um tempo / dois tempos), cotovelo aberto, quando a mão de apoio sai, punho dobrado, tempo e altura do follow-through |

- **Criador:** a base vem de um jogador; as camadas de cima 1 e 2 vêm de dois jogadores e a mistura (0–100%) interpola
  todos os números da release. A velocidade de soltura continua no modelo (`ReleaseSpeed` muda a janela ideal) e o
  desenho se encaixa nela.
- **Cronograma** (`shotSchedule`): a soltura cai no tempo ideal do modelo (centro do green). A decolagem vem antes, pelo
  ponto do salto da base; o dip e o set point se ajustam em volta. Se a soltura for rápida demais para o salto inteiro,
  o salto encolhe (decolagem nunca antes de 45% do tempo).
- **Corpo** (`JumpShotMotion`, mesmo esquema da bandeja da nba-24): pelve pelo dip, voo balístico e absorção no pouso;
  pés presos no chão, ajustados para a base no começo, sobem com o salto; tronco a partir da pose de repouso com
  inclinação e giro; braços por IK até a bola, que segue o caminho bolso → set point → soltura; mão do arremesso
  embaixo da bola com o punho dobrado, mão de apoio do lado. Depois da soltura, o punho estala (gooseneck), o braço
  segura no alto e desce.
- **Soltura como no 2K:** a nota do timing é decidida quando o X é solto; a bola sai quando a mão chega ao ponto de
  soltura do desenho. Soltar tarde segura a bola no alto até soltar (ou até a soltura automática).

## 3. Stephen Curry (medido em vídeo)

Fontes: duas tomadas de jogo em câmera lenta do vídeo `Z7afVQ7C8e8` ("Stephen Curry Shooting Form Slow Motion 2023
Part 1", YouTube): catch-and-shoot em 6–22 s (vista de trás pela direita) e pull-up em 28–35 s (de trás pela esquerda).
Medição visual quadro a quadro. Usamos o vídeo como referência de animação (não vai para o jogo).

| Fase | O que se vê | No jogo |
|---|---|---|
| Bolso / dip | bola no peito, cotovelos fechados, joelhos dobrados ~110–120°, tronco levemente à frente | `pocket` 0,65 da altura, `dip` 5% da altura, `leanDip` 12° |
| Subida | a bola sobe **cruzando a frente do rosto** (cobre o rosto por um instante) | caminho da bola pelo lado da mão, perto do centro |
| Set point | bola na testa/acima dela, à frente; braço do arremesso com o cotovelo na altura do ombro, apontando para o aro; já na ponta dos pés ou decolando | `setPoint` 1,0 da altura, à frente 0,2 m; `setAt` 60% |
| Extensão | um tempo só: a bola não para; o braço estica para cima | `setHold` 0 |
| Soltura | braço quase reto, ~70° acima da horizontal, bola bem acima da cabeça, perto do ápice | `release` 1,22 da altura (+ salto), `releaseInJump` 0,9 |
| Ar | salto pequeno; canelas dobram para trás | `jump` 0,13 m, `kick` 0,4 |
| Follow-through | punho estalado; o braço assenta mais baixo (~55°); a mão de apoio fica aberta no alto, na altura da cabeça | follow-through 0,45 s, mão de apoio desce depois do pouso |

Proporções de tempo (dip → soltura): set point a ~35–50% do caminho; a extensão do braço até a soltura é a parte mais
longa. A pesquisa não achou fonte primária para o "0,4 s de soltura" do Curry; o tempo real vem do modelo de arremesso.

## 4. Outros jogadores (estimativas)

Klay Thompson, Ray Allen, Kevin Durant, Kobe Bryant, Dirk Nowitzki, Oscar Robertson (como a release dele no 2K: bola
acima da cabeça, dois tempos) e Larry Bird. Os números saíram de descrições de forma e do comportamento no 2K, **não de
vídeo medido**; cada um deve passar pela mesma medição do Curry antes de ser considerado fiel.

## 5. Mocap aberto de arremesso

A CMU tem 124_03 (arremesso), 124_04 (lance livre), 124_05 (jump shot) e 124_06 (bandeja), todos de um amador. Licença:
conferir em mocap.cs.cmu.edu antes de lançar (conversões em FBX de terceiros são CC BY-NC). AMASS e derivados são não
comerciais. O Mixamo não tem jump shot. Por isso o arremesso é desenhado por parâmetros, e o caminho para formas
fiéis é medir vídeo (ou capturar com os atletas do diretor, `16-pipeline-aberto-visual-e-mocap.md`).

## 6. Como medir e ajustar

- `node web/tools/arremesso-folha.mjs <saída> [segurar=26] [quadros=90] [cada=4] [vistas=side,front]` com o Vite na
  5173: arremesso no laboratório, quadro a quadro, câmera aberta; `SETUP='{"lowerBase":"Dirk","upperRelease1":"Dirk"}'`
  troca a forma. `python web/tools/arremesso-folha.py <saída> side folha.png` junta os prints numa grade para comparar
  com os quadros do vídeo.
- Testes: `web/src/shot/ShotForms.test.ts` (cronograma, continuidade do salto, mistura) e o e2e do Freestyle
  (arremesso GREEN que entra e um MUITO TARDE).

## 7. Nomes de jogadores

O 2K licencia nomes e imagem da NBA/NBPA. Para lançar, trocar os rótulos (`ShotSignatures[*].label`) por nomes
genéricos ou licenciados; os ids internos podem ficar.

## 8. Tela do criador (layout do 2K)

Pausa (P / Start) → Arremessos. Painel à esquerda com os 4 slots (Base, Camada 1, Camada 2, Mistura); nos slots de
animação, tabela com as notas de cada jogador (ALT. SOLT., IMUN. DEF., VEL. SOLT., EST. TIM.) e prévia ao focar a
linha; no slot de mistura, velocidade de soltura (3 passos), barra de mistura e o losango com as % das duas camadas.
Sem visual cue (decisão do diretor, 2026-10-16). À direita, o boneco repete o arremesso em loop (câmera de 3/4 de
frente) e o cartão SHOT ATTRIBUTES mostra as 4 notas ao vivo; o HUD do jogo some enquanto a tela está aberta.

As notas vêm de `shotAttributes` (`web/src/shot/JumpShotSetup.ts`), calculadas da forma real: altura da bola na soltura,
um tempo/dois tempos e dip, fade e perna à frente, salto/deriva/chute/cotovelo. **Só a velocidade de soltura muda o
jogo hoje** (janela de timing no modelo); altura e imunidade defensiva ainda não entram na contestação. Arquivos da
tela: `ShotCreatorView.ts`, `shotcreator.css`, `shotIcons.ts`, `PauseMenu.ts` e o bloco de prévia no `main.ts`.

## 9. Fluidez, traços e pull-up (2026-10-16)

**Fluidez** (`ShotForms.ts`): o arremesso parecia duro por trancos de velocidade, não pela pose.
- Decolagem: a extensão do dip agora é uma Hermite que chega à ponta do pé já subindo na velocidade do voo (antes a
  pelve parava e saía a ~1,6–2,5 m/s no quadro seguinte).
- Pouso: mola criticamente amortecida que entra com a velocidade da queda e afunda ~60% do dip.
- Deriva/fade: velocidade constante no ar (balística), com empurrão antes da decolagem e freada depois do pouso.
- Bola: Hermite com tangentes pelo tempo (`ballAt`). O Catmull-Rom uniforme dava trancos nas chaves (tempos desiguais) e
  freava a bola antes da soltura; agora ela acelera até a soltura e a pausa do set point (dois tempos) não passa do ponto.
- A bola sobe com o salto por `softLift` (sem quina quando a pelve passa da altura de pé).
- Follow-through: a palma continua na velocidade da bola na soltura por ~0,1 s antes de assentar.

**Traços novos** por jogador: `sway` (tronco tomba para o lado da mão de apoio: Dirk 10°, Kobe 6°), `guideFollow`
(mão de apoio no alto até o pouso, Curry, ou descendo logo, Kobe/Bird) e `pullHop` (parada do pull-up em 1-2 ou hop). Os
números dos jogadores foram afastados de propósito (salto do Bird 4 cm × Kobe 26 cm, set point, cotovelo, follow-through
do Ray Allen 0,75 s). Entrou **Devin Booker** (hop, sobe reto e alto, fade curto). Teste: cada par de jogadores difere em
pelo menos um traço visível.

**Pull-up** (`pullUpForm`, `pullUpMomentum`): chegando ao X acima de 1,5 m/s (tipo PullUp), o embalo (0 a 1 até 5 m/s)
muda a base: dip mais fundo e mais tarde (na passada que freia), salto mais alto (o embalo vira altura), soltura no ápice,
mais chute e menos fade. O `Freestyle.beginGather` passa o carry ao desenho, que planta os pés onde o corpo VAI estar na
decolagem (o corpo passa por cima deles freando), saindo da passada da corrida (até do pé no ar); o tronco vai para
trás na parada. Antes o passo era no referencial do corpo e o pé patinava com o embalo.

Conferir: `node web/tools/pullup-folha.mjs <saída> [sprint=1] [corre=45] [segura=30] [quadros=80] ['{"lowerBase":"Booker"}']`
com o Vite na 5173 (quadros de lado, escorregão do pé apoiado e tranco da pelve).
