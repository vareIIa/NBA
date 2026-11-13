// Chaves do render novo (docs/28-render.md). `?render=0` volta ao render antigo (uma passada direto na tela, sem mapa de
// ambiente): serve para comparar e para as ferramentas que desenham a cena com outro WebGLRenderer (o mapa de ambiente
// e o reflexo são texturas do renderer do jogo). O laboratório (?lab=1) fica no antigo: ele mede animação em várias
// vistas recortadas.
const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

export const RenderOn = params.get('render') !== '0' && params.get('lab') !== '1';

/** Números da luz. Com o ambiente capturado da arena, a luz de preenchimento falsa (hemisférica, emissão da pele) cai. */
export const RenderLook = RenderOn
  ? {
      hemisphere: 0.16,
      key: 2.6,
      spot: 70,
      shadowMap: 4096,
      /** Fator sobre a emissão quente da pele (docs/20, "Pele no jogo"): era o que fingia a luz de ambiente. */
      skinEmissive: 0.5,
      /** Telão e faixa de LED (sem luz, fora do tone mapping antigo): mais fortes, para passarem do limiar do bloom. */
      unlitBoost: 2.2,
      /** Força do mapa de ambiente capturado da arena (scene.environmentIntensity). */
      environment: 1.35,
      /** Expoente sobre a luz pintada na textura da pele (corpo e rosto): menor = mais chapado. Ver SkinTone.ts. */
      skinFlatten: 0.35,
      faceFlatten: 0.7,
      /** Repinta de pele o que o HY pintou de preto nos braços e nas mãos (alfa da máscara de pele). */
      skinRepair: true,
      /** Fase 4: fator do albedo da pele, força da luz que atravessa a pele no terminador, e olho molhado. */
      skinAlbedo: 0.8,
      skinScatter: 0.6,
      eyeGloss: true,
      /** Direção de arte: a torcida na penumbra (fator da cor dela) e a contraluz que recorta os jogadores (RimLight.ts). */
      crowd: 0.6,
      rim: 0.8,
    }
  : { hemisphere: 0.55, key: 1.6, spot: 140, shadowMap: 2048, skinEmissive: 1, unlitBoost: 1, environment: 1, skinFlatten: 1, faceFlatten: 1, skinRepair: false, skinAlbedo: 1, skinScatter: 0, eyeGloss: false, crowd: 1, rim: 0 };
