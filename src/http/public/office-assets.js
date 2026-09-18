/* TRACE/COM · Office Assets — loader, registry e componentes de renderização.
 *
 * Camada visual reutilizável: carrega manifests + PNGs do pacote
 * /assets/office, expõe sprites e componentes (AgentSprite, DeskSprite,
 * ChairSprite, SofaSprite, PlantSprite, ShelfSprite, LoungeSet,
 * MeetingRoomSet, KitchenSet, StationSet, AssetManifestLoader,
 * OfficeAssetRegistry) e a fonte pixel desenhada para o escritório.
 *
 * Não contém lógica de trading: apenas desenho em Canvas 2D.
 * Uso:
 *   const assets = await OfficeAssets.load();
 *   assets.agent("agent_trader_blue").draw(ctx, { x, y, scale, state: "sit", dir: "front" });
 */
(() => {
  "use strict";

  const DEFAULT_BASE = "/assets/office";
  const DEFAULT_OPTS = { pixelArt: true };

  /* ------------------------------------------------------------------ */
  /* AssetManifestLoader                                                 */
  /* ------------------------------------------------------------------ */

  const AssetManifestLoader = {
    async load(base = DEFAULT_BASE, options = {}) {
      const opts = { ...DEFAULT_OPTS, ...options };
      const index = await fetchJson(`${base}/manifests/office-assets.json`);
      const manifests = [];
      for (const list of Object.values(index.categories ?? {})) {
        for (const path of list) manifests.push(await fetchJson(path));
      }
      const font = index.font ? await fetchJson(index.font) : null;
      const images = new Map();
      const loadImage = (url) =>
        new Promise((resolve) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = url;
        });
      await Promise.all(manifests.map(async (manifest) => {
        if (!manifest.file) return;
        const dir = manifestPathDir(manifest);
        images.set(manifest.id, await loadImage(`${base}/${dir}/${manifest.file}`));
      }));
      let fontImage = null;
      if (font) {
        fontImage = await loadImage(`${base}/${manifestPathDir(font)}/${font.file}`);
      }
      return new OfficeAssetRegistry({ base, index, manifests, images, font, fontImage, options: opts });
    },
  };

  function fetchJson(url) {
    return fetch(url, { headers: { accept: "application/json" } }).then((response) => {
      if (!response.ok) throw new Error(`asset ${url}: HTTP ${response.status}`);
      return response.json();
    });
  }

  function manifestPathDir(manifest) {
    return `${manifest.category}/${manifest.id}`;
  }

  /* ------------------------------------------------------------------ */
  /* OfficeAssetRegistry                                                 */
  /* ------------------------------------------------------------------ */

  class OfficeAssetRegistry {
    constructor({ base, index, manifests, images, font, fontImage, options }) {
      this.base = base;
      this.index = index;
      this.options = options;
      this.font = font;
      this.fontImage = fontImage;
      this.byId = new Map();
      for (const manifest of manifests) this.byId.set(manifest.id, manifest);
      this.images = images;
      this.agentVariants = manifests.filter((m) => m.category === "agents");
      this.text = new PixelText(this);
    }

    manifest(id) {
      const found = this.byId.get(id);
      if (!found) throw new Error(`asset desconhecido: ${id}`);
      return found;
    }

    has(id) { return this.byId.has(id); }

    list(category = null) {
      const all = [...this.byId.values()];
      return category ? all.filter((m) => m.category === category) : all;
    }

    image(id) { return this.images.get(id) ?? null; }

    sprite(id) { return new Sprite(this, this.manifest(id)); }

    agent(id) { return new AgentSprite(this, this.manifest(id)); }

    agentsByRole(role) { return this.agentVariants.filter((m) => m.role === role); }

    /** Desenha um sprite posicionado por anchor, com escala pixel-perfect. */
    draw(ctx, id, { x, y, scale = 1, flip = false, alpha = 1 }) {
      const manifest = this.manifest(id);
      const img = this.image(id);
      if (!img) return false;
      drawImageSnapped(ctx, img, manifest, { x, y, scale, flip, alpha });
      return true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sprite / AgentSprite                                                */
  /* ------------------------------------------------------------------ */

  class Sprite {
    constructor(client, manifest) {
      this.client = client;
      this.manifest = manifest;
      this.id = manifest.id;
    }
    get image() { return this.client.image(this.id); }
    draw(ctx, { x, y, scale = 1, flip = false, alpha = 1 }) {
      const img = this.image;
      if (!img) return false;
      drawImageSnapped(ctx, img, this.manifest, { x, y, scale, flip, alpha });
      return true;
    }
  }

  const DIR_ROWS = { front: 0, side: 1, back: 2 };

  class AgentSprite {
    constructor(client, manifest) {
      this.client = client;
      this.manifest = manifest;
      this.id = manifest.id;
      this.state = "idle";
      this.dir = "front";
      this.startedAt = performance.now();
    }
    get image() { return this.client.image(this.id); }
    setState(state, dir = null) {
      const nextDir = dir ?? this.dir;
      if (this.state === state && this.dir === nextDir) return;
      this.state = this.manifest.animations[state] ? state : "idle";
      this.dir = DIR_ROWS[nextDir] !== undefined ? nextDir : "front";
      this.startedAt = performance.now();
    }
    frame(now = performance.now()) {
      const anim = this.manifest.animations[this.state] ?? this.manifest.animations.idle;
      if (!anim) return { col: 0, row: 0 };
      const frames = Math.max(1, anim.frames);
      const raw = Math.floor(((now - this.startedAt) / 1000) * anim.fps);
      const index = anim.loop ? raw % frames : Math.min(frames - 1, raw);
      return { col: anim.start + index + (anim.col ?? 0), row: DIR_ROWS[this.dir] ?? 0 };
    }
    draw(ctx, { x, y, scale = 1, state = null, dir = null, now = performance.now(), flip = null, alpha = 1 }) {
      if (state) this.setState(state, dir);
      else if (dir) this.setState(this.state, dir);
      const img = this.image;
      if (!img) return false;
      const { col, row } = this.frame(now);
      const fw = this.manifest.frameWidth;
      const fh = this.manifest.frameHeight;
      const mirrored = flip === true;
      const w = Math.round(fw * scale);
      const h = Math.round(fh * scale);
      const dx = Math.round(x - this.manifest.anchor.x * scale);
      const dy = Math.round(y - this.manifest.anchor.y * scale);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = false;
      if (mirrored) {
        ctx.translate(dx + w, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(img, col * fw, row * fh, fw, fh, 0, 0, w, h);
      } else {
        ctx.drawImage(img, col * fw, row * fh, fw, fh, dx, dy, w, h);
      }
      ctx.restore();
      return true;
    }
  }

  function drawImageSnapped(ctx, img, manifest, { x, y, scale, flip, alpha }) {
    const w = Math.round(manifest.width * scale);
    const h = Math.round(manifest.height * scale);
    const dx = Math.round(x - manifest.anchor.x * scale);
    const dy = Math.round(y - manifest.anchor.y * scale);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    if (flip) {
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, manifest.width, manifest.height, 0, 0, w, h);
    } else {
      ctx.drawImage(img, 0, 0, manifest.width, manifest.height, dx, dy, w, h);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Fonte pixel                                                         */
  /* ------------------------------------------------------------------ */

  class PixelText {
    constructor(client) {
      this.client = client;
      this.font = client.font;
      this.image = client.fontImage;
      this.tintCache = new Map();
    }
    normalize(value) {
      return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
    }
    glyphs(value) {
      if (!this.font) return [];
      return [...this.normalize(value)].map((ch) => this.font.glyphs[ch] ?? this.font.glyphs["?"] ?? null);
    }
    measure(value, scale = 1) {
      const glyphs = this.glyphs(value);
      if (!glyphs.length) return 0;
      return glyphs.reduce((total, g) => total + (g ? g.advance * scale : 0), 0) - scale;
    }
    tinted(color) {
      if (!this.image || !this.font) return null;
      if (this.tintCache.has(color)) return this.tintCache.get(color);
      const canvas = document.createElement("canvas");
      canvas.width = this.image.width;
      canvas.height = this.image.height;
      const g = canvas.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(this.image, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = color;
      g.fillRect(0, 0, canvas.width, canvas.height);
      this.tintCache.set(color, canvas);
      return canvas;
    }
    /** Desenha texto nítido. scale deve ser inteiro (1, 2, 3...). */
    draw(ctx, value, { x, y, scale = 1, color = "#eaf2ff", align = "center", baseline = "middle", alpha = 1 } = {}) {
      const source = this.tinted(color);
      if (!source) return 0;
      const glyphs = this.glyphs(value);
      const width = this.measure(value, scale);
      let cursor = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
      const top = baseline === "middle" ? y - (7 * scale) / 2 : baseline === "bottom" ? y - 7 * scale : y;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = false;
      for (const glyph of glyphs) {
        if (glyph) {
          ctx.drawImage(source, glyph.x, glyph.y, glyph.w, glyph.h, Math.round(cursor), Math.round(top), glyph.w * scale, glyph.h * scale);
        }
        cursor += glyph ? glyph.advance * scale : 6 * scale;
      }
      ctx.restore();
      return width;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Componentes reutilizáveis                                           */
  /* ------------------------------------------------------------------ */

  class DeskSprite extends Sprite { }
  class ChairSprite extends Sprite { }
  class SofaSprite extends Sprite { }
  class PlantSprite extends Sprite { }
  class ShelfSprite extends Sprite { }

  /**
   * Placa frontal de estação: sprite de madeira + nome do ativo + linha de
   * status. Usada pela estação padrão do TraceCom e pelo sandbox.
   */
  class StationPlate {
    constructor(client) {
      this.client = client;
      this.plate = client.sprite("station_plate");
      this.text = client.text;
    }
    /** x,y = ponto superior-central da placa (borda frontal da mesa). */
    draw(ctx, { x, y, scale = 1, symbol = "", info = "", setup = "", infoColor = "#9fc6ff", symbolColor = "#eef4ff", alpha = 1 }) {
      const ph = 48 * scale;
      const centerY = y + ph / 2 + 2 * scale;
      this.plate.draw(ctx, { x, y: centerY, scale, alpha });
      if (symbol) this.text.draw(ctx, symbol, { x, y: centerY - 6 * scale, scale: 2, color: symbolColor, alpha });
      if (info) this.text.draw(ctx, info, { x, y: centerY + 13 * scale, scale: 1, color: infoColor, alpha });
      if (setup) this.text.draw(ctx, setup, { x, y: centerY + ph / 2 + 7 * scale, scale: 1, color: "#8fa3c8", alpha });
      return { bottom: centerY + ph / 2 };
    }
  }

  /**
   * Estação padrão TraceCom: mesa + 2 cadeiras + placa frontal + 2 agentes.
   * Usada pelo renderer do escritório e pelo sandbox.
   */
  class StationSet {
    constructor(client, { deskId = "desk_trading", chairId = "chair_office", traderId = "agent_trader_blue", criticId = "agent_critic" } = {}) {
      this.client = client;
      this.traderId = traderId;
      this.criticId = criticId;
      this.desk = client.sprite(deskId);
      this.chair = client.sprite(chairId);
      this.plate = new StationPlate(client);
      this.trader = client.agent(traderId);
      this.critic = client.agent(criticId);
    }
    /** Cadeiras + agentes (desenhados antes da mesa para a mesa ocluir o colo). */
    drawActors(ctx, { traderPos, criticPos, scale, traderState = "sit", criticState = "sit", dir = "front", drop = 8, now, alpha = 1 }) {
      this.chair.draw(ctx, { x: traderPos.x - 21 * scale, y: traderPos.y + drop * scale + 4 * scale, scale, alpha });
      this.chair.draw(ctx, { x: criticPos.x - 21 * scale, y: criticPos.y + drop * scale + 4 * scale, scale, alpha });
      this.trader.draw(ctx, { x: traderPos.x, y: traderPos.y + drop * scale, scale, state: traderState, dir, now, alpha });
      this.critic.draw(ctx, { x: criticPos.x, y: criticPos.y + drop * scale, scale, state: criticState, dir, now, alpha });
    }
    /** Mesa + props opcionais sobre o tampo. */
    drawDesk(ctx, { x, y, scale, alpha = 1, monitorPos = null, mugPos = null, monitorSprite = "prop_monitor", mugSprite = "prop_mug" }) {
      this.desk.draw(ctx, { x, y, scale, alpha });
      if (monitorPos) this.client.draw(ctx, monitorSprite, { x: monitorPos.x, y: monitorPos.y, scale, alpha });
      if (mugPos) this.client.draw(ctx, mugSprite, { x: mugPos.x, y: mugPos.y, scale, alpha });
    }
    drawPlate(ctx, options) {
      return this.plate.draw(ctx, options);
    }
  }

  class LoungeSet {
    constructor(client) {
      this.client = client;
      this.sofa = client.sprite("sofa");
      this.coffeeTable = client.sprite("coffee_table");
      this.armchair = client.sprite("armchair");
      this.plant = client.sprite("plant");
      this.poolTable = client.has("pool_table") ? client.sprite("pool_table") : null;
    }
  }

  class MeetingRoomSet {
    constructor(client) {
      this.client = client;
      this.table = client.sprite("meeting_table");
      this.whiteboard = client.sprite("whiteboard");
      this.chair = client.sprite("chair_office");
      this.plant = client.sprite("plant");
    }
  }

  class KitchenSet {
    constructor(client) {
      this.client = client;
      this.counter = client.sprite("counter");
      this.sink = client.sprite("sink");
      this.fridge = client.sprite("fridge");
      this.water = client.sprite("water_cooler");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                           */
  /* ------------------------------------------------------------------ */

  const OfficeAssets = {
    AssetManifestLoader,
    OfficeAssetRegistry,
    Sprite,
    AgentSprite,
    PixelText,
    DeskSprite,
    ChairSprite,
    SofaSprite,
    PlantSprite,
    ShelfSprite,
    StationPlate,
    StationSet,
    LoungeSet,
    MeetingRoomSet,
    KitchenSet,
    load: (base, options) => AssetManifestLoader.load(base, options),
    version: 1,
  };

  window.OfficeAssets = OfficeAssets;
})();
