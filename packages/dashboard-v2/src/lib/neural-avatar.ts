// NeuralAvatar Engine — Glowing Orb style
// Simplified from crab-language, optimized for 52-96px dashboard avatars

export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ---- Seeded RNG ----

class SeededRNG {
  private s: number;
  constructor(seed: number) { this.s = seed; }
  next(): number { this.s = (this.s * 1103515245 + 12345) & 0x7fffffff; return (this.s % 10000) / 10000; }
  range(min: number, max: number): number { return min + this.next() * (max - min); }
  int(min: number, max: number): number { return Math.floor(this.range(min, max + 1)); }
}

// ---- Color derivation ----

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

export interface AvatarColors {
  primary: string;
  secondary: string;
}

export function colorFromAgent(agentId: string): AvatarColors {
  const h = hashString(agentId);
  const hue = h % 360;
  const sat = 65 + (h >> 8) % 20;
  return {
    primary: hslToHex(hue, sat, 65 + (h >> 16) % 10),
    secondary: hslToHex((hue + 30) % 360, Math.min(95, sat + 15), 75 + (h >> 16) % 12),
  };
}

function rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

// ---- Node types ----

interface OrbNode {
  x: number;
  y: number;
  originX: number;
  originY: number;
  size: number;
  brightness: number;
  phase: number;
  breathSpeed: number;
  driftAngle: number;
  driftSpeed: number;
  driftRadius: number;
}

interface OrbConnection {
  from: number;
  to: number;
}

// ---- Engine ----

export class OrbAvatarEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private color: AvatarColors;
  private nodes: OrbNode[] = [];
  private connections: OrbConnection[] = [];
  private time = 0;

  constructor(canvas: HTMLCanvasElement, agentId: string) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    this.ctx = ctx;
    this.size = canvas.width / 2; // retina-scaled
    this.color = colorFromAgent(agentId);

    const rng = new SeededRNG(hashString(agentId));
    const sc = this.size / 64;
    const cx = this.size / 2, cy = this.size / 2;

    // Generate 5-8 orbital nodes
    const count = rng.int(5, 8);
    for (let i = 0; i < count; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = rng.range(this.size * 0.08, this.size * 0.35);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      this.nodes.push({
        x, y, originX: x, originY: y,
        size: rng.range(1.5, 3) * sc,
        brightness: rng.range(0.5, 1),
        phase: rng.next() * Math.PI * 2,
        breathSpeed: rng.range(0.4, 1.5),
        driftAngle: rng.next() * Math.PI * 2,
        driftSpeed: rng.range(0.1, 0.4),
        driftRadius: rng.range(0.3, 1.2) * sc,
      });
    }

    // Build connections (nearby nodes)
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const dx = this.nodes[i].originX - this.nodes[j].originX;
        const dy = this.nodes[i].originY - this.nodes[j].originY;
        if (Math.sqrt(dx * dx + dy * dy) < this.size * 0.4 && rng.next() < 0.6) {
          this.connections.push({ from: i, to: j });
        }
      }
    }

    this.time = rng.next() * 100;
  }

  update(dt: number): void {
    this.time += dt;
    for (const n of this.nodes) {
      n.x = n.originX + Math.cos(this.time * n.driftSpeed + n.driftAngle) * n.driftRadius;
      n.y = n.originY + Math.sin(this.time * n.driftSpeed * 0.7 + n.driftAngle) * n.driftRadius;
    }
  }

  draw(): void {
    const { ctx, size, color, nodes, connections, time } = this;
    const cx = size / 2, cy = size / 2, sc = size / 64;

    ctx.clearRect(0, 0, size, size);

    // Background disc
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15,15,22,0.8)';
    ctx.fill();

    // Big soft glow
    const bgBreath = 0.85 + 0.15 * Math.sin(time * 0.3);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.45);
    bg.addColorStop(0, rgba(color.primary, 0.25 * bgBreath));
    bg.addColorStop(0.4, rgba(color.primary, 0.08 * bgBreath));
    bg.addColorStop(1, 'transparent');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // Connections
    for (const c of connections) {
      const f = nodes[c.from], t = nodes[c.to];
      const connBreath = 0.7 + 0.3 * Math.sin(time * 0.5 + c.from);
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = rgba(color.primary, 0.3 * connBreath);
      ctx.lineWidth = 0.8 * sc;
      ctx.stroke();
    }

    // Node halos + nodes
    for (const n of nodes) {
      const breath = 0.8 + 0.2 * Math.sin(time * n.breathSpeed + n.phase);
      const b = n.brightness * breath;

      // Halo glow
      const hg = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.size * 5);
      hg.addColorStop(0, rgba(color.primary, b * 0.3));
      hg.addColorStop(1, 'transparent');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.size * 5, 0, Math.PI * 2);
      ctx.fill();

      // Node dot
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.size * breath, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color.primary, b);
      ctx.fill();

      // White hot core
      if (n.size > 1.5 * sc) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.size * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = rgba('#ffffff', b * 0.4);
        ctx.fill();
      }
    }

    // Center core glow
    const coreBreath = 0.9 + 0.1 * Math.sin(time * 0.4);
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.14);
    core.addColorStop(0, rgba(color.secondary, 0.5 * coreBreath));
    core.addColorStop(0.5, rgba(color.primary, 0.15 * coreBreath));
    core.addColorStop(1, 'transparent');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // Center bright dot
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5 * sc, 0, Math.PI * 2);
    ctx.fillStyle = rgba('#ffffff', 0.6 * coreBreath);
    ctx.fill();
  }
}
