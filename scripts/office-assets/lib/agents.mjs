/**
 * Agentes pixel art do TraceCom — arte original (inspirada na linguagem visual
 * de personagens top-down cute, proporção chibi, usada por Pixel Agents).
 *
 * Folha: 12 colunas x 3 linhas, célula 32x48.
 *   linhas  = frente / lado (olhando para a direita; espelhado para esquerda) / costas
 *   colunas = idle(2) walk(4) work(2) sit(2) observe(2)
 */
import { PixelCanvas, PALETTE, shade, mix, withAlpha } from "./pixel.mjs";

export const FRAME_W = 32;
export const FRAME_H = 48;
export const ANCHOR = { x: 16, y: 44 };

export const ANIMATIONS = {
  idle: { start: 0, frames: 2, fps: 3, loop: true },
  walk: { start: 2, frames: 4, fps: 8, loop: true },
  work: { start: 6, frames: 2, fps: 4, loop: true },
  sit: { start: 8, frames: 2, fps: 3, loop: true },
  observe: { start: 10, frames: 2, fps: 2, loop: true },
};
export const DIRECTIONS = ["front", "side", "back"];

/* ------------------------------------------------------------------ */
/* Paletas / variantes                                                  */
/* ------------------------------------------------------------------ */

function basePalette({ skin, hair, shirt, pants, style = 0, glasses = false, tie = false, blazer = false, blush = false, shoes = null }) {
  return {
    skin,
    skinShade: shade(skin, 0.82),
    hair,
    hairDark: shade(hair, 0.62),
    hairLight: shade(hair, 1.28),
    shirt,
    shirtDark: shade(shirt, 0.7),
    shirtLight: shade(shirt, 1.25),
    pants,
    pantsDark: shade(pants, 0.72),
    shoes: shoes ?? shade(pants, 0.55),
    style,
    glasses,
    tie,
    blazer,
    blush,
  };
}

export const AGENT_VARIANTS = [
  {
    id: "agent_trader_blue",
    name: "Trader Azul",
    role: "trader",
    palette: basePalette({ skin: PALETTE.skin[0], hair: PALETTE.hair[1], shirt: "#3f6fd8", pants: "#232c42", style: 0 }),
  },
  {
    id: "agent_trader_amber",
    name: "Trader Âmbar",
    role: "trader",
    palette: basePalette({ skin: PALETTE.skin[2], hair: PALETTE.hair[0], shirt: "#c98a2e", pants: "#2c3448", style: 1 }),
  },
  {
    id: "agent_trader_teal",
    name: "Trader Verde-água",
    role: "trader",
    palette: basePalette({ skin: PALETTE.skin[4], hair: PALETTE.hair[4], shirt: "#2f9e8f", pants: "#232f28", style: 2, blush: true }),
  },
  {
    id: "agent_critic",
    name: "Crítico",
    role: "critic",
    palette: basePalette({ skin: PALETTE.skin[1], hair: PALETTE.hair[6], shirt: "#6b4fc9", pants: "#241f3a", style: 1, glasses: true }),
  },
  {
    id: "agent_supervisor",
    name: "Supervisor",
    role: "supervisor",
    palette: basePalette({ skin: PALETTE.skin[3], hair: PALETTE.hair[5], shirt: "#7a3fd0", pants: "#1d1a2b", style: 0, tie: true, blazer: true }),
  },
  {
    id: "agent_social_green",
    name: "Social Verde",
    role: "social",
    palette: basePalette({ skin: PALETTE.skin[0], hair: PALETTE.hair[7], shirt: "#3fa06a", pants: "#3a3327", style: 2, blush: true }),
  },
  {
    id: "agent_social_orange",
    name: "Social Laranja",
    role: "social",
    palette: basePalette({ skin: PALETTE.skin[2], hair: PALETTE.hair[0], shirt: "#d05f3f", pants: "#2b2b33", style: 1 }),
  },
];

/* ------------------------------------------------------------------ */
/* Desenho do personagem                                                */
/* ------------------------------------------------------------------ */

const GROUND = ANCHOR.y;

/**
 * Desenha um personagem no canvas.
 * dir: "front" | "side" | "back"
 * pose: "idle" | "walk" | "work" | "sit" | "observe"
 * frame: índice da animação
 */
export function drawCharacter(c, p, dir, pose, frame) {
  const bob = (pose === "walk" || pose === "idle") && frame % 2 === 1 ? -1 : 0;
  const seated = pose === "sit";
  const sink = seated ? 4 : 0;

  const base = GROUND + bob + sink;
  drawShadow(c, pose);

  if (dir === "side") drawSide(c, p, pose, frame, base);
  else if (dir === "back") drawBack(c, p, pose, frame, base);
  else drawFront(c, p, pose, frame, base);
}

function drawShadow(c, pose) {
  const y = GROUND + 2;
  const rx = pose === "sit" ? 9 : 8;
  c.ellipse(ANCHOR.x, y, rx, 3, [10, 12, 18, 70]);
  c.ellipse(ANCHOR.x, y, rx - 3, 2, [10, 12, 18, 55]);
}

/* --------------------------------- frente --------------------------------- */

function drawFront(c, p, pose, frame, base) {
  const x = ANCHOR.x;

  // pernas + sapatos
  drawLegsFront(c, x, base, p, pose, frame);

  // torso
  const torsoTop = base - 25;
  const torsoBottom = base - 11;
  drawTorsoFront(c, x, torsoTop, torsoBottom, p);

  // braços
  drawArmFront(c, x - 7, torsoTop + 1, p, armPose(pose, frame, "left"), base);
  drawArmFront(c, x + 5, torsoTop + 1, p, armPose(pose, frame, "right"), base);

  // cabeça
  drawHeadFront(c, x, torsoTop - 16, p, pose, frame);
}

function drawLegsFront(c, x, base, p, pose, frame) {
  if (pose === "sit") {
    const hip = base - 11;
    c.rect(x - 6, hip, 5, 5, p.pants);
    c.rect(x + 1, hip, 5, 5, p.pants);
    c.vline(x - 6, hip, 5, p.pantsDark);
    c.vline(x + 5, hip, 5, p.pantsDark);
    c.rect(x - 1, hip + 1, 2, 4, p.pantsDark);
    c.rect(x - 6, hip + 5, 4, 4, p.pants);
    c.rect(x + 2, hip + 5, 4, 4, p.pants);
    c.rect(x - 7, base - 2, 5, 2, p.shoes);
    c.rect(x + 2, base - 2, 5, 2, p.shoes);
    return;
  }
  const legShift = walkLegsFront(pose, frame);
  drawLeg(c, x - 4, base, p, legShift.left);
  drawLeg(c, x + 1, base, p, legShift.right);
}

function walkLegsFront(pose, frame) {
  if (pose !== "walk") return { left: 0, right: 0 };
  const order = [0, -1, 0, -1];
  return { left: order[frame % 4], right: order[(frame + 2) % 4] };
}

function drawLeg(c, x, base, p, lift) {
  const top = base - 11;
  const bottom = base - 2;
  c.rect(x, top, 4, bottom - top, p.pants);
  c.vline(x, top, bottom - top, p.pantsDark);
  c.rect(x, bottom, 5, 2, p.shoes);
  if (lift) c.rect(x, bottom - 1, 5, 1, p.shoes);
}

function drawTorsoFront(c, x, top, bottom, p) {
  const w = 12;
  const left = x - w / 2;
  c.rect(left, top, w, bottom - top + 1, p.shirt);
  c.vline(left, top + 1, bottom - top - 1, p.shirtDark);
  c.vline(left + w - 1, top + 1, bottom - top - 1, p.shirtDark);
  c.hline(left + 1, top, w - 2, p.shirtLight);
  if (p.blazer) {
    // paletó: V branco + gravata
    c.poly([[left + 2, top], [x, top + 4], [left + 5, top + 12], [left, top + 12], [left, top + 1]], "#e8eef8");
    c.poly([[left + w - 3, top], [x - 1, top + 4], [left + w - 6, top + 12], [left + w - 1, top + 12], [left + w - 1, top + 1]], "#dce4f0");
    c.rect(x - 1, top + 3, 2, 8, "#b23a4a");
    c.px(x - 1, top + 3, "#d9566a");
  } else if (p.tie) {
    c.rect(x - 1, top + 2, 2, 9, "#b23a4a");
  }
  // cinto
  c.rect(left + 1, bottom - 1, w - 2, 2, p.pantsDark);
  c.hline(left + 2, bottom - 1, w - 4, shade(p.pantsDark, 1.5));
}

function armPose(pose, frame, side) {
  const alt = frame % 2;
  if (pose === "work") return { mode: "type", offset: alt };
  if (pose === "observe") return side === "right" ? { mode: "chin", offset: alt } : { mode: "side", offset: alt };
  if (pose === "walk") return { mode: "swing", offset: side === "left" ? alt * 2 - 1 : 1 - alt * 2 };
  if (pose === "sit") return { mode: "desk", offset: alt };
  return { mode: "side", offset: 0 };
}

function drawArmFront(c, x, top, p, arm, base) {
  const towardCenter = x < ANCHOR.x ? 1 : -2;
  if (arm.mode === "type") {
    c.rect(x, top + 4, 3, 4, p.shirt);
    c.rect(x + towardCenter, top + 8 + arm.offset, 3, 3, p.skin);
    return;
  }
  if (arm.mode === "chin") {
    c.rect(x, top + 4, 3, 5, p.shirt);
    c.rect(x - 1, top - 1, 3, 5, p.skin);
    return;
  }
  if (arm.mode === "desk") {
    c.rect(x, top + 4, 3, 4, p.shirt);
    c.rect(x + (x < ANCHOR.x ? 0 : 0), top + 8, 3, 3, p.skin);
    return;
  }
  if (arm.mode === "swing") {
    const dy = arm.offset >= 0 ? 1 : 0;
    c.rect(x, top + 4 + dy, 3, 6, p.shirt);
    c.rect(x, top + 10 + dy, 3, 2, p.skin);
    return;
  }
  c.rect(x, top + 4, 3, 6, p.shirt);
  c.rect(x, top + 10, 3, 3, p.skin);
}

function drawHeadFront(c, x, top, p, pose, frame) {
  // cabelo de trás (contorno)
  c.rect(x - 7, top, 14, 5, p.hair);
  c.hline(x - 6, top, 12, p.hairLight);
  // face
  c.rect(x - 5, top + 4, 10, 9, p.skin);
  c.vline(x - 5, top + 5, 8, p.skinShade);
  // orelhas
  c.px(x - 6, top + 7, p.skin); c.px(x - 6, top + 8, p.skinShade);
  c.px(x + 5, top + 7, p.skin); c.px(x + 5, top + 8, p.skinShade);
  // franja
  drawFringeFront(c, x, top, p);
  // olhos
  const blink = pose === "idle" && frame % 2 === 1;
  if (!blink) {
    c.rect(x - 4, top + 6, 2, 2, "#1b1f2b");
    c.rect(x + 2, top + 6, 2, 2, "#1b1f2b");
    c.px(x - 4, top + 6, "#eef4ff");
    c.px(x + 2, top + 6, "#eef4ff");
  } else {
    c.hline(x - 4, top + 7, 2, "#1b1f2b");
    c.hline(x + 2, top + 7, 2, "#1b1f2b");
  }
  if (p.glasses) {
    c.box(x - 5, top + 5, 4, 4, "#2a2f3f");
    c.box(x + 1, top + 5, 4, 4, "#2a2f3f");
    c.hline(x - 1, top + 6, 2, "#2a2f3f");
  }
  if (p.blush) { c.rect(x - 5, top + 10, 2, 1, "#e89a86"); c.rect(x + 3, top + 10, 2, 1, "#e89a86"); }
  // boca
  c.rect(x - 1, top + 11, 2, 1, "#a34a4a");
}

function drawFringeFront(c, x, top, p) {
  if (p.style === 0) {
    c.rect(x - 7, top, 14, 3, p.hair);
    c.rect(x - 6, top + 3, 2, 2, p.hair);
    c.rect(x + 4, top + 3, 2, 2, p.hair);
  } else if (p.style === 1) {
    c.rect(x - 7, top, 14, 3, p.hair);
    c.rect(x - 7, top + 3, 3, 4, p.hair);
    c.rect(x + 4, top + 3, 3, 2, p.hair);
    c.px(x - 3, top + 3, p.hair); c.px(x + 1, top + 3, p.hair);
  } else {
    c.rect(x - 7, top, 14, 4, p.hair);
    c.rect(x - 7, top + 4, 3, 3, p.hair);
    c.rect(x + 4, top + 4, 3, 3, p.hair);
    // coque
    c.circle(x, top - 2, 2, p.hair);
    c.px(x, top - 3, p.hairLight);
  }
}

/* ---------------------------------- lado ---------------------------------- */

function drawSide(c, p, pose, frame, base) {
  const x = ANCHOR.x + 1;
  const step = pose === "walk" ? [2, 0, -2, 0][frame % 4] : 0;
  const step2 = pose === "walk" ? [-2, 0, 2, 0][frame % 4] : 0;

  // pernas
  if (pose === "sit") {
    const hip = base - 11;
    c.rect(x - 3, hip, 8, 5, p.pants);
    c.vline(x - 3, hip, 5, p.pantsDark);
    c.rect(x + 3, hip + 3, 5, 4, p.pants);
    c.rect(x + 5, hip + 5, 3, 4, p.pants);
    c.rect(x + 3, base - 2, 9, 2, p.shoes);
  } else {
    drawLegSide(c, x - 1 + Math.round(step / 2), base, p, step);
    drawLegSide(c, x + 2 + Math.round(step2 / 2), base, p, step2);
  }

  // torso
  const top = base - 25;
  c.rect(x - 4, top, 9, 14, p.shirt);
  c.vline(x - 4, top + 1, 12, p.shirtDark);
  c.hline(x - 3, top, 7, p.shirtLight);
  if (p.tie) c.rect(x + 1, top + 5, 2, 9, "#b23a4a");
  if (p.blazer) c.poly([[x - 2, top], [x + 2, top + 5], [x - 1, top + 12], [x - 4, top + 12], [x - 4, top + 1]], "#e8eef8");
  c.rect(x - 3, top + 13, 7, 2, p.pantsDark);

  // braço
  const swing = pose === "walk" ? (frame % 2 === 0 ? 2 : -2) : 0;
  c.rect(x - 1 + swing, top + 3, 3, 8, p.shirt);
  c.rect(x - 1 + swing, top + 11, 3, 3, p.skin);
  if (pose === "work") c.rect(x + 1, top + 9 + (frame % 2), 4, 3, p.skin);
  if (pose === "observe") c.rect(x + 1, top - 1 + (frame % 2), 3, 4, p.skin);

  // cabeça de perfil
  const hx = x;
  c.rect(hx - 5, base - 41, 12, 15, p.skin);
  c.rect(hx - 5, base - 41, 12, 4, p.hair);
  c.rect(hx - 5, base - 37, 4, 8, p.hair);          // nuca
  c.rect(hx - 5, base - 41, 3, 14, p.hairDark);      // trás escuro
  c.hline(hx - 4, base - 41, 9, p.hairLight);
  if (p.style === 2) { c.rect(hx - 7, base - 34, 3, 5, p.hair); c.px(hx - 7, base - 29, p.hairDark); }
  // olho + sobrancelha
  c.rect(hx + 2, base - 34, 2, 2, "#1b1f2b");
  c.px(hx + 2, base - 34, "#eef4ff");
  c.hline(hx + 1, base - 36, 3, p.hairDark);
  if (p.glasses) { c.box(hx + 1, base - 35, 4, 4, "#2a2f3f"); c.px(hx + 5, base - 34, "#2a2f3f"); }
  // nariz e boca
  c.px(hx + 6, base - 31, p.skinShade);
  c.px(hx + 6, base - 31 + 1, p.skinShade);
  c.px(hx + 4, base - 29, "#a34a4a");
}

function drawLegSide(c, x, base, p, offset) {
  const top = base - 11;
  const bottom = base - 2;
  c.rect(x, top, 4, bottom - top, p.pants);
  c.vline(x, top, bottom - top, p.pantsDark);
  c.rect(x + Math.max(0, Math.round(offset / 2)), bottom, 6, 2, p.shoes);
}

/* --------------------------------- costas --------------------------------- */

function drawBack(c, p, pose, frame, base) {
  const x = ANCHOR.x;
  const shifted = base - 25;

  // pernas
  drawLegsFront(c, x, base, p, pose, frame);

  // torso (costas)
  c.rect(x - 6, shifted, 12, 14, p.shirt);
  c.vline(x - 6, shifted + 1, 12, p.shirtDark);
  c.vline(x + 5, shifted + 1, 12, p.shirtDark);
  c.hline(x - 5, shifted, 10, shade(p.shirt, 0.85));
  c.rect(x - 5, shifted + 12, 10, 2, p.pantsDark);

  // braços
  const alt = frame % 2;
  c.rect(x - 8, shifted + 3, 3, 6, p.shirt);
  c.rect(x - 8, shifted + 9, 3, 3, p.skin);
  c.rect(x + 5, shifted + 3, 3, 6, p.shirt);
  c.rect(x + 5, shifted + 9 + alt, 3, 3, p.skin);

  // cabeça (nuca)
  const top = shifted - 16;
  c.rect(x - 7, top, 14, 15, p.hair);
  c.rect(x - 7, top, 14, 5, p.hairLight);
  c.rect(x - 7, top, 3, 12, p.hairDark);
  c.rect(x + 4, top, 3, 12, p.hairDark);
  c.rect(x - 4, top + 12, 8, 3, p.skinShade); // pescoço
  if (p.style === 2) { c.rect(x - 1, top + 14, 3, 5, p.hair); c.rect(x - 1, top + 19, 3, 2, p.hairDark); }
  if (p.style === 1) { c.rect(x + 3, top + 10, 4, 3, p.hair); }
}

/* ------------------------------------------------------------------ */
/* Folha por variante                                                   */
/* ------------------------------------------------------------------ */

export function buildAgentSheet(variant) {
  const cols = 12, rows = 3;
  const canvas = new PixelCanvas(cols * FRAME_W, rows * FRAME_H);
  DIRECTIONS.forEach((dir, row) => {
    for (const [pose, anim] of Object.entries(ANIMATIONS)) {
      for (let f = 0; f < anim.frames; f++) {
        const cell = new PixelCanvas(FRAME_W, FRAME_H);
        drawCharacter(cell, variant.palette, dir, pose, f);
        canvas.replaceWith(cell, (anim.start + f) * FRAME_W, row * FRAME_H);
      }
    }
  });
  return canvas;
}

export function agentManifest(variant) {
  const animations = {};
  for (const [pose, anim] of Object.entries(ANIMATIONS)) {
    animations[pose] = {
      start: anim.start,
      frames: anim.frames,
      fps: anim.fps,
      loop: anim.loop,
      rows: { front: 0, side: 1, back: 2 },
    };
  }
  return {
    id: variant.id,
    category: "agents",
    name: variant.name,
    role: variant.role,
    type: "spritesheet",
    source: "tracecom-original",
    license: "MIT",
    file: "spritesheet.png",
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    columns: 12,
    rows: 3,
    directions: DIRECTIONS,
    mirrored: { side: true, note: "linha side desenhada virada para a direita; renderer espelha para a esquerda" },
    animations,
    states: Object.keys(ANIMATIONS),
    anchor: { ...ANCHOR, note: "pés/centro do corpo (32,44)" },
    depthOffset: 0,
    palette: {
      shirt: variant.palette.shirt,
      pants: variant.palette.pants,
      hair: variant.palette.hair,
      skin: variant.palette.skin,
    },
    notes: "Gerado por scripts/office-assets (arte original TraceCom). Editar parâmetros e regenerar.",
  };
}
