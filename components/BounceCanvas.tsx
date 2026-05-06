"use client";

import { useEffect, useRef, useState } from "react";

const COLORS = [
  "#7CB342", // GAIA Green
  "#C5A258", // GAIA Gold
  "#FFFFFF", // White
  "#D4513D", // Warm Red
  "#4FC3F7", // Sky Blue
  "#AB47BC", // Soft Violet
  "#FF8A65", // Ember Orange
];

const TRAIL_LENGTH = 5;
const MAX_INSTANCES = 20;
const SPEED = 3.5;
const FLASH_MS = 100;
const BG = "#1a1a2e";

type Instance = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  colorIndex: number;
  trail: { x: number; y: number }[];
};

function randomDirection(): { vx: number; vy: number } {
  // Random angle in 20°–70° range, then random sign per axis — avoids near-horizontal/vertical loops.
  const deg = 20 + Math.random() * 50;
  const rad = (deg * Math.PI) / 180;
  const sx = Math.random() < 0.5 ? -1 : 1;
  const sy = Math.random() < 0.5 ? -1 : 1;
  return { vx: Math.cos(rad) * SPEED * sx, vy: Math.sin(rad) * SPEED * sy };
}

function alphaHex(a: number): string {
  const v = Math.max(0, Math.min(255, Math.round(a * 255)));
  return v.toString(16).padStart(2, "0");
}

export default function BounceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instancesRef = useRef<Instance[]>([]);
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

    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const fontSize = () => Math.round(window.innerWidth * 0.08);
    const fontString = () => `900 ${fontSize()}px var(--font-inter), Inter, system-ui, sans-serif`;

    const measure = () => {
      ctx.font = fontString();
      const m = ctx.measureText("GAIA");
      const ascent = m.actualBoundingBoxAscent ?? fontSize() * 0.75;
      const descent = m.actualBoundingBoxDescent ?? fontSize() * 0.25;
      return { width: m.width, height: ascent + descent, ascent };
    };

    const makeInitial = (): Instance => {
      const dir = randomDirection();
      return {
        id: idCounterRef.current++,
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        vx: dir.vx,
        vy: dir.vy,
        colorIndex: 0,
        trail: [],
      };
    };

    instancesRef.current = [makeInitial()];

    const playBounce = () => {
      if (!soundOnRef.current) return;
      try {
        if (!audioCtxRef.current) {
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

    let raf = 0;
    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      ctx.font = fontString();
      ctx.textBaseline = "top";
      const { width: textW, height: textH } = measure();

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
        } else if (inst.x + textW >= w) {
          inst.x = w - textW;
          inst.vx = -Math.abs(inst.vx);
          bouncedX = true;
        }

        if (inst.y <= 0) {
          inst.y = 0;
          inst.vy = Math.abs(inst.vy);
          bouncedY = true;
        } else if (inst.y + textH >= h) {
          inst.y = h - textH;
          inst.vy = -Math.abs(inst.vy);
          bouncedY = true;
        }

        if (bouncedX || bouncedY) {
          inst.colorIndex = (inst.colorIndex + 1) % COLORS.length;
          playBounce();
        }
        if (bouncedX && bouncedY) {
          flashUntilRef.current = performance.now() + FLASH_MS;
        }

        const color = COLORS[inst.colorIndex];
        for (let i = 0; i < inst.trail.length; i++) {
          const p = inst.trail[i];
          const a = ((i + 1) / (inst.trail.length + 2)) * 0.35;
          ctx.fillStyle = color + alphaHex(a);
          ctx.fillText("GAIA", p.x, p.y);
        }
        ctx.fillStyle = color;
        ctx.fillText("GAIA", inst.x, inst.y);
      }

      const now = performance.now();
      if (flashUntilRef.current > now) {
        const remaining = flashUntilRef.current - now;
        const alpha = remaining / FLASH_MS;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillRect(0, 0, w, h);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    const onPointerDown = (e: PointerEvent) => {
      if (instancesRef.current.length >= MAX_INSTANCES) return;
      const dir = randomDirection();
      instancesRef.current.push({
        id: idCounterRef.current++,
        x: e.clientX,
        y: e.clientY,
        vx: dir.vx,
        vy: dir.vy,
        colorIndex: Math.floor(Math.random() * COLORS.length),
        trail: [],
      });
    };
    window.addEventListener("pointerdown", onPointerDown);

    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "r") {
        instancesRef.current = [makeInitial()];
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

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
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
