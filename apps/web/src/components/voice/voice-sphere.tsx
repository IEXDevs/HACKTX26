"use client";

import { useEffect, useRef, useState } from "react";
import type * as Three from "three";
import { smoothLevel } from "./pcm";
import { BODY_FRAG, BODY_VERT, DOTS_FRAG, DOTS_VERT } from "./sphere-shaders";
import styles from "./voice-sphere.module.css";

export type VoiceSphereState = "idle" | "connecting" | "listening" | "thinking" | "speaking";

export interface VoiceSphereProps {
  state: VoiceSphereState;
  /** Mic level 0..1, read every frame while listening. */
  inputLevel?: () => number;
  /** Agent voice level 0..1, read every frame while speaking. */
  outputLevel?: () => number;
  /** Width and height in CSS pixels. The sphere itself fills about two thirds of it. */
  size?: number;
  className?: string;
}

interface Look {
  dim: number;
  swirl: number;
  speed: number;
  base: number;
  rim: number;
  dots: number;
  glow: number;
}

const LOOKS: Record<VoiceSphereState, Look> = {
  idle: { dim: 0.6, swirl: 0, speed: 0.22, base: 0, rim: 0.3, dots: 0.25, glow: 0.22 },
  connecting: { dim: 0.85, swirl: 0.35, speed: 0.5, base: 0.04, rim: 0.55, dots: 0.45, glow: 0.4 },
  listening: { dim: 1, swirl: 0, speed: 0.55, base: 0.02, rim: 0.7, dots: 0.6, glow: 0.5 },
  thinking: { dim: 1, swirl: 1, speed: 0.4, base: 0.05, rim: 0.95, dots: 0.75, glow: 0.6 },
  speaking: { dim: 1, swirl: 0, speed: 0.95, base: 0.03, rim: 1, dots: 0.9, glow: 0.7 },
};

function fibonacciSphere(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    out[i * 3] = Math.cos(a) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(a) * r;
  }
  return out;
}

function cssColor(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * A 3D orb that ripples with live voice levels. Draws with WebGL when it can and
 * falls back to a plain CSS orb otherwise. Decorative: pair it with visible status text.
 */
export function VoiceSphere({ state, inputLevel, outputLevel, size = 220, className }: VoiceSphereProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const live = useRef({ state, inputLevel, outputLevel });
  useEffect(() => {
    live.current = { state, inputLevel, outputLevel };
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let disposed = false;
    let raf = 0;
    let visible = true;
    let gl: {
      renderer: Three.WebGLRenderer;
      scene: Three.Scene;
      camera: Three.PerspectiveCamera;
      group: Three.Group;
      uniforms: Record<string, Three.IUniform>;
      failed: boolean;
      dispose: () => void;
    } | null = null;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    const onMotion = () => {
      reduced = motionQuery.matches;
    };
    motionQuery.addEventListener("change", onMotion);

    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
    });
    io.observe(wrap);

    const cur: Look = { ...LOOKS[live.current.state] };
    let level = 0;
    let phase = Math.random() * 100;
    let clock = 0;
    let last = performance.now();

    const fit = () => {
      if (!gl) return;
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      gl.renderer.setPixelRatio(dpr);
      gl.renderer.setSize(w, h, false);
      gl.camera.aspect = w / h;
      gl.camera.updateProjectionMatrix();
      gl.uniforms.uPx!.value = dpr * Math.max(0.6, Math.min(w, h) / 220);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, now - last);
      last = now;
      const { state: st, inputLevel: inLvl, outputLevel: outLvl } = live.current;
      const look = LOOKS[st];
      const k = 1 - Math.exp(-dt / 260);
      for (const key of Object.keys(cur) as (keyof Look)[]) cur[key] += (look[key] - cur[key]) * k;

      let target = 0;
      if (st === "speaking") target = outLvl?.() ?? 0;
      else if (st === "listening") target = inLvl?.() ?? 0;
      else if (st === "connecting") target = 0.15 + 0.15 * Math.sin(now / 260);
      level = smoothLevel(level, Math.max(0, Math.min(1, target)), dt, 50, 220);

      const motion = reduced ? 0.15 : 1;
      phase += (dt / 1000) * cur.speed * motion;
      clock += dt / 1000;
      const amp = cur.base + level * (reduced ? 0.35 : 1);
      const breath = reduced ? 0 : Math.sin(clock * 0.9) * 0.018;

      const glow = glowRef.current;
      if (glow) {
        glow.style.opacity = String(Math.min(1, cur.glow * (0.7 + level * 0.8)));
        glow.style.transform = `scale(${1 + breath + level * (reduced ? 0.06 : 0.22)})`;
      }
      if (!gl) {
        const orb = orbRef.current;
        if (orb) {
          orb.style.transform = `scale(${1 + level * (reduced ? 0.04 : 0.14)})`;
          orb.style.opacity = String(0.55 + 0.45 * cur.dim);
        }
        return;
      }
      if (!visible || document.hidden) return;
      if (gl.failed) {
        gl.dispose();
        return;
      }
      const u = gl.uniforms;
      u.uTime!.value = phase;
      u.uAmp!.value = amp;
      u.uSwirl!.value = cur.swirl * (reduced ? 0.3 : 1);
      u.uBreath!.value = breath;
      u.uDim!.value = cur.dim;
      u.uRim!.value = cur.rim;
      u.uDots!.value = cur.dots;
      if (!reduced) gl.group.rotation.y = phase * 0.12;
      if (gl.renderer.getPixelRatio() !== Math.min(window.devicePixelRatio || 1, 2)) fit();
      gl.renderer.render(gl.scene, gl.camera);
    };
    raf = requestAnimationFrame(frame);

    const init = async () => {
      let THREE: typeof Three;
      try {
        THREE = await import("three");
      } catch {
        return;
      }
      if (disposed) return;
      let renderer: Three.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
      } catch {
        return;
      }
      renderer.setClearColor(0x000000, 0);
      const canvas = renderer.domElement;
      canvas.className = styles.canvas ?? "";
      canvas.setAttribute("aria-hidden", "true");

      const deep = new THREE.Color(cssColor(wrap, "--sphere-horizon", "#166b66")).multiplyScalar(0.55);
      const uniforms: Record<string, Three.IUniform> = {
        uTime: { value: 0 },
        uAmp: { value: 0 },
        uSwirl: { value: 0 },
        uBreath: { value: 0 },
        uDim: { value: cur.dim },
        uRim: { value: cur.rim },
        uDots: { value: cur.dots },
        uPx: { value: 1 },
        uDeep: { value: deep },
        uMid: { value: new THREE.Color(cssColor(wrap, "--sphere-wave", "#2aa874")) },
        uLight: { value: new THREE.Color(cssColor(wrap, "--sphere-crest", "#9be8bd")) },
      };

      const big = Math.min(wrap.clientWidth, wrap.clientHeight) > 140;
      const bodyGeo = new THREE.IcosahedronGeometry(1, big ? 24 : 12);
      const bodyMat = new THREE.ShaderMaterial({ uniforms, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG });
      const dotsGeo = new THREE.BufferGeometry();
      dotsGeo.setAttribute("position", new THREE.BufferAttribute(fibonacciSphere(big ? 1400 : 600), 3));
      const dotsMat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: DOTS_VERT,
        fragmentShader: DOTS_FRAG,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
      });

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
      camera.position.set(0, 0, 4.8);
      const group = new THREE.Group();
      group.add(new THREE.Mesh(bodyGeo, bodyMat));
      const dots = new THREE.Points(dotsGeo, dotsMat);
      dots.renderOrder = 1;
      group.add(dots);
      scene.add(group);

      const onLost = (e: Event) => {
        e.preventDefault();
        teardownGl();
      };
      canvas.addEventListener("webglcontextlost", onLost);

      const teardownGl = () => {
        if (!gl) return;
        canvas.removeEventListener("webglcontextlost", onLost);
        bodyGeo.dispose();
        bodyMat.dispose();
        dotsGeo.dispose();
        dotsMat.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
        gl = null;
        if (!disposed) setReady(false);
      };

      const state = { renderer, scene, camera, group, uniforms, failed: false, dispose: teardownGl };
      // Shader problems surface on first use; drop back to the CSS orb when they do.
      renderer.debug.onShaderError = () => {
        console.warn("Voice sphere: shader failed to compile, using the plain orb.");
        state.failed = true;
      };
      gl = state;
      wrap.appendChild(canvas);
      fit();
      setReady(true);
    };
    void init();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      motionQuery.removeEventListener("change", onMotion);
      gl?.dispose();
    };
  }, []);

  const cls = [styles.sphere, ready && styles.ready, state === "idle" && styles.dim, className].filter(Boolean).join(" ");
  return (
    <div ref={wrapRef} className={cls} style={{ width: size, height: size }} aria-hidden>
      <div ref={glowRef} className={styles.glow} />
      <div className={styles.orbInner}>
        <div ref={orbRef} className={styles.orb} />
      </div>
    </div>
  );
}
