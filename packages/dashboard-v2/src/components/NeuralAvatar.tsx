import { useEffect, useRef } from 'react';
import {
  NeuralAvatarEngine,
  type AvatarParams,
  colorFromMind,
  hashString,
  getEvoParams,
  TOPOLOGY_GENERATORS,
  renderTierFromSize,
  type TopologyType,
} from '@/lib/neural-avatar';

interface NeuralAvatarProps {
  agentId: string;
  size?: number;
  online?: boolean;
  /** 0-1, controls node count, pulse rate, glow intensity */
  evolution?: number;
}

const TOPO_ORDER: TopologyType[] = ['hub', 'mesh', 'chain', 'spiral', 'cluster', 'star'];

export function NeuralAvatar({ agentId, size = 52, online = false, evolution = 0.3 }: NeuralAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<NeuralAvatarEngine | null>(null);
  const rafRef = useRef<number>(0);
  const visibleRef = useRef(true);

  const color = colorFromMind(agentId);
  const seed = hashString(agentId);
  const topoType = TOPO_ORDER[seed % TOPO_ORDER.length];
  const evoParams = getEvoParams(evolution);
  const renderTier = renderTierFromSize(size);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = size * 2;
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(2, 2);

    const params: AvatarParams = {
      seed,
      primary: color.primary,
      secondary: color.secondary,
      nodeCount: evoParams.nodeCount,
      evolution,
      topoGen: TOPOLOGY_GENERATORS[topoType],
      voidSectors: [],
      renderTier,
    };

    const engine = new NeuralAvatarEngine(canvas, params);
    engineRef.current = engine;
    engine.rebuild();
    engine.draw();

    if (!online) return;

    const loop = () => {
      if (visibleRef.current) {
        engine.update(0.016);
        engine.draw();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      engineRef.current = null;
    };
  }, [agentId, size, online, evolution]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !online) return;

    const observer = new IntersectionObserver(
      ([entry]) => { visibleRef.current = entry.isIntersecting; },
      { threshold: 0.1 },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [online]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        opacity: online ? 1 : 0.4,
        transition: 'opacity 0.3s',
      }}
    />
  );
}
