// Inlined from mind-avatar.ts — simple deterministic string hash
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ============================================================
// Seeded RNG — LCG (same algorithm as mockup)
// ============================================================

export class SeededRNG {
  private s: number;

  constructor(seed: number) {
    this.s = seed;
  }

  next(): number {
    this.s = (this.s * 1103515245 + 12345) & 0x7fffffff;
    return (this.s % 10000) / 10000;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
}

// ============================================================
// Color derivation
// ============================================================

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const v = ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export interface MindColors {
  primary: string;
  secondary: string;
}

export function colorFromMind(mindId: string): MindColors {
  const h = hashString(mindId);
  const hue = h % 360;
  const sat = 55 + (h >> 8) % 20;
  const litDark = 45 + (h >> 16) % 10;
  const litBright = 60 + (h >> 16) % 12;
  return {
    primary: hslToHex(hue, sat, litDark),
    secondary: hslToHex((hue + 30) % 360, Math.min(90, sat + 15), litBright),
  };
}

// ============================================================
// Topology types
// ============================================================

export type TopologyType = 'hub' | 'mesh' | 'chain' | 'spiral' | 'cluster' | 'star';

const TOPOLOGY_ORDER: TopologyType[] = ['hub', 'mesh', 'chain', 'spiral', 'cluster', 'star'];

export function topologyFromWorldview(worldview: string): TopologyType {
  return TOPOLOGY_ORDER[hashString(worldview) % 6];
}

export interface RawNode {
  x: number;
  y: number;
  size: number;
  brightness: number;
}

// ============================================================
// 6 topology generators — ported faithfully from mockup
// ============================================================

function topoHub(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2;
  const nodes: RawNode[] = [];
  const core = Math.max(3, Math.floor(n * 0.3));
  for (let i = 0; i < core; i++) {
    const a = rng.next() * Math.PI * 2, d = rng.range(3, size * 0.1);
    nodes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, size: rng.range(1.8, 3.0), brightness: rng.range(0.7, 1) });
  }
  const arms = rng.int(3, 5), rem = n - core;
  for (let arm = 0; arm < arms; arm++) {
    const ba = (arm / arms) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const cnt = Math.floor(rem / arms) + (arm === 0 ? rem % arms : 0);
    for (let i = 0; i < cnt; i++) {
      const t = (i + 1) / cnt, dist = size * 0.1 + t * size * 0.34, a = ba + rng.range(-0.2, 0.2) * (1 + t);
      nodes.push({ x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist, size: rng.range(1, 2.8) * (1 - t * 0.3), brightness: rng.range(0.35, 0.75) * (1 - t * 0.2) });
    }
  }
  return nodes;
}

function topoMesh(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2;
  const nodes: RawNode[] = [];
  const cols = Math.ceil(Math.sqrt(n * 1.2));
  const sp = size * 0.7 / cols;
  const ox = cx - (cols - 1) * sp / 2, oy = cy - (cols - 1) * sp / 2;
  let p = 0;
  for (let r = 0; r < cols && p < n; r++) {
    for (let c = 0; c < cols && p < n; c++) {
      const x = ox + c * sp + rng.range(-sp * 0.35, sp * 0.35);
      const y = oy + r * sp + rng.range(-sp * 0.35, sp * 0.35);
      const dx = x - cx, dy = y - cy;
      if (Math.sqrt(dx * dx + dy * dy) < size * 0.42) {
        nodes.push({ x, y, size: rng.range(1.4, 2.8), brightness: rng.range(0.45, 0.85) });
        p++;
      }
    }
  }
  while (nodes.length < n) {
    const a = rng.next() * Math.PI * 2, d = rng.range(5, size * 0.38);
    nodes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, size: rng.range(1.2, 2.4), brightness: rng.range(0.4, 0.7) });
  }
  return nodes;
}

function topoChain(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2;
  const nodes: RawNode[] = [];
  const main = Math.floor(n * 0.6);
  for (let i = 0; i < main; i++) {
    const t = i / (main - 1);
    const x = cx + (t - 0.5) * size * 0.7;
    const y = cy + Math.sin(t * Math.PI * 1.8) * size * 0.2 + rng.range(-4, 4);
    nodes.push({ x, y, size: rng.range(1.6, 3.2) * (0.7 + 0.3 * Math.sin(t * Math.PI)), brightness: rng.range(0.5, 0.9) });
  }
  for (let i = 0; i < n - main; i++) {
    const par = nodes[rng.int(0, main - 1)];
    const a = rng.next() * Math.PI * 2, d = rng.range(8, size * 0.12);
    nodes.push({ x: par.x + Math.cos(a) * d, y: par.y + Math.sin(a) * d, size: rng.range(0.9, 2), brightness: rng.range(0.3, 0.6) });
  }
  return nodes;
}

function topoSpiral(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2;
  const nodes: RawNode[] = [];
  const arms = rng.int(2, 4), perArm = Math.floor(n / arms);
  for (let arm = 0; arm < arms; arm++) {
    const ba = (arm / arms) * Math.PI * 2;
    const cnt = perArm + (arm === 0 ? n % arms : 0);
    for (let i = 0; i < cnt; i++) {
      const t = i / perArm;
      const a = ba + t * Math.PI * 2.5 + rng.range(-0.15, 0.15);
      const d = 4 + t * size * 0.38;
      const innerFade = t < 0.15 ? 0.6 : 1;
      nodes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, size: rng.range(1.2, 3.2) * (1 - t * 0.3), brightness: rng.range(0.4, 0.9) * (1 - t * 0.15) * innerFade });
    }
  }
  return nodes;
}

function topoCluster(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2;
  const nodes: RawNode[] = [];
  const cc = rng.int(3, 5);
  const centers: { x: number; y: number }[] = [];
  for (let c = 0; c < cc; c++) {
    const a = rng.next() * Math.PI * 2, d = rng.range(size * 0.08, size * 0.28);
    centers.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d });
  }
  for (let i = 0; i < n; i++) {
    const ctr = centers[i % cc];
    const a = rng.next() * Math.PI * 2, d = rng.range(2, size * 0.11);
    nodes.push({ x: ctr.x + Math.cos(a) * d, y: ctr.y + Math.sin(a) * d, size: rng.range(1.2, 3), brightness: rng.range(0.4, 0.9) });
  }
  return nodes;
}

function topoStar(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2;
  const nodes: RawNode[] = [];
  nodes.push({ x: cx, y: cy, size: 3.0, brightness: 1.0 });
  nodes.push({ x: cx + rng.range(-3, 3), y: cy + rng.range(-3, 3), size: 2.6, brightness: 0.9 });
  const rays = rng.int(5, 8), rem = n - 2, perRay = Math.floor(rem / rays);
  for (let r = 0; r < rays; r++) {
    const ba = (r / rays) * Math.PI * 2;
    const cnt = perRay + (r === 0 ? rem % rays : 0);
    for (let i = 0; i < cnt; i++) {
      const t = (i + 1) / cnt;
      const a = ba + rng.range(-0.08, 0.08);
      const d = t * size * 0.4;
      nodes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, size: rng.range(1, 2.4) * (1 - t * 0.4), brightness: rng.range(0.4, 0.85) * (1 - t * 0.3) });
    }
  }
  return nodes;
}

export type TopologyGenerator = (size: number, rng: SeededRNG, nodeCount: number) => RawNode[];

export const TOPOLOGY_GENERATORS: Record<TopologyType, TopologyGenerator> = {
  hub: topoHub,
  mesh: topoMesh,
  chain: topoChain,
  spiral: topoSpiral,
  cluster: topoCluster,
  star: topoStar,
};

// ============================================================
// Evolution parameters
// ============================================================

export interface EvoParams {
  nodeCount: number;        // 16–48
  pulseRate: number;        // 0.8–4.3 pulses/sec
  cascadeProb: number;      // 0.15–0.70
  glowIntensity: number;    // 0.8–2.0
  connRange: number;        // 0.16–0.35  (fraction of size)
  connDens: number;         // 0.3–0.85
  bScale: number;           // 0.65–1.0
  sScale: number;           // 0.7–1.0
  maxPulses: 40;
}

export function getEvoParams(evolution: number): EvoParams {
  const e = Math.max(0, Math.min(1, evolution));
  return {
    nodeCount: Math.round(12 + e * 36),       // 12–48
    pulseRate: 0.8 + e * 3.5,                 // 0.8–4.3
    cascadeProb: 0.15 + e * 0.55,             // 0.15–0.70
    glowIntensity: 0.8 + e * 1.2,             // 0.8–2.0
    connRange: 0.16 + e * 0.19,               // 0.16–0.35
    connDens: 0.3 + e * 0.55,                 // 0.3–0.85
    bScale: 0.65 + e * 0.35,                  // 0.65–1.0
    sScale: 0.7 + e * 0.3,                    // 0.7–1.0
    maxPulses: 40,
  };
}

export function applyTraitModifiers(
  params: EvoParams,
  bias?: string,
  communicationStyle?: string,
): EvoParams {
  const p = { ...params };

  if (bias) {
    const bl = bias.toLowerCase();
    if (bl.includes('cautious') || bl.includes('conservative')) {
      p.pulseRate *= 0.75;
      p.cascadeProb *= 0.7;
    } else if (bl.includes('bold') || bl.includes('aggressive') || bl.includes('risk')) {
      p.pulseRate *= 1.25;
      p.cascadeProb *= 1.3;
    }
  }

  if (communicationStyle) {
    const cl = communicationStyle.toLowerCase();
    if (cl.includes('verbose') || cl.includes('detail')) {
      p.connDens = Math.min(1.0, p.connDens * 1.2);
      p.connRange = Math.min(0.5, p.connRange * 1.15);
    } else if (cl.includes('terse') || cl.includes('concise') || cl.includes('brief')) {
      p.connDens *= 0.8;
    }
  }

  return p;
}

export function applyConfidenceScores(
  nodes: AnimNode[],
  confidenceScores?: Record<string, number>,
): void {
  if (!confidenceScores || Object.keys(confidenceScores).length === 0) return;
  const scores = Object.values(confidenceScores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  // avg confidence (0–1) scales brightness uniformly
  const scale = 0.5 + avg * 0.5;
  for (const n of nodes) {
    n.brightness = Math.min(1, n.brightness * scale);
  }
}

export type RenderTier = 'full' | 'reduced' | 'minimal';

export function renderTierFromSize(size: number): RenderTier {
  if (size >= 100) return 'full';
  if (size >= 40) return 'reduced';
  return 'minimal';
}

// ============================================================
// Drift + evolution computation
// ============================================================

export function computeDrift(mind: {
  bias?: string;
  dismisses?: string;
  communicationStyle?: string;
}): number {
  let drift = 0;
  if (mind.bias) drift += hashString(mind.bias) % 15;
  if (mind.dismisses) drift += hashString(mind.dismisses) % 15;
  if (mind.communicationStyle) drift += hashString(mind.communicationStyle) % 10;
  return Math.min(40, drift);
}

export function computeEvolution(debateCount: number, memoryCount: number, driftMagnitude: number): number {
  return Math.min(1.0,
    (debateCount / 60) * 0.5 +
    (memoryCount / 200) * 0.3 +
    (driftMagnitude / 40) * 0.2
  );
}

// ============================================================
// Internal animation types
// ============================================================

export interface AnimNode {
  x: number;
  y: number;
  originX: number;
  originY: number;
  baseSize: number;
  size: number;
  brightness: number;
  currentBrightness: number;
  phase: number;
  breathSpeed: number;
  breathDepth: number;
  pulsePhase: number;
  glimpsePhase: number;
  glimpseSpeed: number;
  glimpseIntensity: number;
  driftAngle: number;
  driftSpeed: number;
  driftRadius: number;
  // void sector dimming
  dimmed: boolean;
}

export interface Connection {
  from: number;
  to: number;
  dist: number;
  strength: number;
  pulsePhase: number;
  pulseSpeed: number;
}

export interface Pulse {
  connection: Connection;
  progress: number;
  speed: number;
  brightness: number;
  forward: boolean;
  trailLength: number;
}

export interface Particle {
  orbitRadius: number;
  orbitAngle: number;
  orbitSpeed: number;
  size: number;
  phase: number;
  speed: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

export interface AvatarParams {
  seed: number;
  primary: string;
  secondary: string;
  evolution: number;           // 0–1
  topoGen: TopologyGenerator;
  nodeCount: number;
  renderTier: RenderTier;
  // Optional features
  voidSectors?: VoidSector[];
  confidenceScores?: Record<string, number>;
}

// ============================================================
// Void sectors
// ============================================================

export interface VoidSector {
  angle: number;   // radians, direction of the void from center
  span: number;    // radians, half-width of the arc
  strength: number; // 0–1, how much brightness is cut
}

export function computeVoidSectors(dismisses: string): VoidSector[] {
  if (!dismisses || dismisses.trim() === '') return [];

  const words = dismisses.trim().split(/\s+/);
  const count = Math.min(2, Math.max(1, Math.floor(words.length / 3) + 1));
  const sectors: VoidSector[] = [];

  for (let i = 0; i < count; i++) {
    const seed = hashString(dismisses + String(i));
    const angle = (seed % 628) / 100;   // 0–2π
    sectors.push({
      angle,
      span: 0.349 + (seed % 30) / 171,  // half-angle: 20-30° → total 40-60°
      strength: 0.5 + (seed % 40) / 100, // 0.5–0.9
    });
  }
  return sectors;
}

export function isInVoidSector(
  nx: number,
  ny: number,
  cx: number,
  cy: number,
  sectors: VoidSector[],
): boolean {
  if (sectors.length === 0) return false;
  const nodeAngle = Math.atan2(ny - cy, nx - cx);
  for (const s of sectors) {
    let diff = Math.abs(nodeAngle - s.angle);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < s.span) return true;
  }
  return false;
}

// ============================================================
// NeuralAvatarEngine
// ============================================================

export class NeuralAvatarEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private p: AvatarParams;
  private time: number;

  nodes: AnimNode[] = [];
  connections: Connection[] = [];
  pulses: Pulse[] = [];
  particles: Particle[] = [];

  private glowIntensity = 1;
  private pulseRate = 1;
  private cascadeProb = 0.2;
  private renderTier: RenderTier;

  constructor(canvas: HTMLCanvasElement, params: AvatarParams) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;
    // Use CSS-pixel size (canvas.width / 2) since the ctx is retina-scaled 2x
    this.size = canvas.width / 2;
    this.p = params;
    this.renderTier = params.renderTier;
    this.time = Math.random() * 100;
    this.rebuild();
  }

  rebuild(): void {
    const rng = new SeededRNG(this.p.seed);
    const evo = Math.max(0, Math.min(1, this.p.evolution ?? 0));
    const evoParams = getEvoParams(evo);

    this.pulseRate = evoParams.pulseRate;
    this.cascadeProb = evoParams.cascadeProb;
    this.glowIntensity = evoParams.glowIntensity;

    const rawNodes = this.p.topoGen(this.size, rng, this.p.nodeCount);
    const cx = this.size / 2, cy = this.size / 2;
    // Scale node sizes proportionally — topologies generate for ~160px reference size
    const sizeRatio = this.size / 160;

    this.nodes = rawNodes.map(n => {
      const inVoid = this.p.voidSectors
        ? isInVoidSector(n.x, n.y, cx, cy, this.p.voidSectors)
        : false;

      return {
        x: n.x, y: n.y,
        originX: n.x, originY: n.y,
        baseSize: n.size * evoParams.sScale * sizeRatio,
        size: n.size * evoParams.sScale * sizeRatio,
        brightness: n.brightness * evoParams.bScale,
        currentBrightness: n.brightness * evoParams.bScale,
        phase: rng.next() * Math.PI * 2,
        breathSpeed: rng.range(0.4, 1.8),
        breathDepth: rng.range(0.25, 0.5),
        pulsePhase: rng.next() * Math.PI * 2,
        glimpsePhase: rng.next() * Math.PI * 2,
        glimpseSpeed: rng.range(0.05, 0.2),
        glimpseIntensity: rng.range(0.3, 0.8),
        driftAngle: rng.next() * Math.PI * 2,
        driftSpeed: rng.range(0.1, 0.4),
        driftRadius: rng.range(0.3, 1.2),
        dimmed: inVoid,
      };
    });

    // Apply void sector dimming
    if (this.p.voidSectors && this.p.voidSectors.length > 0) {
      for (const node of this.nodes) {
        if (isInVoidSector(node.x, node.y, cx, cy, this.p.voidSectors)) {
          node.brightness = 0.2;
        }
      }
    }

    // Apply confidence score brightness
    if (this.p.confidenceScores) {
      applyConfidenceScores(this.nodes, this.p.confidenceScores);
    }

    // Build connections
    this.connections = [];
    const maxDist = this.size * evoParams.connRange;
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const dx = this.nodes[i].x - this.nodes[j].x;
        const dy = this.nodes[i].y - this.nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist && rng.next() < (1 - dist / maxDist) * evoParams.connDens) {
          this.connections.push({
            from: i, to: j, dist,
            strength: (1 - dist / maxDist) * (0.5 + evo * 0.5),
            pulsePhase: rng.next() * Math.PI * 2,
            pulseSpeed: rng.range(0.3, 0.8),
          });
        }
      }
    }

    // Build particles
    this.particles = [];
    const pCount = Math.round(12 + evo * 40);
    for (let i = 0; i < pCount; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = 10 + rng.next() * this.size * 0.42;
      this.particles.push({
        orbitRadius: d,
        orbitAngle: a,
        orbitSpeed: (rng.next() - 0.5) * 0.003,
        size: 0.3 + rng.next() * 0.6,
        phase: rng.next() * Math.PI * 2,
        speed: 0.15 + rng.next() * 0.4,
        twinkleSpeed: rng.range(1, 4),
        twinklePhase: rng.next() * Math.PI * 2,
      });
    }

    this.pulses = [];
  }

  update(dt: number): void {
    this.time += dt;

    // Spawn pulses
    if (this.connections.length > 0) {
      const spawnChance = this.pulseRate * dt * 0.08;
      if (Math.random() < spawnChance) {
        const c = this.connections[Math.floor(Math.random() * this.connections.length)];
        if (this.pulses.length < 40) {
          this.pulses.push({
            connection: c,
            progress: 0,
            speed: 0.004 + Math.random() * 0.012,
            brightness: 0.5 + Math.random() * 0.5,
            forward: Math.random() > 0.5,
            trailLength: 0.12 + Math.random() * 0.08,
          });
        }
      }
    }

    // Breathing + drift + glimpsing
    for (const n of this.nodes) {
      const breath = Math.sin(this.time * n.breathSpeed + n.pulsePhase);
      n.size = n.baseSize * (1 + breath * n.breathDepth);

      n.x = n.originX + Math.cos(this.time * n.driftSpeed + n.driftAngle) * n.driftRadius;
      n.y = n.originY + Math.sin(this.time * n.driftSpeed * 0.7 + n.driftAngle) * n.driftRadius;

      const glimpse = Math.pow(Math.max(0, Math.sin(this.time * n.glimpseSpeed + n.glimpsePhase)), 8);
      n.currentBrightness = n.brightness + glimpse * n.glimpseIntensity;
    }

    // Update pulses with cascades — skip cascades if not full tier
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      this.pulses[i].progress += this.pulses[i].speed;
      if (this.pulses[i].progress > 1) {
        if (this.renderTier === 'full' && Math.random() < this.cascadeProb && this.pulses.length < 40) {
          const endIdx = this.pulses[i].forward
            ? this.pulses[i].connection.to
            : this.pulses[i].connection.from;
          const nexts = this.connections.filter(
            c => (c.from === endIdx || c.to === endIdx) && c !== this.pulses[i].connection,
          );
          if (nexts.length) {
            const next = nexts[Math.floor(Math.random() * nexts.length)];
            this.pulses.push({
              connection: next,
              progress: 0,
              speed: 0.005 + Math.random() * 0.012,
              brightness: this.pulses[i].brightness * 0.65,
              forward: next.from === endIdx,
              trailLength: 0.10 + Math.random() * 0.06,
            });
          }
        }
        this.pulses.splice(i, 1);
      }
    }

    // Particle orbits — skip if minimal
    if (this.renderTier !== 'minimal') {
      for (const p of this.particles) {
        p.orbitAngle += p.orbitSpeed;
      }
    }
  }

  draw(): void {
    this.drawBackgroundGlow();
    if (this.renderTier !== 'minimal') {
      this.drawParticles();
    }
    this.drawConnections();
    this.drawPulses();
    this.drawNodeHalos();
    this.drawNodes();
    this.drawHotCores();
  }

  // ---- private draw helpers ----

  private drawBackgroundGlow(): void {
    const ctx = this.ctx, s = this.size;
    const { primary } = this.p;
    const gi = this.glowIntensity;
    ctx.clearRect(0, 0, s, s);

    const bgBreath = 0.85 + 0.15 * Math.sin(this.time * 0.3);
    const bg = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.48);
    bg.addColorStop(0, this.rgba(primary, 0.05 * gi * bgBreath));
    bg.addColorStop(0.5, this.rgba(primary, 0.015 * gi * bgBreath));
    bg.addColorStop(1, 'transparent');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);
  }

  private drawParticles(): void {
    const ctx = this.ctx, s = this.size;
    const { primary } = this.p;
    for (const p of this.particles) {
      const px = s / 2 + Math.cos(p.orbitAngle) * p.orbitRadius;
      const py = s / 2 + Math.sin(p.orbitAngle) * p.orbitRadius;
      const twinkle = 0.4 + 0.6 * Math.pow((Math.sin(this.time * p.twinkleSpeed + p.twinklePhase) + 1) / 2, 2);
      ctx.beginPath();
      ctx.arc(px, py, p.size * (0.8 + twinkle * 0.4), 0, Math.PI * 2);
      ctx.fillStyle = this.rgba(primary, twinkle * 0.18);
      ctx.fill();
    }
  }

  private drawConnections(): void {
    const ctx = this.ctx;
    const { primary } = this.p;
    for (const c of this.connections) {
      const f = this.nodes[c.from], t = this.nodes[c.to];
      const connBreath = 0.7 + 0.3 * Math.sin(this.time * c.pulseSpeed + c.pulsePhase);
      const alpha = (c.strength * 0.5 + 0.18) * connBreath;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = this.rgba(primary, alpha);
      ctx.lineWidth = (0.7 + c.strength * 1.0) * (0.85 + connBreath * 0.15);
      ctx.stroke();
    }
  }

  private drawPulses(): void {
    const ctx = this.ctx;
    const { primary, secondary } = this.p;
    for (const p of this.pulses) {
      const conn = p.connection;
      const f = this.nodes[conn.from], t = this.nodes[conn.to];
      const prog = p.forward ? p.progress : 1 - p.progress;
      const headX = f.x + (t.x - f.x) * prog;
      const headY = f.y + (t.y - f.y) * prog;

      // Glowing trail
      const trailSteps = 8;
      for (let s2 = trailSteps; s2 >= 0; s2--) {
        const tp = prog - (s2 / trailSteps) * p.trailLength;
        if (tp < 0) continue;
        const tx = f.x + (t.x - f.x) * tp;
        const ty = f.y + (t.y - f.y) * tp;
        const fade = 1 - s2 / trailSteps;
        ctx.beginPath();
        ctx.arc(tx, ty, 1.0 + fade * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = this.rgba(secondary, p.brightness * fade * 0.5);
        ctx.fill();
      }

      // Pulse head bloom
      const bloom = ctx.createRadialGradient(headX, headY, 0, headX, headY, 14);
      bloom.addColorStop(0, this.rgba(secondary, p.brightness * 0.6));
      bloom.addColorStop(0.3, this.rgba(primary, p.brightness * 0.2));
      bloom.addColorStop(1, 'transparent');
      ctx.fillStyle = bloom;
      ctx.fillRect(headX - 16, headY - 16, 32, 32);

      // Bright core
      ctx.beginPath();
      ctx.arc(headX, headY, 2.0, 0, Math.PI * 2);
      ctx.fillStyle = this.rgba('#ffffff', p.brightness * 0.5);
      ctx.fill();
    }
  }

  private drawNodeHalos(): void {
    const ctx = this.ctx;
    const { primary } = this.p;
    const gi = this.glowIntensity;
    for (const n of this.nodes) {
      const b = n.currentBrightness;
      const breathGlow = 0.8 + 0.2 * Math.sin(this.time * n.breathSpeed * 0.5 + n.phase);
      const hr = n.size * 5 * gi * breathGlow;
      const hg = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, hr);
      hg.addColorStop(0, this.rgba(primary, b * 0.16 * breathGlow));
      hg.addColorStop(0.4, this.rgba(primary, b * 0.05 * breathGlow));
      hg.addColorStop(1, 'transparent');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(n.x, n.y, hr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawNodes(): void {
    const ctx = this.ctx;
    const { primary } = this.p;
    for (const n of this.nodes) {
      const b = n.currentBrightness;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
      ctx.fillStyle = this.rgba(primary, b * 0.9);
      ctx.fill();
    }
  }

  private drawHotCores(): void {
    const ctx = this.ctx;
    for (const n of this.nodes) {
      if (n.size > 1.5) {
        const b = n.currentBrightness;
        const coreGlow = 0.7 + 0.3 * Math.sin(this.time * n.breathSpeed + n.phase + 1);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.size * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = this.rgba('#ffffff', b * 0.3 * coreGlow);
        ctx.fill();
      }
    }
  }

  rgba(hex: string, a: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
  }
}
