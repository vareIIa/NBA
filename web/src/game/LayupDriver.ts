// Bandeja no jogo: liga o comando do jogador ao plano do núcleo (src/sim/HoopsLayup.ts) e guarda o estado da bandeja em
// andamento. O Freestyle chama daqui: começar (X perto do aro), ler o toque/toque duplo do X durante o gather, mover o
// jogador pelo plano e soltar a bola no tempo do plano.
//
// Comandos (docs/02-controles.md §1, igual ao 2K23 — D6):
//  - X segurado dirigindo para a cesta: bandeja (o contexto escolhe a finalização e a mão);
//  - toque no X (soltou em menos de TapMaxSeconds): hop step;
//  - X duas vezes com o LS para a mão livre: euro step; para a mão da bola: cradle;
//  - LT segurado: cradle (docs/03-arremessos.md §7.1).
// O RS (Pro Stick) no drible entra depois: precisa de um gancho no updateProStick (sessão do drible).
//
// Hop step em fases (como no 2K): o toque no X faz o hop, o jogador pousa nos dois pés e FICA com a bola presa
// (HoopsHold). Ali o RS faz os fundamentos com um pé de pivô (jab, jab grande, jab cruzado, stepover, pivô reverso,
// spin-out), o toque no X faz pump fake, o X segurado finaliza (bandeja parada perto do aro, arremesso mais longe) e o
// X segurado logo depois de um pump fake faz o step-through.
import { Vec3, clamp } from '../sim/HoopsMath';
import {
  DunkRating,
  approachAngleDeg,
  LayupFinish,
  LayupGather,
  type LayupChoice,
  type LayupPlan,
  type LayupRequest,
  type LayupSituation,
  type LayupStyle,
  LayupStyles,
  type Side,
  chooseLayup,
  dropHang,
  isDunkFinish,
  layupCom,
  layupFootState,
  layupLabel,
  layupZoneM,
  planLayup,
  startHang,
} from '../sim/HoopsLayup';
import { HoldMove, HoldState, holdMoveForGesture } from '../sim/HoopsHold';
import { ProStickRecognizer, type StickGesture, StickDir, StickGestureKind } from '../sim/HoopsProStick';

/** Toque no X: soltou antes disso (s). */
export const TapMaxSeconds = 0.17;
/** Toque duplo: o segundo aperto até isso depois do primeiro (s). O toque simples vira hop na hora; o segundo toque troca o hop por euro/cradle. */
export const DoubleTapSeconds = 0.3;
/** Trocas de bandeja (hop, euro) só até isso antes da decolagem (s): depois o corpo já está subindo. */
const ReplanBeforeTakeoff = 0.16;
/** X que veio cedo (longe do aro) espera até isso (s) para começar; depois vira arremesso. */
const PendingSeconds = 0.7;

export interface LayupBody {
  position: Vec3;
  velocity: Vec3;
  /** Para onde o corpo olha (horizontal). */
  facing: Vec3;
}

export class LayupDriver {
  plan: LayupPlan | null = null;
  label = '';
  style: LayupStyle = LayupStyles.padrao;
  /** Instante (relógio do jogo) do gather: t = 0 do plano. */
  private startNow = 0;
  released = false;
  /** X apertado longe demais: espera o jogador chegar. */
  pending: { at: number; request: LayupRequest; fromStick?: boolean } | null = null;
  /** Leitura do X durante o gather: quando apertou, quando soltou e quantas vezes apertou. */
  private x = { pressAt: 0, releasedAt: -1, presses: 0, tapHandled: false };
  /** Último aperto do X durante a bandeja/hop (o segundo aperto no hop sobe direto ao pousar, como no 2K24). */
  private lastPressAt = -Infinity;
  /** O hop deste plano veio do toque no X: para no pouso dos dois pés (bola presa), sem subir. */
  hopStop = false;
  /** Bola presa (depois do hop step). */
  hold: HoldState | null = null;
  /** Pro Stick próprio da bola presa (o do drible é zerado fora do drible). */
  readonly stick = new ProStickRecognizer();
  /** X na bola presa: quando apertou e se já decidiu (toque = pump fake; segurado = finaliza). */
  holdX: { pressAt: number; done: boolean } | null = null;
  /** X segurado durante o pump fake: o step-through sai quando o fake acabar. */
  stepThroughQueued = false;
  /** X que foi para o arremesso (fora da zona da bandeja): velocidade e LS no aperto, se o toque virar hop step. */
  shotPress: { at: number; velocity: Vec3; lateral: Side | null } | null = null;
  /** Laboratório: força a enterrada (null = o contexto escolhe). */
  forceDunk: LayupFinish | null = null;

  time(now: number): number {
    return now - this.startNow;
  }

  /** O corpo ainda é da bandeja (do gather até ficar de pé depois do pouso). */
  controls(now: number): boolean {
    return this.hold !== null || (!!this.plan && this.time(now) <= this.plan.endAt);
  }

  /** Bandeja ou bola presa em andamento. */
  get busy(): boolean {
    return this.plan !== null || this.hold !== null;
  }

  /** Lê o RS e o X na bola presa. Retorna o que fazer: um movimento novo, finalizar, ou nada. */
  readHold(now: number, proX: number, proY: number, shoot: boolean, pressed: boolean, edgeTime: number): { start?: HoldMove; finish?: boolean } {
    const H = this.hold!;
    const out: { start?: HoldMove; finish?: boolean } = {};
    for (const g of this.stick.update(now, proX, proY)) {
      const m = holdMoveForGesture(g, H.ballHand);
      if (m !== null && !H.moving) out.start = m;
    }
    if (pressed) this.holdX = { pressAt: edgeTime, done: false };
    const x = this.holdX;
    if (x && !x.done) {
      const held = now - x.pressAt;
      if (!shoot && held < TapMaxSeconds) {
        x.done = true;
        out.start = HoldMove.PumpFake;
      } else if (shoot && held >= TapMaxSeconds) {
        x.done = true;
        // X segurado durante ou logo depois do pump fake = step-through; senão finaliza daqui.
        if (H.moveKind() === HoldMove.PumpFake) this.stepThroughQueued = true;
        else if (now - H.lastFakeAt < 0.55) out.start = HoldMove.StepThrough;
        else out.finish = true;
      }
    }
    if (this.stepThroughQueued && !H.moving) {
      this.stepThroughQueued = false;
      out.start = HoldMove.StepThrough;
    }
    return out;
  }

  /** X perto do aro: o pedido que vale para esta situação, ou null se longe demais para bandeja (arremesso). */
  requestFor(sit: LayupSituation, sprint: boolean, protect: boolean, dunk = false): LayupRequest | null {
    const dist = sit.position.sub(sit.rimFloor).length2D();
    const speed = sit.velocity.length2D();
    const toRim = sit.rimFloor.sub(sit.position).flat().normalized(sit.facing);
    const approach = sit.velocity.flat().dot(toRim);
    // RT + X perto do aro = enterrada (o LT segurado ainda pede o cradle).
    const command = protect ? 'cradle' : dunk ? 'dunk' : 'auto';
    if (dist > layupZoneM(speed, command)) return null;
    // Parado longe do aro é arremesso; perto (1,6 m) é bandeja de força mesmo parado.
    if (approach < 1.0 && dist > 1.6) return null;
    return { command, sprint };
  }

  /**
   * Monta o plano para o pedido. Se o X veio cedo (longe para dois passos), devolve 'wait'. Perto demais para a bandeja
   * pedida, tenta a de um passo e o hop (de força) antes de desistir.
   */
  plan_(request: LayupRequest, sit: LayupSituation, roll: number): LayupPlan | 'wait' | null {
    const choice = chooseLayup(request, sit, this.style, roll);
    if (request.command === 'dunk' && this.forceDunk !== null) choice.finish = this.forceDunk;
    const tries: LayupChoice[] = [choice];
    if (choice.gather !== LayupGather.OneStep) tries.push({ ...choice, gather: LayupGather.OneStep });
    if (choice.gather !== LayupGather.Hop) tries.push({ ...choice, gather: LayupGather.Hop });
    let farBy = 0;
    for (const c of tries) {
      const r = planLayup(c, sit, this.style, isDunkFinish(c.finish) ? DunkRating : 85);
      if (r.plan) return r.plan;
      if (c === choice && r.tooFarBy > 0) farBy = r.tooFarBy;
    }
    return farBy > 0 ? 'wait' : null;
  }

  /** O X que veio cedo ainda vale (espera até PendingSeconds). */
  pendingAlive(now: number): boolean {
    if (this.pending && now - this.pending.at > PendingSeconds) this.pending = null;
    return this.pending !== null;
  }

  /** `fromStick`: pedida pelo RS (sem X apertado): o X não vira toque/toque duplo (o RS troca no gather, readStick). */
  begin(plan: LayupPlan, now: number, pressAt: number, fromStick = false): void {
    this.plan = plan;
    this.hopStop = false;
    this.hold = null;
    this.label = layupLabel(plan);
    this.startNow = now;
    this.released = false;
    this.pending = null;
    // Bandeja parada (saindo da bola presa): o X que finalizou não vira toque/toque duplo de novo.
    const noTap = plan.steps === 0 || fromStick;
    this.x = { pressAt, releasedAt: -1, presses: noTap ? 3 : 1, tapHandled: noTap };
    this.lastPressAt = pressAt;
    this.stick.reset();
  }

  /** Hop step do toque já decidido (o toque veio do arremesso ou do X que esperava): sem troca por toque duplo. */
  beginHopStop(plan: LayupPlan, now: number, pressAt: number): void {
    this.begin(plan, now, pressAt);
    this.hopStop = true;
    this.label = 'Hop step';
    this.x = { pressAt, releasedAt: pressAt, presses: 3, tapHandled: true };
  }

  /** X apertado de novo depois do toque do hop (e ainda segurado): quando apertou; null se não houve. */
  pressAfterTap(): number | null {
    return this.lastPressAt > this.x.pressAt + 1e-3 ? this.lastPressAt : null;
  }

  /** Troca a bandeja no meio do gather (toque/toque duplo): o plano novo parte do estado de agora. */
  replan(plan: LayupPlan, now: number): void {
    this.plan = plan;
    this.label = layupLabel(plan);
    this.startNow = now;
    this.released = false;
  }

  end(): void {
    this.plan = null;
    this.pending = null;
    this.hold = null;
    this.hopStop = false;
    this.holdX = null;
    this.stepThroughQueued = false;
  }

  /**
   * Toque e toque duplo do X durante o gather. Retorna o pedido novo (hop, euro, cradle) quando o gesto pede outra
   * bandeja e ainda dá tempo (antes da decolagem).
   */
  readX(now: number, shoot: boolean, pressed: boolean, edgeTime: number, lsSide: Side | null, ballHand: Side): LayupRequest | null {
    const plan = this.plan;
    if (pressed) this.lastPressAt = edgeTime;
    if (!plan || this.released) return null;
    // Enterrada: o X não troca a finalização (segurado na soltura = pendurar no aro, ver hangOnRelease).
    if (isDunkFinish(plan.choice.finish)) return null;
    const x = this.x;
    if (!shoot && x.releasedAt < 0 && x.presses === 1) x.releasedAt = edgeTime;
    if (pressed && x.presses === 1 && edgeTime - x.pressAt <= DoubleTapSeconds) x.presses = 2;
    const t = this.time(now);
    // No hop com parada o toque duplo ainda vira euro/cradle enquanto o pé não empurrou; depois o segundo aperto é o da
    // finalização (pressAfterTap: segurado, sobe ao pousar).
    // O toque duplo vale até um pouco antes de os pés do hop pousarem (só até o empurrão, ele dependia da fase da passada:
    // com o pé apoiado empurrando já, o segundo toque a ~0,1 s chegava tarde e o euro não saía).
    const pushAt = Math.max(...plan.contacts.filter((c) => c.role === 'zero').map((c) => c.off), 0);
    const hopLand = plan.contacts.find((c) => c.role === 'hop')?.on ?? pushAt;
    const late = this.hopStop ? t > Math.max(pushAt, hopLand - 0.04) : t > plan.takeoffAt - ReplanBeforeTakeoff;
    if (late) return null;
    const g = plan.choice.gather;
    if (x.presses === 2 && g !== LayupGather.Euro && g !== LayupGather.Cradle) {
      x.presses = 3; // uma troca só
      this.hopStop = false;
      // LS para a mão da bola = cradle; para a outra (ou solto) = euro para o lado do LS.
      if (lsSide === ballHand) return { command: 'cradle', sprint: false };
      return { command: 'euro', side: lsSide ?? undefined, sprint: false };
    }
    const tap = x.releasedAt >= 0 && x.releasedAt - x.pressAt < TapMaxSeconds;
    // O toque vira hop assim que o X é solto (2K27: o hop sai no toque; esperar a janela do toque duplo atrasava ~0,2 s e
    // o hop pousava embaixo do aro). Se o segundo toque vier, o hop vira euro antes de o pé empurrar (acima).
    if (tap && !x.tapHandled && x.presses === 1 && g === LayupGather.Normal) {
      x.tapHandled = true;
      // Hop step em fases: pousa e fica com a bola (bola presa), sem subir direto (plano próprio: planHopStop).
      this.hopStop = true;
      return { command: 'hop', sprint: false };
    }
    return null;
  }

  /** Enterrada: na soltura, X ainda segurado = fica pendurado no aro (como no 2K). */
  hangOnRelease(xHeld: boolean, heightM: number): boolean {
    const plan = this.plan;
    if (!plan || !plan.rim || !xHeld || plan.hang) return false;
    startHang(plan, heightM);
    this.label = `${layupLabel(plan)} · pendurado`;
    return true;
  }

  /** Pendurado no aro e ainda segurando? Soltou o X = solta o aro. */
  get hanging(): boolean {
    return !!this.plan?.hang;
  }

  updateHang(now: number, xHeld: boolean): void {
    const plan = this.plan;
    if (!plan?.hang || xHeld) return;
    dropHang(plan, this.time(now));
  }

  /**
   * RS no drible dirigindo para a cesta, dentro da zona (2K23, docs/02-controles.md §1). Sem RT: cima = bandeja; baixo =
   * floater; lados = scoop com aquela mão (reversa vindo pela linha de fundo). Com RT (se a build enterra): cima = duas
   * mãos; lados = uma mão com aquela mão; diagonais para baixo = tomahawk/moinho; diagonais para cima = cock-back;
   * segurar para baixo = enterra e fica pendurado (o RS segurado na soltura). null = não é finalização (segue o drible).
   */
  stickRequest(gesture: StickGesture, sit: LayupSituation, sprint: boolean, canDunk: boolean): LayupRequest | null {
    if (gesture.kind !== StickGestureKind.Flick && gesture.kind !== StickGestureKind.Hold) return null;
    const dist = sit.position.sub(sit.rimFloor).length2D();
    const speed = sit.velocity.length2D();
    const toRim = sit.rimFloor.sub(sit.position).flat().normalized(sit.facing);
    if (sit.velocity.flat().dot(toRim) < 1.5) return null;
    const d = gesture.dir;
    const side: Side | undefined =
      d === StickDir.Left || d === StickDir.UpLeft || d === StickDir.DownLeft ? 'l' : d === StickDir.Right || d === StickDir.UpRight || d === StickDir.DownRight ? 'r' : undefined;
    const dunk = sprint && canDunk;
    let request: LayupRequest;
    if (dunk) {
      const F = LayupFinish;
      const finish =
        d === StickDir.Up || d === StickDir.Down
          ? d === StickDir.Up ? F.DunkTwoHand : undefined
          : d === StickDir.UpLeft || d === StickDir.UpRight
            ? F.CockBack
            : d === StickDir.DownLeft || d === StickDir.DownRight
              ? speed > 4 ? F.Windmill : F.Tomahawk
              : F.DunkOneHand;
      request = { command: 'dunk', side, sprint, finish };
    } else if (d === StickDir.Down) {
      request = { command: 'floater', sprint };
    } else if (side && (d === StickDir.Left || d === StickDir.Right)) {
      // Vindo pela linha de fundo (de lado para o aro), o lado da linha de fundo é a reversa; senão scoop daquela mão.
      const reverse = approachAngleDeg(sit.position, sit.rimFloor, sit.hoopForward) > 60 && chooseLayup({ command: 'reverse', sprint }, sit).hand === side;
      request = reverse ? { command: 'reverse', sprint } : { command: 'scoop', side, sprint };
    } else {
      request = { command: 'auto', sprint };
    }
    if (dist > layupZoneM(speed, request.command)) return null;
    return request;
  }

  /** RS no gather (antes da decolagem): switchback = euro para o lado do segundo toque; double throw = hop. */
  readStick(now: number, proX: number, proY: number): LayupRequest | null {
    const plan = this.plan;
    const gestures = this.stick.update(now, proX, proY);
    if (!plan || this.released || this.hopStop || isDunkFinish(plan.choice.finish)) return null;
    if (this.time(now) > plan.takeoffAt - ReplanBeforeTakeoff) return null;
    const g = plan.choice.gather;
    for (const gesture of gestures) {
      if (gesture.kind === StickGestureKind.Switchback && g !== LayupGather.Euro) {
        const side: Side | undefined = gesture.dir === StickDir.Left ? 'l' : gesture.dir === StickDir.Right ? 'r' : undefined;
        if (side) return { command: 'euro', side, sprint: false };
      }
      if (gesture.kind === StickGestureKind.DoubleThrow && g !== LayupGather.Hop) return { command: 'hop', sprint: false };
    }
    return null;
  }

  /** Corpo no instante: posição e velocidade do plano; o corpo olha entre a direção do movimento e o aro. */
  body(now: number): LayupBody {
    const plan = this.plan!;
    const t = this.time(now);
    const com = layupCom(plan, t);
    // Pendurado: olha para a tabela (de frente para o aro) até pousar.
    if (plan.hang && t >= plan.hang.grabAt) return { position: com.pos, velocity: com.vel, facing: plan.hang.facing };
    const toRim = plan.rimFloor.sub(com.pos).flat();
    const rimDir = toRim.length2D() > 0.3 ? toRim.normalized(com.dir) : com.dir;
    // No voo e no pouso o corpo não gira mais (olha para onde decolou, um pouco para o aro).
    const w = t < plan.takeoffAt ? 0.3 : 0.25;
    const look = t < plan.takeoffAt ? com.dir.scale(1 - w).add(rimDir.scale(w)) : plan.takeoffDir.scale(1 - w).add(this.rimDirAtTakeoff().scale(w));
    return { position: com.pos, velocity: com.vel, facing: look.flat().normalized(com.dir) };
  }

  private rimDirAtTakeoff(): Vec3 {
    const plan = this.plan!;
    return plan.rimFloor.sub(plan.takeoffPos).flat().normalized(plan.takeoffDir);
  }

  /** Situação para replanejar no meio: posição e velocidade do plano, pés do plano (apoiados) e do corpo (onde estão). */
  situationNow(now: number, base: LayupSituation, ankles: Record<Side, Vec3>): LayupSituation {
    const plan = this.plan!;
    const t = this.time(now);
    const com = layupCom(plan, t);
    const feet = {} as LayupSituation['feet'];
    for (const s of ['l', 'r'] as const) {
      const st = layupFootState(plan, s, t);
      feet[s] = { pos: st.contact ? st.contact.pos : ankles[s].flat(), planted: !!st.contact };
    }
    return { ...base, position: com.pos, velocity: com.vel, facing: com.dir, feet };
  }
}

/** Rating da bandeja no ShotModel (a dificuldade da variação pode tirá-lo da faixa). */
export const clampRating = (r: number): number => clamp(r, 25, 99);

