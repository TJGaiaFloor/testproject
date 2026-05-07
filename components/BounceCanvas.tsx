"use client";

import { useEffect, useRef, useState } from "react";

// White is dropped from the cycle — invisible on a white background.
// Navy replaces it for high-contrast pop.
const COLORS = [
  "#7CB342", // GAIA Green
  "#C5A258", // GAIA Gold
  "#1a1a2e", // Navy (replacing White)
  "#D4513D", // Warm Red
  "#4FC3F7", // Sky Blue
  "#AB47BC", // Soft Violet
  "#FF8A65", // Ember Orange
];

const TRAIL_LENGTH = 5;
const MAX_INSTANCES = 20;
const SPEED = 3.5;
const FLASH_MS = 100;
const BG = "#FFFFFF";
const FLASH_RGB = "26, 26, 46"; // navy — visible against white bg
const LOGO_WIDTH_VW = 0.22;

const SPROUT_HEIGHT_PX = 90;
const SPROUT_GROW_MS = 350;
const SPROUT_HOLD_MS = 1400;
const SPROUT_FADE_MS = 600;
const SPROUT_TOTAL_MS = SPROUT_GROW_MS + SPROUT_HOLD_MS + SPROUT_FADE_MS;

const CORNER_TEXT_MS = 2200;
const PARTICLE_BURST = 42;
const PARTICLE_GRAVITY = 0.18;

type Instance = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  colorIndex: number;
  trail: { x: number; y: number }[];
};

type Sprout = {
  x: number;
  y: number;
  rotation: number; // 0=grows up, π=down, π/2=right (off left wall), -π/2=left (off right wall)
  startTime: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  startTime: number;
  life: number;
  size: number;
};

function randomDirection(): { vx: number; vy: number } {
  const deg = 20 + Math.random() * 50;
  const rad = (deg * Math.PI) / 180;
  const sx = Math.random() < 0.5 ? -1 : 1;
  const sy = Math.random() < 0.5 ? -1 : 1;
  return { vx: Math.cos(rad) * SPEED * sx, vy: Math.sin(rad) * SPEED * sy };
}

export default function BounceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instancesRef = useRef<Instance[]>([]);
  const sproutsRef = useRef<Sprout[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const cornerHitRef = useRef<{ time: number } | null>(null);
  const flashUntilRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(false);
  const idCounterRef = useRef(0);
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let cancelled = false;
    let onResize: (() => void) | null = null;
    let onPointerDown: ((e: PointerEvent) => void) | null = null;
    let onKey: ((e: KeyboardEvent) => void) | null = null;

    const setup = (img: HTMLImageElement, sprout: HTMLImageElement) => {
      if (cancelled) return;
      const sproutAspect = sprout.naturalWidth / sprout.naturalHeight;

      // Pre-tint the logo for each palette color via source-in compositing.
      // Cached so per-frame draws are just drawImage calls.
      const tintedCache = new Map<string, HTMLCanvasElement>();
      for (const color of COLORS) {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const cctx = c.getContext("2d");
        if (!cctx) continue;
        cctx.drawImage(img, 0, 0);
        cctx.globalCompositeOperation = "source-in";
        cctx.fillStyle = color;
        cctx.fillRect(0, 0, c.width, c.height);
        tintedCache.set(color, c);
      }

      const dpr = window.devicePixelRatio || 1;

      const resize = () => {
        canvas.width = Math.floor(window.innerWidth * dpr);
        canvas.height = Math.floor(window.innerHeight * dpr);
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();

      const dims = () => {
        const w = window.innerWidth * LOGO_WIDTH_VW;
        const h = w * (img.naturalHeight / img.naturalWidth);
        return { w, h };
      };

      const makeInitial = (): Instance => {
        const dir = randomDirection();
        const { w, h } = dims();
        return {
          id: idCounterRef.current++,
          x: window.innerWidth / 2 - w / 2,
          y: window.innerHeight / 2 - h / 2,
          vx: dir.vx,
          vy: dir.vy,
          colorIndex: 0,
          trail: [],
        };
      };

      instancesRef.current = [makeInitial()];

      const ensureAudioCtx = (): AudioContext | null => {
        try {
          if (!audioCtxRef.current) {
            const Ctx =
              window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            audioCtxRef.current = new Ctx();
          }
          const ac = audioCtxRef.current;
          if (ac && ac.state === "suspended") ac.resume();
          return ac;
        } catch {
          return null;
        }
      };

      const playCelebration = () => {
        if (!soundOnRef.current) return;
        const ac = ensureAudioCtx();
        if (!ac) return;
        const now = ac.currentTime;
        // Major triad bell — C5, E5, G5 — quick attack, long decay.
        for (const freq of [523.25, 659.25, 783.99]) {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = "triangle";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.09, now + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
          osc.connect(gain).connect(ac.destination);
          osc.start(now);
          osc.stop(now + 0.6);
        }
      };

      const playBounce = () => {
        if (!soundOnRef.current) return;
        try {
          if (!audioCtxRef.current) {
            const Ctx =
              window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            audioCtxRef.current = new Ctx();
          }
          const ac = audioCtxRef.current;
          if (!ac) return;
          if (ac.state === "suspended") ac.resume();
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = "sine";
          osc.frequency.value = 200 + Math.random() * 120;
          const now = ac.currentTime;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.15, now + 0.005);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
          osc.connect(gain).connect(ac.destination);
          osc.start(now);
          osc.stop(now + 0.14);
        } catch {
          // Audio failures should never break the animation.
        }
      };

      const draw = () => {
        if (cancelled) return;
        const ww = window.innerWidth;
        const wh = window.innerHeight;

        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, ww, wh);

        const tNowFrame = performance.now();
        const sproutH = SPROUT_HEIGHT_PX;
        const sproutW = sproutH * sproutAspect;
        for (let i = sproutsRef.current.length - 1; i >= 0; i--) {
          const s = sproutsRef.current[i];
          const elapsed = tNowFrame - s.startTime;
          if (elapsed >= SPROUT_TOTAL_MS) {
            sproutsRef.current.splice(i, 1);
            continue;
          }
          let scale = 1;
          let alpha = 1;
          if (elapsed < SPROUT_GROW_MS) {
            const t = elapsed / SPROUT_GROW_MS;
            scale = 1 - Math.pow(1 - t, 3);
          } else if (elapsed > SPROUT_GROW_MS + SPROUT_HOLD_MS) {
            const t = (elapsed - SPROUT_GROW_MS - SPROUT_HOLD_MS) / SPROUT_FADE_MS;
            alpha = 1 - t;
          }
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(s.rotation);
          ctx.scale(scale, scale);
          ctx.globalAlpha = alpha;
          ctx.drawImage(sprout, -sproutW / 2, -sproutH, sproutW, sproutH);
          ctx.restore();
        }
        ctx.globalAlpha = 1;

        const { w: lw, h: lh } = dims();

        for (const inst of instancesRef.current) {
          inst.trail.push({ x: inst.x, y: inst.y });
          while (inst.trail.length > TRAIL_LENGTH) inst.trail.shift();

          inst.x += inst.vx;
          inst.y += inst.vy;

          let bouncedX = false;
          let bouncedY = false;
          if (inst.x <= 0) {
            inst.x = 0;
            inst.vx = Math.abs(inst.vx);
            bouncedX = true;
          } else if (inst.x + lw >= ww) {
            inst.x = ww - lw;
            inst.vx = -Math.abs(inst.vx);
            bouncedX = true;
          }
          if (inst.y <= 0) {
            inst.y = 0;
            inst.vy = Math.abs(inst.vy);
            bouncedY = true;
          } else if (inst.y + lh >= wh) {
            inst.y = wh - lh;
            inst.vy = -Math.abs(inst.vy);
            bouncedY = true;
          }

          if (bouncedX || bouncedY) {
            inst.colorIndex = (inst.colorIndex + 1) % COLORS.length;
            playBounce();
          }
          const tNow = performance.now();
          if (bouncedX) {
            const onLeft = inst.x === 0;
            sproutsRef.current.push({
              x: onLeft ? 0 : ww,
              y: inst.y + lh / 2,
              rotation: onLeft ? Math.PI / 2 : -Math.PI / 2,
              startTime: tNow,
            });
          }
          if (bouncedY) {
            const onTop = inst.y === 0;
            sproutsRef.current.push({
              x: inst.x + lw / 2,
              y: onTop ? 0 : wh,
              rotation: onTop ? Math.PI : 0,
              startTime: tNow,
            });
          }
          if (bouncedX && bouncedY) {
            flashUntilRef.current = tNow + FLASH_MS;
            const cx = inst.x === 0 ? 0 : ww;
            const cy = inst.y === 0 ? 0 : wh;
            const aim = Math.atan2(wh / 2 - cy, ww / 2 - cx);
            for (let p = 0; p < PARTICLE_BURST; p++) {
              const angle = aim - Math.PI / 2 + Math.random() * Math.PI;
              const speed = 4 + Math.random() * 9;
              particlesRef.current.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                startTime: tNow,
                life: 800 + Math.random() * 700,
                size: 2 + Math.random() * 4,
              });
            }
            cornerHitRef.current = { time: tNow };
            playCelebration();
          }

          const tinted = tintedCache.get(COLORS[inst.colorIndex]);
          if (!tinted) continue;

          for (let i = 0; i < inst.trail.length; i++) {
            const p = inst.trail[i];
            const a = ((i + 1) / (inst.trail.length + 2)) * 0.3;
            ctx.globalAlpha = a;
            ctx.drawImage(tinted, p.x, p.y, lw, lh);
          }
          ctx.globalAlpha = 1;
          ctx.drawImage(tinted, inst.x, inst.y, lw, lh);
        }

        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
          const p = particlesRef.current[i];
          const age = tNowFrame - p.startTime;
          if (age >= p.life) {
            particlesRef.current.splice(i, 1);
            continue;
          }
          p.x += p.vx;
          p.y += p.vy;
          p.vy += PARTICLE_GRAVITY;
          ctx.globalAlpha = 1 - age / p.life;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        if (cornerHitRef.current) {
          const age = tNowFrame - cornerHitRef.current.time;
          if (age >= CORNER_TEXT_MS) {
            cornerHitRef.current = null;
          } else {
            const t = age / CORNER_TEXT_MS;
            let scale = 1;
            let alpha = 1;
            if (t < 0.12) {
              const tt = t / 0.12;
              scale = 0.5 + 0.7 * (1 - Math.pow(1 - tt, 3));
              alpha = tt;
            } else if (t < 0.22) {
              const tt = (t - 0.12) / 0.1;
              scale = 1.2 - 0.2 * tt;
            } else if (t < 0.78) {
              scale = 1;
            } else {
              const tt = (t - 0.78) / 0.22;
              scale = 1 + 0.06 * tt;
              alpha = 1 - tt;
            }
            ctx.save();
            const fontSize = Math.min(ww, wh) * 0.075;
            ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.translate(ww / 2, wh / 2);
            ctx.scale(scale, scale);
            ctx.globalAlpha = alpha;
            ctx.shadowColor = "#7CB342";
            ctx.shadowBlur = 35;
            ctx.fillStyle = "#1a1a2e";
            ctx.fillText("every step matters", 0, 0);
            ctx.shadowBlur = 0;
            ctx.restore();
          }
        }

        const now = performance.now();
        if (flashUntilRef.current > now) {
          const remaining = flashUntilRef.current - now;
          const alpha = (remaining / FLASH_MS) * 0.5;
          ctx.fillStyle = `rgba(${FLASH_RGB},${alpha})`;
          ctx.fillRect(0, 0, ww, wh);
        }

        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);

      onResize = () => resize();
      window.addEventListener("resize", onResize);

      onPointerDown = (e: PointerEvent) => {
        if (instancesRef.current.length >= MAX_INSTANCES) return;
        const dir = randomDirection();
        const { w, h } = dims();
        instancesRef.current.push({
          id: idCounterRef.current++,
          x: e.clientX - w / 2,
          y: e.clientY - h / 2,
          vx: dir.vx,
          vy: dir.vy,
          colorIndex: Math.floor(Math.random() * COLORS.length),
          trail: [],
        });
      };
      window.addEventListener("pointerdown", onPointerDown);

      onKey = (e: KeyboardEvent) => {
        const k = e.key.toLowerCase();
        if (k === "r") {
          instancesRef.current = [makeInitial()];
          sproutsRef.current = [];
          particlesRef.current = [];
          cornerHitRef.current = null;
          flashUntilRef.current = 0;
        } else if (k === "f") {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.().catch(() => {});
          } else {
            document.exitFullscreen?.().catch(() => {});
          }
        } else if (k === "s") {
          setSoundOn((prev) => !prev);
        }
      };
      window.addEventListener("keydown", onKey);
    };

    const img = new Image();
    const sprout = new Image();
    let logoReady = false;
    let sproutReady = false;
    const tryStart = () => {
      if (logoReady && sproutReady) setup(img, sprout);
    };
    img.onload = () => {
      logoReady = true;
      tryStart();
    };
    sprout.onload = () => {
      sproutReady = true;
      tryStart();
    };
    img.src = "/gaia-logo.png";
    sprout.src = "/sprout.svg";

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (onResize) window.removeEventListener("resize", onResize);
      if (onPointerDown) window.removeEventListener("pointerdown", onPointerDown);
      if (onKey) window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="fixed inset-0 block" />
      <div className="group fixed bottom-0 right-0 h-24 w-48">
        <span className="pointer-events-none absolute bottom-2 right-3 select-none text-xs text-[#555] opacity-0 transition-opacity duration-500 group-hover:opacity-100">
          every step matters&trade;
        </span>
      </div>
      {soundOn && (
        <div className="pointer-events-none fixed right-3 top-2 select-none text-[10px] tracking-widest text-[#555]">
          ♪ SOUND ON
        </div>
      )}
    </>
  );
}
