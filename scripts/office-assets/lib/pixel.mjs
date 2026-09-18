/**
 * TraceCom Office · Pixel Art Toolkit
 *
 * Canvas RGBA em memória + encoder PNG (sem dependências externas) + primitivas
 * de desenho em pixel art (rects, polígonos, diamantes isométricos, sombras).
 *
 * Licença: MIT (mesma do projeto). Toda a arte gerada por este script é original.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/* ------------------------------------------------------------------ */
/* Cores                                                                */
/* ------------------------------------------------------------------ */

export function parseColor(color) {
  if (Array.isArray(color)) return [color[0] | 0, color[1] | 0, color[2] | 0, color.length > 3 ? color[3] : 255];
  const hex = String(color).replace("#", "");
  if (hex.length === 3) {
    return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), 255];
  }
  if (hex.length === 6) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255];
  if (hex.length === 8) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8), 16)];
  throw new Error(`cor inválida: ${color}`);
}

/** Clareia/escurece mantendo alpha. factor > 1 clareia, < 1 escurece. */
export function shade(color, factor) {
  const [r, g, b, a = 255] = parseColor(color);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return [clamp(r * factor), clamp(g * factor), clamp(b * factor), a];
}

export function mix(colorA, colorB, t = 0.5) {
  const a = parseColor(colorA), b = parseColor(colorB);
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round((a[3] ?? 255) + ((b[3] ?? 255) - (a[3] ?? 255)) * t),
  ];
}

export function withAlpha(color, alpha) {
  const c = parseColor(color);
  return [c[0], c[1], c[2], Math.round(255 * alpha)];
}

/* ------------------------------------------------------------------ */
/* Canvas                                                               */
/* ------------------------------------------------------------------ */

export class PixelCanvas {
  constructor(width, height, fill = null) {
    this.width = width | 0;
    this.height = height | 0;
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
    if (fill) this.rect(0, 0, this.width, this.height, fill);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Pixel opaco (source-over com alpha). */
  px(x, y, color) {
    x = Math.round(x); y = Math.round(y);
    if (!this.inBounds(x, y)) return this;
    const [r, g, b, a = 255] = Array.isArray(color) ? color : parseColor(color);
    if (a >= 255) {
      const i = (y * this.width + x) * 4;
      this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255;
      return this;
    }
    if (a <= 0) return this;
    const i = (y * this.width + x) * 4;
    const sa = a / 255, da = this.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    this.data[i] = Math.round((r * sa + this.data[i] * da * (1 - sa)) / (oa || 1));
    this.data[i + 1] = Math.round((g * sa + this.data[i + 1] * da * (1 - sa)) / (oa || 1));
    this.data[i + 2] = Math.round((b * sa + this.data[i + 2] * da * (1 - sa)) / (oa || 1));
    this.data[i + 3] = Math.round(oa * 255);
    return this;
  }

  rect(x, y, w, h, color) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, color);
    return this;
  }

  hline(x, y, w, color) { return this.rect(x, y, w, 1, color); }
  vline(x, y, h, color) { return this.rect(x, y, 1, h, color); }

  /** Contorno de caixa alinhada (1px). */
  box(x, y, w, h, color) {
    this.hline(x, y, w, color); this.hline(x, y + h - 1, w, color);
    this.vline(x, y, h, color); this.vline(x + w - 1, y, h, color);
    return this;
  }

  /** Linha Bresenham com espessura 1 (pixel art). */
  line(x0, y0, x1, y1, color) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Polígono preenchido (scanline, coordenadas float arredondadas). */
  poly(points, color) {
    if (!points.length) return this;
    const pts = points.map(([x, y]) => [Math.round(x), Math.round(y)]);
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
        if (y0 === y1) continue;
        const yMin = Math.min(y0, y1), yMax = Math.max(y0, y1);
        if (y < yMin || y >= yMax) continue;
        const t = (y - y0) / (y1 - y0);
        xs.push(x0 + (x1 - x0) * t);
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) this.px(x, y, color);
      }
    }
    return this;
  }

  /** Diamante isométrico centrado. */
  diamond(cx, cy, w, h, color) {
    const hw = w / 2, hh = h / 2;
    for (let y = -Math.ceil(hh); y <= Math.floor(hh); y++) {
      const t = 1 - Math.abs((y + 0.5) / hh);
      const span = Math.round(hw * t);
      for (let x = -span; x <= span; x++) this.px(cx + x, cy + y, color);
    }
    return this;
  }

  /** Círculo preenchido. */
  circle(cx, cy, r, color) {
    for (let y = -r; y <= r; y++) {
      const span = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
      for (let x = -span; x <= span; x++) this.px(cx + x, cy + y, color);
    }
    return this;
  }

  /** Elipse preenchida. */
  ellipse(cx, cy, rx, ry, color) {
    for (let y = -ry; y <= ry; y++) {
      const t = 1 - (y * y) / (ry * ry || 1);
      if (t < 0) continue;
      const span = Math.floor(rx * Math.sqrt(t));
      for (let x = -span; x <= span; x++) this.px(cx + x, cy + y, color);
    }
    return this;
  }

  /** Copia outro canvas com blend (dx,dy = canto superior esquerdo). */
  blit(src, dx, dy, { alpha = 1, flipX = false } = {}) {
    dx = Math.round(dx); dy = Math.round(dy);
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const a = src.data[i + 3];
        if (!a) continue;
        const sx = flipX ? src.width - 1 - x : x;
        this.px(dx + sx, dy + y, [src.data[i], src.data[i + 1], src.data[i + 2], Math.round(a * alpha)]);
      }
    }
    return this;
  }

  /** Espelho horizontal (nova instância). */
  mirrorX() {
    const out = new PixelCanvas(this.width, this.height);
    out.data.set(this.data);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const src = (y * this.width + x) * 4;
        const dst = (y * this.width + (this.width - 1 - x)) * 4;
        out.data[dst] = this.data[src];
        out.data[dst + 1] = this.data[src + 1];
        out.data[dst + 2] = this.data[src + 2];
        out.data[dst + 3] = this.data[src + 3];
      }
    }
    return out;
  }

  /** Substitui um canvas inteiro (para retângulos de folha). */
  replaceWith(src, dx, dy) {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const px = dx + x, py = dy + y;
        if (!this.inBounds(px, py)) continue;
        const j = (py * this.width + px) * 4;
        this.data.set(src.data.subarray(i, i + 4), j);
      }
    }
    return this;
  }
}

/* ------------------------------------------------------------------ */
/* Isométrico                                                           */
/* ------------------------------------------------------------------ */

/** Grade de projeção usada pelo renderer do escritório (TILE_W=84, TILE_H=38, TILE_Z=26). */
export const TILE_W = 84;
export const TILE_H = 38;
export const TILE_Z = 26;
export const ISO_U = TILE_W / 2; // 42
export const ISO_V = TILE_H / 2; // 19

/** Converte coordenadas de grade isométrica em pixels (origem local do sprite). */
export function iso(gx, gy, gz = 0) {
  return { x: (gx - gy) * ISO_U, y: (gx + gy) * ISO_V - gz * TILE_Z };
}

/**
 * Caixa isométrica clássica.
 *   x0,y0  canto de grade superior (gx menor, gy menor)
 *   w,d    tamanho em tiles
 *   h      altura em unidades z (TILE_Z)
 * Faces: topo clara, face +y (esquerda) média, face +x (direita) escura.
 */
export function isoBox(c, { x0 = 0, y0 = 0, w = 1, d = 1, h = 1, top, left, right, outline = null }) {
  const a = iso(x0, y0, h), b = iso(x0 + w, y0, h), cc = iso(x0 + w, y0 + d, h), dd = iso(x0, y0 + d, h);
  const a0 = iso(x0, y0, 0), b0 = iso(x0 + w, y0, 0), c0 = iso(x0 + w, y0 + d, 0), d0 = iso(x0, y0 + d, 0);
  c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], top);
  c.poly([[dd.x, dd.y], [cc.x, cc.y], [c0.x, c0.y], [d0.x, d0.y]], left);
  c.poly([[b.x, b.y], [cc.x, cc.y], [c0.x, c0.y], [b0.x, b0.y]], right);
  if (outline) {
    const pts = [[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [c0.x, c0.y], [d0.x, d0.y], [dd.x, dd.y], [a.x, a.y]];
    for (let i = 0; i < pts.length - 1; i++) c.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], outline);
    c.line(dd.x, dd.y, c0.x, c0.y, outline);
    c.line(cc.x, cc.y, c0.x, c0.y, outline);
  }
  return c;
}

/** Sombra suave (diamante duplo translúcido) sobre o piso. */
export function isoShadow(c, x0, y0, w, d, { strength = 0.30 } = {}) {
  const a = iso(x0 - 0.08, y0 - 0.08, 0), b = iso(x0 + w + 0.08, y0 - 0.08, 0);
  const cc = iso(x0 + w + 0.08, y0 + d + 0.08, 0), dd = iso(x0 - 0.08, y0 + d + 0.08, 0);
  c.poly([[a.x, a.y], [b.x, b.y], [cc.x, cc.y], [dd.x, dd.y]], [12, 14, 20, Math.round(255 * strength * 0.55)]);
  const a2 = iso(x0 + 0.05, y0 + 0.05, 0), b2 = iso(x0 + w - 0.05, y0 + 0.05, 0);
  const c2 = iso(x0 + w - 0.05, y0 + d - 0.05, 0), d2 = iso(x0 + 0.05, y0 + d - 0.05, 0);
  c.poly([[a2.x, a2.y], [b2.x, b2.y], [c2.x, c2.y], [d2.x, d2.y]], [12, 14, 20, Math.round(255 * strength * 0.6)]);
  return c;
}

/* ------------------------------------------------------------------ */
/* PNG (encoder sem dependências)                                       */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(canvas) {
  const { width, height, data } = canvas;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function savePng(filePath, canvas) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, encodePng(canvas));
  return { file: filePath, width: canvas.width, height: canvas.height, bytes: encodePng(canvas).length };
}

/* ------------------------------------------------------------------ */
/* Utilitários de folha (spritesheet)                                   */
/* ------------------------------------------------------------------ */

/** Cria folha com grade fixa e devolve helper para compor células. */
export function sheet(cols, rows, cellW, cellH) {
  const canvas = new PixelCanvas(cols * cellW, rows * cellH);
  return {
    canvas,
    cell(col, row, fn) {
      const cellCanvas = new PixelCanvas(cellW, cellH);
      fn(cellCanvas, col, row);
      canvas.replaceWith(cellCanvas, col * cellW, row * cellH);
      return cellCanvas;
    },
  };
}

export const PALETTE = {
  outline: "#14161f",
  outlineSoft: "#232738",
  shadow: [16, 18, 26, 90],
  skin: ["#f2c9a0", "#e0ab7d", "#c68a5e", "#8d5a3b", "#f7d9b8"],
  hair: ["#2a2320", "#4a3221", "#7a4a24", "#b8863f", "#d9c07a", "#8a8f9c", "#3a2b3f", "#a63d2f"],
  shirt: ["#3f6fd8", "#c98a2e", "#2f9e8f", "#6b4fc9", "#7a3fd0", "#3fa06a", "#d05f3f", "#d8b13f", "#4a5f8f", "#c9455f"],
  pants: ["#232c42", "#2c3448", "#1d2436", "#241f3a", "#232f28", "#3a3327", "#2b2b33"],
};
