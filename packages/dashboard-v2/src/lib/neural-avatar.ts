// NeuralAvatar Engine — Glowing Orb with distinct topologies
// Fewer nodes, stronger glows and lines, slower evolution for gossipcat

export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

class SeededRNG {
  private s: number;
  constructor(seed: number) { this.s = seed; }
  next(): number { this.s = (this.s * 1103515245 + 12345) & 0x7fffffff; return (this.s % 10000) / 10000; }
  range(min: number, max: number): number { return min + this.next() * (max - min); }
  int(min: number, max: number): number { return Math.floor(this.range(min, max + 1)); }
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100, ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const v = ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export interface AvatarColors { primary: string; secondary: string; }

export function colorFromAgent(agentId: string): AvatarColors {
  const h = hashString(agentId), hue = h % 360, sat = 65 + (h >> 8) % 20;
  return {
    primary: hslToHex(hue, sat, 65 + (h >> 16) % 10),
    secondary: hslToHex(hue, Math.min(95, sat + 10), 80 + (h >> 16) % 8),
  };
}

function rgba(hex: string, a: number): string {
  return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${Math.max(0, Math.min(1, a))})`;
}

// ---- Types ----

interface RawNode { x: number; y: number; size: number; brightness: number; }
interface OrbNode {
  x: number; y: number; originX: number; originY: number;
  size: number; baseSize: number; brightness: number;
  phase: number; breathSpeed: number;
  driftAngle: number; driftSpeed: number; driftRadius: number;
}
interface OrbConnection { from: number; to: number; strength: number; }
interface Pulse { connIdx: number; progress: number; speed: number; brightness: number; forward: boolean; }

// ---- 6 Topology Generators (fewer nodes, smaller) ----

function topoHub(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2, nodes: RawNode[] = [];
  const core = Math.max(2, Math.floor(n * 0.3));
  for (let i = 0; i < core; i++) {
    const a = rng.next() * Math.PI * 2, d = rng.range(2, size * 0.06);
    nodes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, size: rng.range(1.5, 2.5), brightness: rng.range(0.8, 1) });
  }
  const arms = rng.int(3, 5), rem = n - core;
  for (let arm = 0; arm < arms; arm++) {
    const ba = (arm / arms) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const cnt = Math.floor(rem / arms) + (arm === 0 ? rem % arms : 0);
    for (let i = 0; i < cnt; i++) {
      const t = (i + 1) / cnt, dist = size * 0.08 + t * size * 0.32;
      const a = ba + rng.range(-0.15, 0.15) * (1 + t);
      nodes.push({ x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist, size: rng.range(0.8, 2) * (1 - t * 0.3), brightness: rng.range(0.5, 0.9) * (1 - t * 0.2) });
    }
  }
  return nodes;
}

function topoSpiral(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2, nodes: RawNode[] = [];
  const arms = rng.int(2, 3), perArm = Math.floor(n / arms);
  for (let arm = 0; arm < arms; arm++) {
    const ba = (arm / arms) * Math.PI * 2;
    const cnt = perArm + (arm === 0 ? n % arms : 0);
    for (let i = 0; i < cnt; i++) {
      const t = i / perArm;
      const a = ba + t * Math.PI * 2.5 + rng.range(-0.1, 0.1);
      const d = 3 + t * size * 0.36;
      nodes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, size: rng.range(0.9, 2.2) * (1 - t * 0.3), brightness: rng.range(0.5, 1) * (1 - t * 0.15) });
    }
  }
  return nodes;
}

function topoCluster(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2, nodes: RawNode[] = [];
  const cc = rng.int(3, 4);
  const centers: { x: number; y: number }[] = [];
  for (let c = 0; c < cc; c++) {
    const a = rng.next() * Math.PI * 2, d = rng.range(size * 0.1, size * 0.25);
    centers.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d });
  }
  for (let i = 0; i < n; i++) {
    const ctr = centers[i % cc];
    const a = rng.next() * Math.PI * 2, d = rng.range(2, size * 0.09);
    nodes.push({ x: ctr.x + Math.cos(a) * d, y: ctr.y + Math.sin(a) * d, size: rng.range(0.9, 2), brightness: rng.range(0.5, 1) });
  }
  return nodes;
}

function topoStar(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2, nodes: RawNode[] = [];
  nodes.push({ x: cx, y: cy, size: 2.5, brightness: 1.0 });
  const rays = rng.int(5, 7), rem = n - 1, perRay = Math.floor(rem / rays);
  for (let r = 0; r < rays; r++) {
    const ba = (r / rays) * Math.PI * 2;
    const cnt = perRay + (r === 0 ? rem % rays : 0);
    for (let i = 0; i < cnt; i++) {
      const t = (i + 1) / cnt, a = ba + rng.range(-0.06, 0.06), d = t * size * 0.38;
      nodes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, size: rng.range(0.8, 1.8) * (1 - t * 0.3), brightness: rng.range(0.5, 0.9) * (1 - t * 0.2) });
    }
  }
  return nodes;
}

function topoChain(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2, nodes: RawNode[] = [];
  const main = Math.floor(n * 0.7);
  for (let i = 0; i < main; i++) {
    const t = i / (main - 1);
    const x = cx + (t - 0.5) * size * 0.65;
    const y = cy + Math.sin(t * Math.PI * 1.8) * size * 0.18 + rng.range(-2, 2);
    nodes.push({ x, y, size: rng.range(1.2, 2.2) * (0.7 + 0.3 * Math.sin(t * Math.PI)), brightness: rng.range(0.5, 1) });
  }
  for (let i = 0; i < n - main; i++) {
    const par = nodes[rng.int(0, main - 1)];
    const a = rng.next() * Math.PI * 2, d = rng.range(5, size * 0.08);
    nodes.push({ x: par.x + Math.cos(a) * d, y: par.y + Math.sin(a) * d, size: rng.range(0.7, 1.5), brightness: rng.range(0.4, 0.7) });
  }
  return nodes;
}

function topoMesh(size: number, rng: SeededRNG, n: number): RawNode[] {
  const cx = size / 2, cy = size / 2, nodes: RawNode[] = [];
  const cols = Math.ceil(Math.sqrt(n * 1.2)), sp = size * 0.65 / cols;
  const ox = cx - (cols - 1) * sp / 2, oy = cy - (cols - 1) * sp / 2;
  let p = 0;
  for (let r = 0; r < cols && p < n; r++) {
    for (let c = 0; c < cols && p < n; c++) {
      const x = ox + c * sp + rng.range(-sp * 0.3, sp * 0.3);
      const y = oy + r * sp + rng.range(-sp * 0.3, sp * 0.3);
      const dx = x - cx, dy = y - cy;
      if (Math.sqrt(dx * dx + dy * dy) < size * 0.4) {
        nodes.push({ x, y, size: rng.range(1, 2), brightness: rng.range(0.5, 0.9) });
        p++;
      }
    }
  }
  while (nodes.length < n) {
    const a = rng.next() * Math.PI * 2, d = rng.range(4, size * 0.35);
    nodes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, size: rng.range(1, 1.8), brightness: rng.range(0.4, 0.8) });
  }
  return nodes;
}

type TopoFn = (size: number, rng: SeededRNG, n: number) => RawNode[];
const TOPOLOGIES: TopoFn[] = [topoHub, topoSpiral, topoCluster, topoStar, topoChain, topoMesh];

// ---- Engine ----

export class OrbAvatarEngine {
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private color: AvatarColors;
  private nodes: OrbNode[] = [];
  private connections: OrbConnection[] = [];
  private pulses: Pulse[] = [];
  private time = 0;
  private evolution: number;

  constructor(canvas: HTMLCanvasElement, agentId: string, evolution = 0.15) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    this.ctx = ctx;
    this.size = canvas.width / 2;
    this.color = colorFromAgent(agentId);
    this.evolution = Math.max(0, Math.min(1, evolution));

    const seed = hashString(agentId);
    const rng = new SeededRNG(seed);
    const sc = this.size / 64;
    const topoFn = TOPOLOGIES[seed % TOPOLOGIES.length];

    // Evolution controls node count: 4 at evo=0, up to 12 at evo=1
    const nodeCount = Math.round(4 + this.evolution * 8);

    const rawNodes = topoFn(this.size, rng, nodeCount);

    // Evolution scales node sizes down — less evolved = smaller, cleaner
    const sizeScale = 0.6 + this.evolution * 0.4;

    this.nodes = rawNodes.map(n => ({
      x: n.x, y: n.y, originX: n.x, originY: n.y,
      size: n.size * sc * sizeScale, baseSize: n.size * sc * sizeScale,
      brightness: n.brightness,
      phase: rng.next() * Math.PI * 2,
      breathSpeed: rng.range(0.4, 1.5),
      driftAngle: rng.next() * Math.PI * 2,
      driftSpeed: rng.range(0.1, 0.35),
      driftRadius: rng.range(0.3, 1.0) * sc,
    }));

    // Connections — more generous threshold, keep more
    const maxDist = this.size * 0.4;
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const dx = this.nodes[i].originX - this.nodes[j].originX;
        const dy = this.nodes[i].originY - this.nodes[j].originY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist && rng.next() < (1 - dist / maxDist) * 0.8) {
          this.connections.push({ from: i, to: j, strength: 1 - dist / maxDist });
        }
      }
    }

    this.time = rng.next() * 100;
  }

  update(dt: number): void {
    this.time += dt;

    // Spawn pulses — rate scales with evolution
    const pulseRate = 0.08 + this.evolution * 0.12;
    if (this.connections.length > 0 && Math.random() < dt * pulseRate) {
      if (this.pulses.length < 4 + Math.round(this.evolution * 4)) {
        const idx = Math.floor(Math.random() * this.connections.length);
        this.pulses.push({
          connIdx: idx, progress: 0,
          speed: 0.006 + Math.random() * 0.012,
          brightness: 0.6 + Math.random() * 0.4,
          forward: Math.random() > 0.5,
        });
      }
    }

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      this.pulses[i].progress += this.pulses[i].speed;
      if (this.pulses[i].progress > 1) this.pulses.splice(i, 1);
    }

    for (const n of this.nodes) {
      const breath = Math.sin(this.time * n.breathSpeed + n.phase);
      n.size = n.baseSize * (1 + breath * 0.25);
      n.x = n.originX + Math.cos(this.time * n.driftSpeed + n.driftAngle) * n.driftRadius;
      n.y = n.originY + Math.sin(this.time * n.driftSpeed * 0.7 + n.driftAngle) * n.driftRadius;
    }
  }

  draw(): void {
    const { ctx, size, color, nodes, connections, pulses, time } = this;
    const cx = size / 2, cy = size / 2, sc = size / 64;
    ctx.clearRect(0, 0, size, size);

    // Background disc
    ctx.beginPath(); ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,12,18,0.85)'; ctx.fill();

    // Ambient glow — STRONGER
    const bgBreath = 0.85 + 0.15 * Math.sin(time * 0.3);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.45);
    bg.addColorStop(0, rgba(color.primary, 0.35 * bgBreath));
    bg.addColorStop(0.35, rgba(color.primary, 0.12 * bgBreath));
    bg.addColorStop(1, 'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);

    // Connections — MUCH STRONGER lines
    for (const c of connections) {
      const f = nodes[c.from], t = nodes[c.to];
      const connBreath = 0.7 + 0.3 * Math.sin(time * 0.5 + c.from);

      // Glow line (wide, soft)
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = rgba(color.primary, c.strength * 0.2 * connBreath);
      ctx.lineWidth = 3 * sc; ctx.stroke();

      // Core line (thin, bright)
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = rgba(color.primary, c.strength * 0.6 * connBreath);
      ctx.lineWidth = 1 * sc; ctx.stroke();
    }

    // Pulses
    for (const p of pulses) {
      const c = connections[p.connIdx];
      if (!c) continue;
      const f = nodes[c.from], t = nodes[c.to];
      const prog = p.forward ? p.progress : 1 - p.progress;
      const px = f.x + (t.x - f.x) * prog;
      const py = f.y + (t.y - f.y) * prog;
      const fade = 1 - Math.abs(p.progress - 0.5) * 2;

      // Pulse glow — bigger and brighter
      const pg = ctx.createRadialGradient(px, py, 0, px, py, 8 * sc);
      pg.addColorStop(0, rgba(color.secondary, p.brightness * fade * 0.6));
      pg.addColorStop(0.4, rgba(color.primary, p.brightness * fade * 0.2));
      pg.addColorStop(1, 'transparent');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, 8 * sc, 0, Math.PI * 2); ctx.fill();

      // Pulse core
      ctx.beginPath(); ctx.arc(px, py, 1.8 * sc, 0, Math.PI * 2);
      ctx.fillStyle = rgba('#ffffff', p.brightness * fade * 0.7); ctx.fill();
    }

    // Node halos — STRONGER
    for (const n of nodes) {
      const breath = 0.8 + 0.2 * Math.sin(time * n.breathSpeed * 0.5 + n.phase);
      const b = n.brightness * breath;
      const hr = n.size * 5;
      const hg = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, hr);
      hg.addColorStop(0, rgba(color.primary, b * 0.35));
      hg.addColorStop(0.5, rgba(color.primary, b * 0.1));
      hg.addColorStop(1, 'transparent');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(n.x, n.y, hr, 0, Math.PI * 2); ctx.fill();
    }

    // Nodes
    for (const n of nodes) {
      const breath = 0.85 + 0.15 * Math.sin(time * n.breathSpeed + n.phase);
      const b = n.brightness * breath;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color.primary, b); ctx.fill();
      // White hot core
      if (n.baseSize > 1.2 * sc) {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.size * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = rgba('#ffffff', b * 0.45); ctx.fill();
      }
    }

    // Center core — STRONGER
    const coreBreath = 0.9 + 0.1 * Math.sin(time * 0.4);
    const coreR = size * 0.1 + this.evolution * size * 0.04;
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    core.addColorStop(0, rgba(color.secondary, 0.55 * coreBreath));
    core.addColorStop(0.4, rgba(color.primary, 0.2 * coreBreath));
    core.addColorStop(1, 'transparent');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();

    // Center dot
    ctx.beginPath(); ctx.arc(cx, cy, 1.5 * sc, 0, Math.PI * 2);
    ctx.fillStyle = rgba('#ffffff', 0.6 * coreBreath); ctx.fill();
  }
}
