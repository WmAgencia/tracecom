/**
 * Móveis, props, pisos, paredes, decoração e UI — pixel art isométrica original.
 *
 * Coordenadas de grade: iso(gx, gy, gz) = ((gx-gy)*42, (gx+gy)*19 - gz*26).
 * Cada sprite tem anchor = posição do ponto (0,0,0) da grade dentro do PNG,
 * permitindo ao renderer posicionar com precisão.
 */
import { PixelCanvas, iso, isoBox, shade, mix, withAlpha, TILE_W, TILE_H, TILE_Z } from "./pixel.mjs";

const WOOD = "#9a6238";
const WOOD_LIGHT = "#b5794a";
const WOOD_DARK = "#7a4a2a";
const WOOD_LEG = "#59341f";
const WOOD_GAP = "#683d22";
const METAL = "#7f8894";
const METAL_DARK = "#525a66";
const METAL_LIGHT = "#aeb8c4";
const CUSHION = "#3f6fd8";
const CUSHION_DARK = "#2b4a91";
const LEAF = "#3fa06a";
const LEAF_DARK = "#2c7a4e";
const LEAF_LIGHT = "#5fc98a";
const POT = "#b06a45";
const POT_DARK = "#8a4f31";
const FELT = "#2f7d52";
const INK = "#eaf2ff";

/* ------------------------------------------------------------------ */
/* Sprite helper                                                        */
/* ------------------------------------------------------------------ */

export function makeSprite({ w = 1, d = 1, h = 1, pad = 2, top = 0, bottom = 0, left = 0, right = 0, originGx = 0, originGy = 0 }, painter) {
  const corners = [[0, 0], [w, 0], [w, d], [0, d]];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [gx, gy] of corners) {
    for (const gz of [0, h]) {
      const p = iso(gx, gy, gz);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  minX -= pad + left; maxX += pad + right;
  minY -= pad + top; maxY += pad + bottom;
  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);
  const c = new PixelCanvas(width, height);
  const ox = -minX + 0.5, oy = -minY + 0.5;
  const I = (gx, gy, gz = 0) => {
    const p = iso(gx, gy, gz);
    return { x: p.x + ox, y: p.y + oy };
  };
  painter(c, I);
  const a = I(originGx, originGy, 0);
  return {
    canvas: c,
    anchor: { x: Math.round(a.x), y: Math.round(a.y) },
    width,
    height,
    footprint: { w, d },
    heightZ: h,
  };
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                      */
/* ------------------------------------------------------------------ */

function box(c, I, x0, y0, w, d, z0, z1, colors, outline = null) {
  const a = I(x0, y0, z1), b = I(x0 + w, y0, z1), cc = I(x0 + w, y0 + d, z1), dd = I(x0, y0 + d, z1);
  const a0 = I(x0, y0, z0), b0 = I(x0 + w, y0, z0), c0 = I(x0 + w, y0 + d, z0), d0 = I(x0, y0 + d, z0);
  c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], colors.top ?? "#fff");
  c.poly([[dd.x, dd.y], [cc.x, cc.y], [c0.x, c0.y], [d0.x, d0.y]], colors.left ?? "#888");
  c.poly([[b.x, b.y], [cc.x, cc.y], [c0.x, c0.y], [b0.x, b0.y]], colors.right ?? "#666");
  if (outline) {
    const pts = [[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [c0.x, c0.y], [d0.x, d0.y], [dd.x, dd.y]];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      c.line(p[0], p[1], q[0], q[1], outline);
    }
  }
}

function topFace(c, I, x0, y0, w, d, z, color, inner = null, innerInset = 0.12) {
  const a = I(x0, y0, z), b = I(x0 + w, y0, z), cc = I(x0 + w, y0 + d, z), dd = I(x0, y0 + d, z);
  c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], color);
  if (inner) {
    const x1 = x0 + innerInset, y1 = y0 + innerInset, x2 = x0 + w - innerInset, y2 = y0 + d - innerInset;
    const a2 = I(x1, y1, z), b2 = I(x2, y1, z), c2 = I(x2, y2, z), d2 = I(x1, y2, z);
    c.poly([[a2.x, a2.y], [b2.x, b2.y], [c2.x, c2.y], [d2.x, d2.y]], inner);
  }
}

function shadow(c, I, x0, y0, w, d, strength = 0.32) {
  const a = I(x0 - 0.06, y0 - 0.06, 0), b = I(x0 + w + 0.06, y0 - 0.06, 0);
  const cc = I(x0 + w + 0.06, y0 + d + 0.06, 0), dd = I(x0 - 0.06, y0 + d + 0.06, 0);
  c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], [10, 12, 18, Math.round(255 * strength)]);
}

function legs(c, I, positions, z = 0.42) {
  for (const [gx, gy] of positions) {
    box(c, I, gx, gy, 0.12, 0.12, 0, z, { top: shade(WOOD_LEG, 1.2), left: WOOD_LEG, right: shade(WOOD_LEG, 0.8) });
  }
}

/** Tabuado do tampo: placas alternadas ao longo de x. */
function plankTop(c, I, x0, y0, w, d, z, base = WOOD, planks = 4) {
  const step = w / planks;
  for (let i = 0; i < planks; i++) {
    const tone = i % 2 === 0 ? base : shade(base, 0.92);
    const a = I(x0 + i * step, y0, z), b = I(x0 + (i + 1) * step, y0, z);
    const cc = I(x0 + (i + 1) * step, y0 + d, z), dd = I(x0 + i * step, y0 + d, z);
    c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], tone);
    c.line(dd.x, dd.y, cc.x, cc.y, shade(base, 0.72));
  }
  const a = I(x0, y0, z), b = I(x0 + w, y0, z), cc = I(x0 + w, y0 + d, z), dd = I(x0, y0 + d, z);
  c.line(a.x, a.y, b.x, b.y, shade(base, 1.3));
  c.line(dd.x, dd.y, cc.x, cc.y, shade(base, 0.65));
}

function faceBooks(c, I, x0, y, z0, span, z1, seed = 1, width = 0.12) {
  let cursor = x0;
  let i = 0;
  while (cursor < x0 + span - 0.04) {
    const w = width + ((seed * 7 + i * 13) % 3) * 0.02;
    const h = 0.34 + ((seed * 5 + i * 11) % 4) * 0.05;
    const colors = ["#c9455f", "#3f6fd8", "#d8b13f", "#3fa06a", "#7a3fd0", "#d05f3f", "#2f9e8f", "#b23a4a"];
    const tone = colors[(seed + i) % colors.length];
    const a = I(cursor, y, z0), b = I(Math.min(cursor + w, x0 + span), y, z0);
    const cc2 = I(Math.min(cursor + w, x0 + span), y, Math.min(z0 + h, z1)), dd = I(cursor, y, Math.min(z0 + h, z1));
    c.poly([[a.x, a.y], [b.x, b.y], [cc2.x, cc2.y], [dd.x, dd.y]], tone);
    c.line(b.x, b.y, cc2.x, cc2.y, shade(tone, 0.7));
    c.line(a.x, a.y, dd.x, dd.y, shade(tone, 1.2));
    cursor += w + 0.015;
    i++;
  }
}

/* ------------------------------------------------------------------ */
/* Móveis                                                               */
/* ------------------------------------------------------------------ */

export const FURNITURE = [];

function addFurniture(def) {
  FURNITURE.push(def);
  return def;
}

/* --- mesa de trading 2x2 --- */
addFurniture({
  id: "desk_trading",
  name: "Mesa de Trading",
  subcategory: "desks",
  tags: ["desk", "workstation", "madeira"],
  build: () => makeSprite({ w: 2, d: 2, h: 0.66, pad: 3, top: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 2, 2);
    legs(c, I, [[0.06, 0.06], [1.82, 0.06], [0.06, 1.82], [1.82, 1.82]], 0.42);
    // painel frontal (frente para a câmera)
    const a = I(0.1, 1.86, 0.42), b = I(1.9, 1.86, 0.42), cc = I(1.9, 1.86, 0), dd = I(0.1, 1.86, 0);
    c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], WOOD_DARK);
    for (let x = 0.2; x < 1.9; x += 0.25) {
      const p = I(x, 1.86, 0.4), q = I(x, 1.86, 0.03);
      c.line(p.x, p.y, q.x, q.y, shade(WOOD_DARK, 1.18));
    }
    // gaveteiro à direita (puxadores na face frontal)
    box(c, I, 1.45, 0.25, 0.5, 0.6, 0, 0.5, { top: WOOD_LIGHT, left: shade(WOOD_DARK, 1.05), right: WOOD_DARK });
    for (const z of [0.34, 0.16]) {
      const h1 = I(1.56, 0.85, z), h2 = I(1.82, 0.85, z);
      c.line(h1.x, h1.y, h2.x, h2.y, METAL_LIGHT);
    }
    // tampo
    plankTop(c, I, 0, 0, 2, 2, 0.62, WOOD, 5);
    topFace(c, I, 0.04, 0.04, 1.92, 1.92, 0.66, shade(WOOD, 1.04));
    plankTop(c, I, 0.08, 0.08, 1.84, 1.84, 0.67, shade(WOOD, 1.08), 5);
    // passa-cabo
    topFace(c, I, 1.35, 0.35, 0.24, 0.24, 0.675, "#241a12");
  }),
  notes: "Mesa principal de estação. Placa de nome é desenhada pelo renderer sobre o painel frontal.",
});

/* --- cadeira de escritório --- */
addFurniture({
  id: "chair_office",
  name: "Cadeira de Escritório",
  subcategory: "chairs",
  tags: ["chair", "seat"],
  build: () => makeSprite({ w: 1, d: 1, h: 1.15, pad: 2 }, (c, I) => {
    shadow(c, I, 0.12, 0.12, 0.76, 0.76, 0.25);
    // base estrela
    const base = I(0.5, 0.5, 0);
    for (const [dx, dy] of [[-14, -3], [14, 3], [-3, 14], [3, -14], [10, -10]]) {
      c.line(base.x, base.y, base.x + dx, base.y + dy, METAL_DARK);
      c.px(base.x + dx, base.y + dy, "#2b2f38");
    }
    const pole = I(0.5, 0.5, 0.22);
    c.rect(pole.x - 1, pole.y, 2, I(0.5, 0.5, 0.48).y - pole.y, METAL_DARK);
    // assento
    topFace(c, I, 0.14, 0.14, 0.72, 0.72, 0.5, CUSHION_DARK, shade(CUSHION_DARK, 0.8), 0.1);
    box(c, I, 0.12, 0.12, 0.76, 0.76, 0.42, 0.52, { top: shade(CUSHION, 1.05), left: CUSHION, right: CUSHION_DARK });
    // encosto
    box(c, I, 0.16, 0.16, 0.68, 0.12, 0.52, 1.1, { top: shade(CUSHION, 1.1), left: CUSHION, right: CUSHION_DARK });
    const back = I(0.5, 0.22, 0.9);
    c.rect(back.x - 8, back.y - 1, 16, 2, shade(CUSHION_DARK, 0.85));
    // braços
    box(c, I, 0.1, 0.3, 0.08, 0.4, 0.5, 0.72, { top: METAL_LIGHT, left: METAL, right: METAL_DARK });
    box(c, I, 0.82, 0.3, 0.08, 0.4, 0.5, 0.72, { top: METAL_LIGHT, left: METAL, right: METAL_DARK });
  }),
  notes: "Cadeira padrão da estação; assento azul combina com os agentes.",
});

/* --- sofá 2x1 --- */
addFurniture({
  id: "sofa",
  name: "Sofá",
  subcategory: "lounge",
  tags: ["sofa", "lounge"],
  build: () => makeSprite({ w: 2, d: 1, h: 0.95, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 2, 1);
    legs(c, I, [[0.1, 0.1], [1.78, 0.1], [0.1, 0.78], [1.78, 0.78]], 0.2);
    // base
    box(c, I, 0.04, 0.04, 1.92, 0.92, 0.18, 0.5, { top: shade(CUSHION, 0.9), left: shade(CUSHION, 0.75), right: shade(CUSHION_DARK, 0.95) });
    // assento + almofadas
    topFace(c, I, 0.08, 0.08, 0.86, 0.84, 0.52, shade(CUSHION, 1.08), shade(CUSHION, 0.95), 0.14);
    topFace(c, I, 1.06, 0.08, 0.86, 0.84, 0.52, shade(CUSHION, 1.08), shade(CUSHION, 0.95), 0.14);
    // encosto alto no fundo
    box(c, I, 0.04, 0.04, 1.92, 0.26, 0.5, 0.98, { top: shade(CUSHION, 1.15), left: CUSHION, right: CUSHION_DARK });
    // braços
    box(c, I, 0.04, 0.04, 0.2, 0.92, 0.5, 0.78, { top: shade(CUSHION, 1.2), left: shade(CUSHION, 1.05), right: CUSHION_DARK });
    box(c, I, 1.76, 0.04, 0.2, 0.92, 0.5, 0.78, { top: shade(CUSHION, 1.2), left: CUSHION, right: CUSHION_DARK });
  }),
});

/* --- mesa de centro 2x1 --- */
addFurniture({
  id: "coffee_table",
  name: "Mesa de Centro",
  subcategory: "lounge",
  tags: ["table", "lounge"],
  build: () => makeSprite({ w: 2, d: 1, h: 0.4, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 2, 1, 0.28);
    legs(c, I, [[0.1, 0.1], [1.78, 0.1], [0.1, 0.78], [1.78, 0.78]], 0.28);
    plankTop(c, I, 0.04, 0.04, 1.92, 0.92, 0.3, WOOD_DARK, 4);
    box(c, I, 0.0, 0.0, 2, 1, 0.3, 0.36, { top: shade(WOOD, 1.0), left: WOOD, right: WOOD_DARK });
    // revista + caneca
    topFace(c, I, 1.24, 0.2, 0.42, 0.3, 0.37, "#d8d2c4", "#b23a4a", 0.08);
    const mug = I(0.45, 0.55, 0.37);
    c.rect(mug.x - 2, mug.y - 5, 5, 5, "#e8eef8");
    c.rect(mug.x - 2, mug.y - 5, 5, 1, "#b9c2cc");
    c.px(mug.x + 3, mug.y - 4, "#e8eef8"); c.px(mug.x + 3, mug.y - 2, "#e8eef8");
    c.rect(mug.x - 1, mug.y - 6, 3, 1, "#5a3a22");
  }),
});

/* --- poltrona 1x1 --- */
addFurniture({
  id: "armchair",
  name: "Poltrona",
  subcategory: "lounge",
  tags: ["chair", "lounge"],
  build: () => makeSprite({ w: 1, d: 1, h: 0.9, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 1, 1, 0.3);
    legs(c, I, [[0.08, 0.08], [0.8, 0.08], [0.08, 0.8], [0.8, 0.8]], 0.16);
    box(c, I, 0.02, 0.02, 0.96, 0.96, 0.14, 0.46, { top: shade(CUSHION, 0.85), left: shade(CUSHION, 0.7), right: shade(CUSHION_DARK, 0.9) });
    topFace(c, I, 0.1, 0.1, 0.8, 0.8, 0.48, shade(CUSHION, 1.05), shade(CUSHION, 0.92), 0.12);
    box(c, I, 0.06, 0.06, 0.88, 0.2, 0.46, 0.86, { top: shade(CUSHION, 1.15), left: CUSHION, right: CUSHION_DARK });
    box(c, I, 0.06, 0.06, 0.18, 0.88, 0.46, 0.7, { top: shade(CUSHION, 1.2), left: shade(CUSHION, 1.05), right: CUSHION_DARK });
    box(c, I, 0.76, 0.06, 0.18, 0.88, 0.46, 0.7, { top: shade(CUSHION, 1.2), left: CUSHION, right: CUSHION_DARK });
  }),
});

/* --- estante 1x1 --- */
addFurniture({
  id: "bookshelf",
  name: "Estante",
  subcategory: "storage",
  tags: ["shelf", "storage", "books"],
  build: () => makeSprite({ w: 1, d: 1, h: 1.7, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 1, 1, 0.3);
    box(c, I, 0, 0, 1, 1, 0, 1.7, { top: shade(WOOD_DARK, 1.2), left: shade(WOOD_DARK, 0.92), right: shade(WOOD_DARK, 0.78) });
    // frente aberta na face +y com prateleiras
    for (let s = 0; s < 4; s++) {
      const z = 0.36 + s * 0.38;
      const a = I(0.08, 1.0, z), b = I(0.92, 1.0, z);
      c.line(a.x, a.y, b.x, b.y, shade(WOOD_LIGHT, 1.05));
      faceBooks(c, I, 0.09, 1.001, z + 0.02, 0.82, z + 0.34, s + 2, 0.11);
    }
    // textura lateral
    const side = I(1.0, 0.5, 0);
    for (let z = 0.1; z < 1.6; z += 0.22) {
      const p = I(1.0, 0.14, z), q = I(1.0, 0.86, z);
      c.line(p.x, p.y, q.x, q.y, shade(WOOD_DARK, 0.7));
    }
    c.rect(side.x - 3, side.y - 1, 6, 2, shade(WOOD_LIGHT, 1.1));
  }),
});

/* --- armário 1x1 --- */
addFurniture({
  id: "cabinet",
  name: "Armário",
  subcategory: "storage",
  tags: ["cabinet", "storage"],
  build: () => makeSprite({ w: 1, d: 1, h: 1.3, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 1, 1, 0.3);
    box(c, I, 0, 0, 1, 1, 0, 1.3, { top: shade(WOOD, 1.05), left: WOOD, right: WOOD_DARK });
    // portas na face +y
    const a = I(0.06, 1.0, 1.22), b = I(0.94, 1.0, 1.22), cc = I(0.94, 1.0, 0.06), dd = I(0.06, 1.0, 0.06);
    c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], shade(WOOD, 1.12));
    const mid = I(0.5, 1.0, 0.06), midTop = I(0.5, 1.0, 1.22);
    c.line(mid.x, mid.y, midTop.x, midTop.y, shade(WOOD_DARK, 0.8));
    c.rect(mid.x - 3, mid.y - 12, 3, 5, METAL_LIGHT);
    c.rect(mid.x + 1, mid.y - 12, 3, 5, METAL_LIGHT);
  }),
});

/* --- quadro branco 2x1 --- */
addFurniture({
  id: "whiteboard",
  name: "Quadro Branco",
  subcategory: "decor",
  tags: ["board", "wall", "planning"],
  build: () => makeSprite({ w: 2, d: 0.2, h: 1.5, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0.1, 0, 1.8, 0.2, 0.22);
    // pés
    for (const x of [0.2, 1.6]) {
      const p0 = I(x, 0.1, 0), p1 = I(x, 0.1, 1.25);
      c.rect(p0.x - 1, p0.y - 26, 2, 26, METAL);
      c.rect(p0.x - 4, p0.y - 2, 8, 2, METAL_DARK);
    }
    // painel
    const a = I(0.06, 0.12, 1.5), b = I(1.94, 0.12, 1.5), cc = I(1.94, 0.12, 0.5), dd = I(0.06, 0.12, 0.5);
    c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], "#dfe7f2");
    c.poly([[a.x, a.y - 1], [b.x, b.y - 1], [b.x, b.y + 1], [a.x, a.y + 1]], "#8d98a8");
    // rabiscos (gráfico)
    const base = I(0.2, 0.12, 0.62);
    const line = (pts, color) => { for (let i = 0; i < pts.length - 1; i++) c.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], color); };
    line([[base.x, base.y], [base.x + 24, base.y - 6], [base.x + 48, base.y - 2], [base.x + 78, base.y - 14]], "#2f6fd0");
    line([[base.x + 10, base.y + 24], [base.x + 30, base.y + 14], [base.x + 55, base.y + 20], [base.x + 80, base.y + 6]], "#3fa06a");
    c.rect(base.x + 6, base.y - 26, 10, 3, "#d05f3f");
    c.rect(base.x + 22, base.y - 22, 14, 3, "#d8b13f");
    // bandeja + marcadores
    const t0 = I(0.06, 0.14, 0.46), t1 = I(1.94, 0.14, 0.46);
    c.rect(t0.x, t0.y, t1.x - t0.x, 2, METAL_DARK);
    c.rect(t0.x + 14, t0.y - 3, 10, 3, "#b23a4a");
  }),
});

/* --- mesa de reunião 3x2 --- */
addFurniture({
  id: "meeting_table",
  name: "Mesa de Reunião",
  subcategory: "tables",
  tags: ["table", "meeting"],
  build: () => makeSprite({ w: 3, d: 2, h: 0.62, pad: 3, top: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 3, 2);
    legs(c, I, [[0.2, 0.2], [2.68, 0.2], [0.2, 1.68], [2.68, 1.68]], 0.46);
    // tampo com cantos chanfrados
    const z = 0.58, r = 0.28;
    const pts = [
      I(0 + r, 0, z), I(3 - r, 0, z), I(3, 0 + r, z), I(3, 2 - r, z),
      I(3 - r, 2, z), I(0 + r, 2, z), I(0, 2 - r, z), I(0, 0 + r, z),
    ];
    c.poly(pts.map((p) => [p.x, p.y]), WOOD_DARK);
    const inner = pts.map((p) => { const q = I(0, 0, z); return { x: q.x + (p.x - q.x) * 0.94, y: q.y + (p.y - q.y) * 0.94 }; });
    c.poly(inner.map((p) => [p.x, p.y]), shade(WOOD, 1.02));
    // papel + caneca + centro de mesa
    topFace(c, I, 0.5, 0.55, 0.5, 0.36, 0.6, "#e8eef8", null);
    topFace(c, I, 1.9, 0.7, 0.42, 0.32, 0.6, "#d8d2c4", null);
    const mug = I(1.2, 0.95, 0.6);
    c.rect(mug.x - 2, mug.y - 5, 4, 5, "#c9455f");
    // suporte central
    const hub = I(1.5, 1.0, 0.58);
    c.ellipse(hub.x, hub.y - 2, 6, 3, "#2a3140");
    c.rect(hub.x - 1, hub.y - 8, 2, 6, "#525a66");
  }),
});

/* --- mesa de sinuca 3x2 --- */
addFurniture({
  id: "pool_table",
  name: "Mesa de Sinuca",
  subcategory: "lounge",
  tags: ["pool", "lounge", "game"],
  build: () => makeSprite({ w: 3, d: 2, h: 0.85, pad: 3, top: 3, bottom: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 3, 2);
    // base de madeira
    box(c, I, 0.06, 0.06, 2.88, 1.88, 0, 0.62, { top: WOOD_DARK, left: shade(WOOD_DARK, 0.9), right: shade(WOOD_DARK, 0.72) });
    // trilhos
    box(c, I, 0, 0, 3, 2, 0.62, 0.8, { top: shade(WOOD, 0.95), left: WOOD_DARK, right: shade(WOOD_DARK, 0.8) });
    // feltro
    topFace(c, I, 0.18, 0.18, 2.64, 1.64, 0.81, FELT, shade(FELT, 0.88), 0.1);
    // caçapas
    for (const [gx, gy] of [[0.18, 0.18], [1.5, 0.18], [2.82, 0.18], [0.18, 1.82], [1.5, 1.82], [2.82, 1.82]]) {
      const p = I(gx, gy, 0.82);
      c.ellipse(p.x, p.y, 3, 2, "#1c241f");
    }
    // bolas
    const balls = [[1.15, 0.8, "#e8eef8"], [1.3, 0.95, "#d8b13f"], [1.0, 1.05, "#c9455f"], [1.45, 1.1, "#2f6fd0"], [1.2, 0.65, "#1b1f2b"]];
    for (const [gx, gy, color] of balls) {
      const p = I(gx, gy, 0.83);
      c.circle(p.x, p.y, 2, color);
      c.px(p.x - 1, p.y - 1, "#ffffff");
    }
    // tacos
    const t1 = I(0.5, 1.5, 0.86), t2 = I(2.4, 1.62, 0.86);
    c.line(t1.x, t1.y, t1.x + 34, t1.y - 14, "#c9a06a");
    c.line(t2.x, t2.y, t2.x - 30, t2.y + 12, "#c9a06a");
  }),
});

/* --- balcão/copa 2x1 --- */
addFurniture({
  id: "counter",
  name: "Balcão da Copa",
  subcategory: "kitchen",
  tags: ["kitchen", "counter"],
  build: () => makeSprite({ w: 2, d: 1, h: 0.95, pad: 2, top: 3 }, (c, I) => {
    shadow(c, I, 0, 0, 2, 1, 0.3);
    box(c, I, 0.04, 0.04, 1.92, 0.92, 0, 0.8, { top: shade(WOOD_DARK, 1.05), left: WOOD_DARK, right: shade(WOOD_DARK, 0.78) });
    // portas
    for (const x of [0.12, 1.0]) {
      const a = I(x, 0.96, 0.72), b = I(x + 0.8, 0.96, 0.72), cc = I(x + 0.8, 0.96, 0.08), dd = I(x, 0.96, 0.08);
      c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], shade(WOOD, 1.0));
      c.poly([[a.x, a.y], [b.x, b.y], [b.x, b.y + 1], [a.x, a.y + 1]], shade(WOOD, 1.25));
      const h = I(x + 0.42, 0.96, 0.42);
      c.rect(h.x - 3, h.y - 1, 3, 5, METAL_LIGHT);
    }
    // tampo
    box(c, I, 0, 0, 2, 1, 0.8, 0.9, { top: "#d8d2c4", left: "#b9b2a2", right: "#948d7e" });
    // itens sobre o balcão: cafeteira + xícaras
    box(c, I, 0.25, 0.2, 0.36, 0.36, 0.9, 1.18, { top: "#3a4150", left: "#2b303c", right: "#20242e" });
    const cup = I(0.3, 0.7, 0.9);
    c.rect(cup.x - 2, cup.y - 5, 5, 5, "#e8eef8");
    c.rect(cup.x - 2, cup.y - 5, 5, 1, "#b9c2cc");
    const cup2 = I(0.55, 0.75, 0.9);
    c.rect(cup2.x - 2, cup2.y - 5, 5, 5, "#c9455f");
  }),
});

/* --- pia 1x1 --- */
addFurniture({
  id: "sink",
  name: "Pia",
  subcategory: "kitchen",
  tags: ["kitchen", "sink"],
  build: () => makeSprite({ w: 1, d: 1, h: 0.95, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 1, 1, 0.3);
    box(c, I, 0.04, 0.04, 0.92, 0.92, 0, 0.8, { top: shade(WOOD_DARK, 1.05), left: WOOD_DARK, right: shade(WOOD_DARK, 0.78) });
    box(c, I, 0, 0, 1, 1, 0.8, 0.9, { top: "#c3ccd6", left: "#9aa4b0", right: "#77808c" });
    // cuba
    topFace(c, I, 0.16, 0.16, 0.68, 0.68, 0.91, "#5d666f", "#3a4150", 0.1);
    // torneira
    const f = I(0.5, 0.24, 0.9);
    c.rect(f.x - 1, f.y - 12, 2, 12, METAL_LIGHT);
    c.rect(f.x - 1, f.y - 13, 7, 2, METAL_LIGHT);
    c.px(f.x + 5, f.y - 12, "#8fd0ff");
  }),
});

/* --- frigobar 1x1 --- */
addFurniture({
  id: "fridge",
  name: "Frigobar",
  subcategory: "kitchen",
  tags: ["kitchen", "fridge"],
  build: () => makeSprite({ w: 1, d: 1, h: 1.75, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 1, 1, 0.3);
    box(c, I, 0.02, 0.02, 0.96, 0.96, 0, 1.62, { top: "#e8eef8", left: "#cfd6e0", right: "#aab2be" });
    // divisão das portas + puxadores
    const l1 = I(1.0, 0.5, 0.62), l2 = I(1.0, 0.5, 1.58);
    c.line(l1.x, l1.y, l2.x, l2.y, "#8d98a8");
    const h1 = I(1.0, 0.72, 1.25), h2 = I(1.0, 0.72, 0.5);
    c.rect(h1.x - 1, h1.y - 7, 3, 7, METAL_DARK);
    c.rect(h2.x - 1, h2.y - 6, 3, 6, METAL_DARK);
    // ímãs
    const m = I(1.0, 0.3, 1.35);
    c.px(m.x, m.y, "#c9455f"); c.px(m.x + 2, m.y + 1, "#d8b13f");
  }),
});

/* --- planta 1x1 --- */
addFurniture({
  id: "plant",
  name: "Planta em Vaso",
  subcategory: "decor",
  tags: ["plant", "decor"],
  build: () => makeSprite({ w: 1, d: 1, h: 1.2, pad: 3, top: 4 }, (c, I) => {
    shadow(c, I, 0.15, 0.15, 0.7, 0.7, 0.28);
    // vaso
    box(c, I, 0.22, 0.22, 0.56, 0.56, 0, 0.34, { top: shade(POT, 1.12), left: POT, right: POT_DARK });
    topFace(c, I, 0.26, 0.26, 0.48, 0.48, 0.35, "#3a2a20", null);
    // folhas
    const center = I(0.5, 0.5, 0.5);
    c.ellipse(center.x, center.y - 10, 9, 8, LEAF_DARK);
    c.ellipse(center.x - 5, center.y - 14, 6, 6, LEAF);
    c.ellipse(center.x + 5, center.y - 13, 6, 6, LEAF);
    c.ellipse(center.x, center.y - 17, 5, 5, LEAF_LIGHT);
    c.ellipse(center.x - 8, center.y - 8, 4, 4, LEAF);
    c.ellipse(center.x + 8, center.y - 8, 4, 4, LEAF_DARK);
    c.px(center.x - 2, center.y - 20, "#8fe0a8");
  }),
});

/* --- planta alta 1x1 --- */
addFurniture({
  id: "plant_tall",
  name: "Planta Alta",
  subcategory: "decor",
  tags: ["plant", "decor"],
  build: () => makeSprite({ w: 1, d: 1, h: 1.75, pad: 3, top: 4 }, (c, I) => {
    shadow(c, I, 0.16, 0.16, 0.68, 0.68, 0.3);
    box(c, I, 0.24, 0.24, 0.52, 0.52, 0, 0.4, { top: shade(POT, 1.12), left: POT, right: POT_DARK });
    // tronco
    const t = I(0.5, 0.5, 0.4);
    c.line(t.x, t.y, t.x, t.y - 26, "#5a3a22");
    // folhas grandes
    const top = t.y - 26;
    const leaf = (dx, dy, color) => c.ellipse(t.x + dx, top + dy, 7, 5, color);
    leaf(-8, -4, LEAF); leaf(8, -6, LEAF); leaf(-5, -12, LEAF_LIGHT); leaf(6, -14, LEAF_DARK);
    leaf(0, -18, LEAF); leaf(-10, 2, LEAF_DARK); leaf(10, -2, LEAF_LIGHT);
    c.px(t.x, top - 22, "#8fe0a8");
  }),
});

/* --- luminária 1x1 --- */
addFurniture({
  id: "floor_lamp",
  name: "Luminária",
  subcategory: "decor",
  tags: ["lamp", "light", "decor"],
  build: () => makeSprite({ w: 1, d: 1, h: 1.6, pad: 3, top: 3, bottom: 3 }, (c, I) => {
    shadow(c, I, 0.3, 0.3, 0.4, 0.4, 0.22);
    const base = I(0.5, 0.5, 0);
    c.ellipse(base.x, base.y, 9, 4, "#2b303c");
    c.ellipse(base.x, base.y - 1, 9, 4, "#3a4150");
    c.line(base.x, base.y - 2, base.x, base.y - 34, METAL_DARK);
    c.line(base.x + 1, base.y - 2, base.x + 1, base.y - 34, "#6a7480");
    // cúpula
    const shadeTop = base.y - 42;
    c.poly([[base.x - 4, shadeTop], [base.x + 4, shadeTop], [base.x + 11, shadeTop + 14], [base.x - 11, shadeTop + 14]], "#d8c07a");
    c.poly([[base.x - 11, shadeTop + 14], [base.x + 11, shadeTop + 14], [base.x + 11, shadeTop + 16], [base.x - 11, shadeTop + 16]], "#b39b56");
    c.rect(base.x - 10, shadeTop + 16, 20, 1, "#fff2b8");
    // brilho
    c.ellipse(base.x, base.y, 16, 7, [255, 226, 140, 26]);
    c.ellipse(base.x, base.y - 8, 12, 10, [255, 226, 140, 14]);
  }),
});

/* --- divisória 2x1 --- */
addFurniture({
  id: "partition",
  name: "Divisória",
  subcategory: "decor",
  tags: ["partition", "divider"],
  build: () => makeSprite({ w: 2, d: 0.4, h: 1.05, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0, 0, 2, 0.4, 0.24);
    box(c, I, 0.01, 0.01, 1.98, 0.38, 0, 0.98, { top: "#4a5266", left: "#3d4456", right: "#323848" });
    // tecido
    for (let x = 0.1; x < 1.95; x += 0.18) {
      const p = I(x, 0.4, 0.08), q = I(x, 0.4, 0.92);
      c.line(p.x, p.y, q.x, q.y, "#565f76");
    }
    // trilho
    box(c, I, 0, 0, 2, 0.4, 0.98, 1.06, { top: WOOD_LIGHT, left: WOOD, right: WOOD_DARK });
  }),
});

/* --- bebedouro 1x1 --- */
addFurniture({
  id: "water_cooler",
  name: "Bebedouro",
  subcategory: "kitchen",
  tags: ["kitchen", "water"],
  build: () => makeSprite({ w: 1, d: 1, h: 1.5, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0.15, 0.15, 0.7, 0.7, 0.28);
    box(c, I, 0.16, 0.16, 0.68, 0.68, 0, 0.8, { top: "#e8eef8", left: "#cfd6e0", right: "#aab2be" });
    // torneiras
    const f = I(0.5, 0.84, 0.55);
    c.rect(f.x - 4, f.y - 1, 3, 2, "#2f6fd0");
    c.rect(f.x + 1, f.y - 1, 3, 2, "#c9455f");
    // galão
    box(c, I, 0.2, 0.2, 0.6, 0.6, 0.8, 1.15, { top: "#9fd8ff", left: "#6fb8f0", right: "#4a90d0" });
    topFace(c, I, 0.34, 0.34, 0.32, 0.32, 1.16, "#c9ecff", null);
  }),
});

/* --- mesa lateral 1x1 --- */
addFurniture({
  id: "side_table",
  name: "Mesa Lateral",
  subcategory: "tables",
  tags: ["table", "decor"],
  build: () => makeSprite({ w: 1, d: 1, h: 0.5, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0.1, 0.1, 0.8, 0.8, 0.24);
    const base = I(0.5, 0.5, 0);
    c.ellipse(base.x, base.y, 8, 3, shade(WOOD_LEG, 0.8));
    c.ellipse(base.x, base.y - 1, 8, 3, WOOD_LEG);
    c.rect(base.x - 2, base.y - 11, 4, 10, WOOD_DARK);
    c.rect(base.x - 2, base.y - 11, 1, 10, shade(WOOD_DARK, 1.35));
    topFace(c, I, 0.05, 0.05, 0.9, 0.9, 0.44, shade(WOOD, 1.05), null, 0);
    box(c, I, 0.02, 0.02, 0.96, 0.96, 0.44, 0.5, { top: WOOD_LIGHT, left: WOOD, right: WOOD_DARK });
  }),
});

/* ------------------------------------------------------------------ */
/* Props                                                                */
/* ------------------------------------------------------------------ */

export const PROPS = [];

function addProp(def) {
  PROPS.push(def);
  return def;
}

addProp({
  id: "prop_mug",
  name: "Caneca",
  build: () => makeSprite({ w: 0.3, d: 0.3, h: 0.34, pad: 2, top: 2 }, (c, I) => {
    const b = I(0, 0, 0), t = I(0.3, 0.3, 0.3);
    c.ellipse((b.x + t.x) / 2, b.y - 1, 4, 2, "#2b303c");
    c.rect(t.x - 4, t.y + 1, 7, 6, "#e8eef8");
    c.rect(t.x - 4, t.y + 1, 7, 1, "#b9c2cc");
    c.px(t.x + 4, t.y + 3, "#e8eef8"); c.px(t.x + 4, t.y + 5, "#e8eef8");
    c.rect(t.x - 3, t.y + 2, 5, 1, "#5a3a22");
  }),
});

addProp({
  id: "prop_papers",
  name: "Papéis",
  build: () => makeSprite({ w: 0.5, d: 0.4, h: 0.12, pad: 2, top: 2 }, (c, I) => {
    const p = I(0.25, 0.2, 0);
    c.poly([[p.x, p.y - 2], [p.x + 16, p.y + 6], [p.x, p.y + 14], [p.x - 16, p.y + 6]], "#dfe6f0");
    c.poly([[p.x, p.y - 4], [p.x + 16, p.y + 4], [p.x, p.y + 12], [p.x - 16, p.y + 4]], "#eef4ff");
    c.line(p.x - 8, p.y + 4, p.x + 8, p.y + 4, "#9aa4b0");
  }),
});

addProp({
  id: "prop_laptop",
  name: "Notebook",
  build: () => makeSprite({ w: 0.8, d: 0.6, h: 0.5, pad: 2, top: 2 }, (c, I) => {
    // base
    const a = I(0.4, 0.3, 0.06);
    c.poly([[a.x - 18, a.y], [a.x + 18, a.y], [a.x + 12, a.y + 12], [a.x - 24, a.y + 12]], "#3a4150");
    c.poly([[a.x - 15, a.y + 1], [a.x + 15, a.y + 1], [a.x + 10, a.y + 10], [a.x - 20, a.y + 10]], "#2b303c");
    // tela
    const s = I(0.4, 0.18, 0.12);
    c.poly([[s.x - 15, s.y], [s.x + 15, s.y], [s.x + 15, s.y - 24], [s.x - 15, s.y - 24]], "#20242e");
    c.poly([[s.x - 13, s.y - 2], [s.x + 13, s.y - 2], [s.x + 13, s.y - 22], [s.x - 13, s.y - 22]], "#4da3ff");
    c.rect(s.x - 6, s.y - 16, 12, 2, "#eaf2ff");
    c.rect(s.x - 4, s.y - 12, 8, 2, "#c9d6ee");
  }),
});

addProp({
  id: "prop_monitor",
  name: "Monitor",
  build: () => makeSprite({ w: 0.7, d: 0.5, h: 0.8, pad: 2, top: 2 }, (c, I) => {
    const base = I(0.35, 0.25, 0.02);
    c.ellipse(base.x, base.y, 8, 3, "#2b303c");
    c.rect(base.x - 1, base.y - 10, 3, 9, "#3a4150");
    c.poly([[base.x - 14, base.y - 10], [base.x + 14, base.y - 10], [base.x + 14, base.y - 34], [base.x - 14, base.y - 34]], "#20242e");
    c.poly([[base.x - 12, base.y - 12], [base.x + 12, base.y - 12], [base.x + 12, base.y - 32], [base.x - 12, base.y - 32]], "#2f6fd0");
    c.rect(base.x - 7, base.y - 26, 14, 1, "#8ce4a0");
    c.rect(base.x - 7, base.y - 22, 10, 1, "#eaf2ff");
  }),
});

addProp({
  id: "prop_plant_small",
  name: "Planta Pequena",
  build: () => makeSprite({ w: 0.5, d: 0.5, h: 0.55, pad: 2, top: 3 }, (c, I) => {
    shadow(c, I, 0, 0, 0.5, 0.5, 0.2);
    box(c, I, 0.1, 0.1, 0.3, 0.3, 0, 0.18, { top: shade(POT, 1.1), left: POT, right: POT_DARK });
    const p = I(0.25, 0.25, 0.2);
    c.ellipse(p.x, p.y - 6, 5, 5, LEAF);
    c.ellipse(p.x - 3, p.y - 9, 3, 3, LEAF_LIGHT);
    c.ellipse(p.x + 3, p.y - 8, 3, 3, LEAF_DARK);
  }),
});

addProp({
  id: "prop_bin",
  name: "Lixeira",
  build: () => makeSprite({ w: 0.6, d: 0.6, h: 0.75, pad: 2, top: 2 }, (c, I) => {
    shadow(c, I, 0.05, 0.05, 0.5, 0.5, 0.22);
    const b = I(0.3, 0.3, 0);
    c.ellipse(b.x, b.y, 9, 4, "#2b303c");
    c.rect(b.x - 9, b.y - 24, 18, 24, "#3a4150");
    c.rect(b.x - 9, b.y - 24, 18, 2, "#525a66");
    c.ellipse(b.x, b.y - 24, 9, 4, "#525a66");
    c.ellipse(b.x, b.y - 25, 7, 3, "#20242e");
  }),
});

addProp({
  id: "prop_book_stack",
  name: "Livros",
  build: () => makeSprite({ w: 0.5, d: 0.4, h: 0.28, pad: 2, top: 2 }, (c, I) => {
    const p = I(0.25, 0.2, 0);
    c.poly([[p.x - 14, p.y + 2], [p.x + 14, p.y - 4], [p.x + 14, p.y + 2], [p.x - 14, p.y + 8]], "#c9455f");
    c.poly([[p.x - 13, p.y - 1], [p.x + 13, p.y - 7], [p.x + 13, p.y - 1], [p.x - 13, p.y + 5]], "#3f6fd8");
    c.poly([[p.x - 12, p.y - 4], [p.x + 12, p.y - 10], [p.x + 12, p.y - 4], [p.x - 12, p.y + 2]], "#d8b13f");
    c.line(p.x - 10, p.y - 5, p.x + 10, p.y - 9, "#8a6f34");
  }),
});

addProp({
  id: "prop_pizza",
  name: "Caixa de Pizza",
  build: () => makeSprite({ w: 0.7, d: 0.7, h: 0.16, pad: 2, top: 2 }, (c, I) => {
    const p = I(0.35, 0.35, 0);
    c.poly([[p.x, p.y - 12], [p.x + 24, p.y], [p.x, p.y + 12], [p.x - 24, p.y]], "#c9a06a");
    c.poly([[p.x, p.y - 9], [p.x + 19, p.y], [p.x, p.y + 9], [p.x - 19, p.y]], "#d8b47c");
    c.rect(p.x - 6, p.y - 3, 12, 2, "#b23a4a");
  }),
});

/* ------------------------------------------------------------------ */
/* Pisos, paredes, decoração, UI                                        */
/* ------------------------------------------------------------------ */

export const FLOORS = [
  {
    id: "floor_office_a",
    name: "Piso Escritório A",
    build: () => {
      const c = new PixelCanvas(TILE_W, TILE_H);
      const cx = TILE_W / 2, cy = TILE_H / 2;
      c.diamond(cx, cy - 0.5, TILE_W, TILE_H + 1, "#111a2e");
      c.diamond(cx, cy - 0.5, TILE_W - 2, TILE_H - 2, "#0e1626");
      c.diamond(cx, cy - 0.5, TILE_W - 4, TILE_H - 4, "#101a2e");
      const n = (x, y) => { c.px(cx + x, cy + y, "#16203a"); };
      n(-14, 0); n(-6, 3); n(4, -1); n(12, 2); n(-2, 5); n(8, -3); n(-10, -2); n(16, 0);
      return { canvas: c, anchor: { x: TILE_W / 2, y: TILE_H / 2 }, width: TILE_W, height: TILE_H, footprint: { w: 1, d: 1 }, heightZ: 0 };
    },
  },
  {
    id: "floor_office_b",
    name: "Piso Escritório B",
    build: () => {
      const c = new PixelCanvas(TILE_W, TILE_H);
      const cx = TILE_W / 2, cy = TILE_H / 2;
      c.diamond(cx, cy - 0.5, TILE_W, TILE_H + 1, "#0d1424");
      c.diamond(cx, cy - 0.5, TILE_W - 2, TILE_H - 2, "#0b1220");
      c.diamond(cx, cy - 0.5, TILE_W - 4, TILE_H - 4, "#0c1424");
      const n = (x, y) => { c.px(cx + x, cy + y, "#121b30"); };
      n(-12, 2); n(-4, -1); n(6, 3); n(14, -2); n(0, 4); n(10, 1); n(-8, 5); n(18, -1);
      return { canvas: c, anchor: { x: TILE_W / 2, y: TILE_H / 2 }, width: TILE_W, height: TILE_H, footprint: { w: 1, d: 1 }, heightZ: 0 };
    },
  },
  {
    id: "floor_lounge_wood",
    name: "Piso Madeira (Lounge)",
    build: () => {
      const c = new PixelCanvas(TILE_W, TILE_H);
      const cx = TILE_W / 2, cy = TILE_H / 2;
      c.diamond(cx, cy - 0.5, TILE_W, TILE_H + 1, "#241a12");
      c.diamond(cx, cy - 0.5, TILE_W - 2, TILE_H - 2, "#33251a");
      c.diamond(cx, cy - 0.5, TILE_W - 4, TILE_H - 4, "#3a2a1d");
      c.line(cx - 18, cy, cx + 18, cy, "#452f1f");
      c.line(cx - 30, cy - 6, cx + 6, cy - 6, "#2b1e14");
      c.line(cx - 6, cy + 6, cx + 30, cy + 6, "#2b1e14");
      return { canvas: c, anchor: { x: TILE_W / 2, y: TILE_H / 2 }, width: TILE_W, height: TILE_H, footprint: { w: 1, d: 1 }, heightZ: 0 };
    },
  },
  {
    id: "floor_kitchen_tile",
    name: "Piso Copa",
    build: () => {
      const c = new PixelCanvas(TILE_W, TILE_H);
      const cx = TILE_W / 2, cy = TILE_H / 2;
      c.diamond(cx, cy - 0.5, TILE_W, TILE_H + 1, "#1c2632");
      c.diamond(cx, cy - 0.5, TILE_W - 2, TILE_H - 2, "#243040");
      c.diamond(cx, cy - 0.5, TILE_W - 8, TILE_H - 6, "#1f2a38");
      c.line(cx - 10, cy, cx + 10, cy, "#2c3a4c");
      return { canvas: c, anchor: { x: TILE_W / 2, y: TILE_H / 2 }, width: TILE_W, height: TILE_H, footprint: { w: 1, d: 1 }, heightZ: 0 };
    },
  },
];

export const WALLS = [
  {
    id: "wall_panel_tile",
    name: "Textura de Parede",
    build: () => {
      const c = new PixelCanvas(168, 128);
      c.rect(0, 0, 168, 128, "#111c30");
      for (let x = 0; x < 168; x += 24) {
        c.vline(x, 0, 128, "#15223a");
        c.vline(x + 1, 0, 128, "#17263f");
        c.vline(x + 12, 0, 128, "#0e1929");
      }
      c.rect(0, 0, 168, 6, "#182643");
      c.rect(0, 122, 168, 6, "#1d2d4e");
      const n = (x, y, color) => c.px(x, y, color);
      for (let i = 0; i < 40; i++) n((i * 37) % 168, 10 + ((i * 29) % 100), "#182742");
      return { canvas: c, anchor: { x: 0, y: 0 }, width: 168, height: 128, footprint: { w: 0, d: 0 }, heightZ: 0 };
    },
  },
  {
    id: "wall_trim",
    name: "Rodapé",
    build: () => {
      const c = new PixelCanvas(168, 12);
      c.rect(0, 0, 168, 12, "#1b2a46");
      c.rect(0, 0, 168, 2, "#2a3d63");
      c.rect(0, 2, 168, 1, "#16233c");
      return { canvas: c, anchor: { x: 0, y: 0 }, width: 168, height: 12, footprint: { w: 0, d: 0 }, heightZ: 0 };
    },
  },
];

export const DECOR = [];

function addDecor(def) {
  DECOR.push(def);
  return def;
}

addDecor({
  id: "rug_lounge",
  name: "Tapete",
  build: () => makeSprite({ w: 3, d: 3, h: 0.02, pad: 3 }, (c, I) => {
    const a = I(0, 0, 0.01), b = I(3, 0, 0.01), cc = I(3, 3, 0.01), dd = I(0, 3, 0.01);
    c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], "#4a3548");
    const e = I(0.2, 0.2, 0.012), f = I(2.8, 0.2, 0.012), g = I(2.8, 2.8, 0.012), h = I(0.2, 2.8, 0.012);
    c.poly([[e.x, e.y], [f.x, f.y], [g.x, g.y], [h.x, h.y]], "#5a4155");
    const i2 = I(0.45, 0.45, 0.014), j = I(2.55, 0.45, 0.014), k = I(2.55, 2.55, 0.014), l = I(0.45, 2.55, 0.014);
    c.poly([[i2.x, i2.y], [j.x, j.y], [k.x, k.y], [l.x, l.y]], "#6b4d64");
    // padrão
    for (const [gx, gy] of [[1.5, 0.5], [2.45, 1.5], [1.5, 2.45], [0.55, 1.5]]) {
      const p = I(gx, gy, 0.016);
      c.diamond(p.x, p.y, 18, 8, "#8a6480");
      c.diamond(p.x, p.y, 10, 4, "#5a4155");
    }
  }),
});

addDecor({
  id: "painting_city",
  name: "Quadro Cidade",
  build: () => {
    const c = new PixelCanvas(38, 30);
    c.rect(0, 0, 38, 30, "#2a3d63");
    c.rect(2, 2, 34, 26, "#101a2e");
    c.rect(4, 12, 5, 14, "#243a5e"); c.rect(5, 14, 1, 1, "#ffd76a"); c.rect(7, 16, 1, 1, "#ffd76a");
    c.rect(10, 8, 6, 18, "#2e4a74"); c.rect(11, 10, 1, 1, "#ffd76a"); c.rect(13, 13, 1, 1, "#8fd0ff");
    c.rect(17, 14, 4, 12, "#243a5e");
    c.rect(22, 6, 7, 20, "#35507e"); c.rect(24, 9, 1, 1, "#ffd76a"); c.rect(26, 12, 1, 1, "#ffd76a");
    c.rect(30, 16, 4, 10, "#243a5e");
    c.rect(4, 24, 30, 4, "#0a1120");
    return { canvas: c, anchor: { x: 19, y: 29 }, width: 38, height: 30, footprint: { w: 0, d: 0 }, heightZ: 0 };
  },
});

addDecor({
  id: "painting_chart",
  name: "Quadro Gráfico",
  build: () => {
    const c = new PixelCanvas(38, 30);
    c.rect(0, 0, 38, 30, "#3a2a10");
    c.rect(2, 2, 34, 26, "#0d1424");
    c.line(5, 22, 12, 18, "#3fa06a");
    c.line(12, 18, 19, 20, "#3fa06a");
    c.line(19, 20, 26, 12, "#3fa06a");
    c.line(26, 12, 33, 8, "#8ce4a0");
    c.line(5, 25, 33, 25, "#2a3d63");
    c.line(5, 6, 5, 25, "#2a3d63");
    c.rect(8, 16, 2, 3, "#ffd76a");
    return { canvas: c, anchor: { x: 19, y: 29 }, width: 38, height: 30, footprint: { w: 0, d: 0 }, heightZ: 0 };
  },
});

addDecor({
  id: "wall_clock",
  name: "Relógio de Parede",
  build: () => {
    const c = new PixelCanvas(26, 26);
    c.circle(13, 13, 12, "#2a3d63");
    c.circle(13, 13, 10, "#0d1424");
    for (const [x, y] of [[13, 4], [13, 22], [4, 13], [22, 13]]) c.px(x, y, "#7f93b8");
    c.line(13, 13, 13, 7, "#eaf2ff");
    c.line(13, 13, 18, 15, "#eaf2ff");
    c.px(13, 13, "#c9455f");
    return { canvas: c, anchor: { x: 13, y: 25 }, width: 26, height: 26, footprint: { w: 0, d: 0 }, heightZ: 0 };
  },
});

addDecor({
  id: "hanging_plant",
  name: "Planta Pendurada",
  build: () => {
    const c = new PixelCanvas(34, 40);
    c.rect(0, 0, 34, 3, "#525a66");
    c.rect(15, 3, 1, 5, "#525a66");
    c.poly([[11, 8], [23, 8], [21, 16], [13, 16]], POT);
    c.poly([[13, 16], [21, 16], [19, 18], [15, 18]], POT_DARK);
    const leaf = (x, y, color) => c.ellipse(x, y, 4, 6, color);
    leaf(12, 24, LEAF); leaf(20, 26, LEAF_DARK); leaf(15, 32, LEAF_LIGHT); leaf(24, 34, LEAF); leaf(9, 34, LEAF_DARK);
    c.px(14, 22, "#8fe0a8");
    return { canvas: c, anchor: { x: 17, y: 2 }, width: 34, height: 40, footprint: { w: 0, d: 0 }, heightZ: 0 };
  },
});

/* ------------------------------------------------------------------ */
/* UI (placas)                                                          */
/* ------------------------------------------------------------------ */

export const UI = [
  {
    id: "nameplate_wood",
    name: "Placa de Madeira",
    build: () => {
      const c = new PixelCanvas(104, 30);
      c.rect(0, 0, 104, 30, "#14161f");
      c.rect(1, 1, 102, 28, WOOD);
      c.rect(2, 2, 100, 26, shade(WOOD, 1.08));
      c.rect(3, 3, 98, 24, "#3a2a1d");
      c.rect(3, 3, 98, 2, shade(WOOD, 0.55));
      c.rect(3, 25, 98, 2, shade(WOOD, 0.7));
      for (let x = 6; x < 100; x += 16) c.vline(x, 5, 20, "#33251a");
      return { canvas: c, anchor: { x: 52, y: 15 }, width: 104, height: 30, footprint: { w: 0, d: 0 }, heightZ: 0 };
    },
  },
  {
    id: "station_plate",
    name: "Placa de Estação",
    build: () => {
      const c = new PixelCanvas(124, 48);
      c.rect(0, 0, 124, 48, "#14161f");
      c.rect(1, 1, 122, 46, WOOD_DARK);
      c.rect(2, 2, 120, 44, shade(WOOD, 0.95));
      c.rect(2, 2, 120, 2, shade(WOOD, 1.25));
      // visor (nome do ativo)
      c.rect(7, 6, 110, 24, "#060b16");
      c.rect(8, 7, 108, 22, "#0d1a30");
      c.rect(8, 7, 108, 1, "#1c2a48");
      // rodapé (tipo, payout, valor)
      c.rect(7, 32, 110, 10, "#0b1226");
      c.rect(7, 32, 110, 1, "#2a3d63");
      for (const [x, y] of [[4, 4], [119, 4], [4, 43], [119, 43]]) c.px(x, y, METAL_LIGHT);
      return { canvas: c, anchor: { x: 62, y: 24 }, width: 124, height: 48, footprint: { w: 0, d: 0 }, heightZ: 0 };
    },
  },
  {
    id: "badge_small",
    name: "Selo Pequeno",
    build: () => {
      const c = new PixelCanvas(56, 16);
      c.rect(0, 0, 56, 16, "#14161f");
      c.rect(1, 1, 54, 14, "#16264a");
      c.rect(1, 1, 54, 1, "#3b5da8");
      c.rect(1, 14, 54, 1, "#0b1226");
      return { canvas: c, anchor: { x: 28, y: 8 }, width: 56, height: 16, footprint: { w: 0, d: 0 }, heightZ: 0 };
    },
  },
  {
    id: "intel_board",
    name: "Painel Central",
    build: () => {
      const c = new PixelCanvas(196, 92);
      c.rect(0, 0, 196, 92, "#14161f");
      c.rect(1, 1, 194, 90, "#2a3d63");
      c.rect(2, 2, 192, 88, "#081120");
      c.rect(3, 3, 190, 12, "#0d1a30");
      c.rect(3, 16, 190, 1, "#2a3d63");
      for (let i = 0; i < 6; i++) {
        c.rect(8 + i * 31, 22, 27, 34, "#0d1a30");
        c.rect(8 + i * 31, 22, 27, 1, "#1c2a48");
        c.rect(10 + i * 31, 26, 6, 3, i % 2 ? "#3fa06a" : "#4da3ff");
        c.rect(10 + i * 31, 32, 20, 2, "#243a5e");
        c.rect(10 + i * 31, 36, 14, 2, "#1c2a48");
      }
      c.rect(8, 62, 180, 22, "#0d1a30");
      c.line(14, 78, 40, 70, "#3fa06a");
      c.line(40, 70, 70, 74, "#3fa06a");
      c.line(70, 74, 104, 66, "#8ce4a0");
      c.line(104, 66, 140, 70, "#8ce4a0");
      c.line(140, 70, 180, 64, "#8ce4a0");
      return { canvas: c, anchor: { x: 98, y: 46 }, width: 196, height: 92, footprint: { w: 0, d: 0 }, heightZ: 0 };
    },
  },
];

export const ALL = { FURNITURE, PROPS, FLOORS, WALLS, DECOR, UI };
