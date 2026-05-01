import { Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export interface GrainientProps {
  color1?: string;
  color2?: string;
  color3?: string;
  timeSpeed?: number;
  colorBalance?: number;
  warpStrength?: number;
  warpFrequency?: number;
  warpSpeed?: number;
  warpAmplitude?: number;
  blendAngle?: number;
  blendSoftness?: number;
  rotationAmount?: number;
  noiseScale?: number;
  grainAmount?: number;
  grainScale?: number;
  grainAnimated?: boolean;
  contrast?: number;
  gamma?: number;
  saturation?: number;
  centerX?: number;
  centerY?: number;
  zoom?: number;
  /** When true, output animated grayscale grain only — designed for use as
   * an overlay over photo backdrops with `mix-blend-mode: overlay`. */
  grainOnly?: boolean;
  className?: string;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1]!, 16) / 255,
    parseInt(result[2]!, 16) / 255,
    parseInt(result[3]!, 16) / 255,
  ];
};

const VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uGrainOnly;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void main(){
  float t = iTime * uTimeSpeed;
  vec2 uv = gl_FragCoord.xy / iResolution.xy;

  // Grain texture is locked to screen UV — only animates if explicitly
  // opted in. Movement comes from the warped blob field and the
  // slow-noise mask below modulating where this static grain is visible.
  vec2 grainUv = uv * max(uGrainScale, 0.001);
  if (uGrainAnimated > 0.5) { grainUv += vec2(iTime * 0.05); }
  float grain = fract(sin(dot(grainUv, vec2(12.9898, 78.233))) * 43758.5453);

  // Slow low-frequency animated noise mask — produces patches of grain
  // that fade in and out across the surface, independent of the color
  // blobs. This is what gives the surface its "breathing" feel.
  float mask = noise(uv * 2.5 + vec2(iTime * 0.15, iTime * -0.12));
  mask = smoothstep(0.25, 0.85, mask);

  // Warped UV — the field that animates the "blobs". Shared by both modes
  // so grainOnly mode gets the same moving structure as the colored mode.
  float ratio = iResolution.x / iResolution.y;
  vec2 tuv = uv - 0.5 + uCenterOffset;
  tuv /= max(uZoom, 0.001);

  float degree = noise(vec2(t * 0.1, tuv.x * tuv.y) * uNoiseScale);
  tuv.y *= 1.0 / ratio;
  tuv *= Rot(radians((degree - 0.5) * uRotationAmount + 180.0));
  tuv.y *= ratio;

  float frequency = uWarpFrequency;
  float ws = max(uWarpStrength, 0.001);
  float amplitude = uWarpAmplitude / ws;
  float warpTime = t * uWarpSpeed;
  tuv.x += sin(tuv.y * frequency + warpTime) / amplitude;
  tuv.y += sin(tuv.x * (frequency * 1.5) + warpTime) / (amplitude * 0.5);

  float b = uColorBalance;
  float s = max(uBlendSoftness, 0.0);
  mat2 blendRot = Rot(radians(uBlendAngle));
  float blendX = (tuv * blendRot).x;
  float edge0 = -0.3 - b - s;
  float edge1 = 0.2 - b + s;
  float v0 = 0.5 - b + s;
  float v1 = -0.3 - b - s;
  float blobX = S(edge0, edge1, blendX);
  float blobY = S(v0, v1, tuv.y);

  if (uGrainOnly > 0.5) {
    // Moving patches of grain: grain pattern stays put, the slow mask
    // (and to a lesser extent the blob field) shape its visibility.
    // Output is grayscale centered on 0.5 — pair with mix-blend-overlay.
    float blob = smoothstep(0.1, 0.9, mix(blobX, blobY, 0.5));
    float visibility = mix(mask, blob, 0.35);
    float v = 0.5 + (grain - 0.5) * uGrainAmount * 2.0 * visibility;
    fragColor = vec4(vec3(v), 1.0);
    return;
  }

  vec3 layer1 = mix(uColor3, uColor2, blobX);
  vec3 layer2 = mix(uColor2, uColor1, blobX);
  vec3 col = mix(layer1, layer2, blobY);

  col += (grain - 0.5) * uGrainAmount * mask;
  col = (col - 0.5) * uContrast + 0.5;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturation);
  col = pow(max(col, 0.0), vec3(1.0 / max(uGamma, 0.001)));
  col = clamp(col, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;

/**
 * Animated WebGL grainient — three-color gradient with warp + noise + grain,
 * all moving over time. Pass `grainOnly` to render only the grain channel
 * (for layering over photo backdrops with `mix-blend-mode: overlay`).
 */
export function Grainient({
  color1 = "#FF9FFC",
  color2 = "#5227FF",
  color3 = "#B497CF",
  timeSpeed = 0.25,
  colorBalance = 0,
  warpStrength = 1,
  warpFrequency = 5,
  warpSpeed = 2,
  warpAmplitude = 50,
  blendAngle = 0,
  blendSoftness = 0.05,
  rotationAmount = 500,
  noiseScale = 2,
  grainAmount = 0.1,
  grainScale = 2,
  grainAnimated = false,
  contrast = 1.5,
  gamma = 1,
  saturation = 1,
  centerX = 0,
  centerY = 0,
  zoom = 0.9,
  grainOnly = false,
  className,
}: GrainientProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const programRef = useRef<Program | null>(null);
  // Color uniforms are eased toward these targets each frame so prop
  // changes morph smoothly (e.g. swapping jams in the carousel) instead
  // of snapping. Initialized lazily on first prop apply.
  const targetsRef = useRef({
    c1: hexToRgb(color1),
    c2: hexToRgb(color2),
    c3: hexToRgb(color3),
    initialized: false,
  });

  // Init once: the renderer + RAF loop are stable across prop changes; only
  // uniform values flow through (see the second effect).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Renderer({
      webgl: 2,
      alpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });
    const gl = renderer.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const program = new Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uTimeSpeed: { value: 0 },
        uColorBalance: { value: 0 },
        uWarpStrength: { value: 1 },
        uWarpFrequency: { value: 0 },
        uWarpSpeed: { value: 0 },
        uWarpAmplitude: { value: 1 },
        uBlendAngle: { value: 0 },
        uBlendSoftness: { value: 0 },
        uRotationAmount: { value: 0 },
        uNoiseScale: { value: 1 },
        uGrainAmount: { value: 0 },
        uGrainScale: { value: 1 },
        uGrainAnimated: { value: 0 },
        uContrast: { value: 1 },
        uGamma: { value: 1 },
        uSaturation: { value: 1 },
        uCenterOffset: { value: new Float32Array([0, 0]) },
        uZoom: { value: 1 },
        uColor1: { value: new Float32Array([1, 1, 1]) },
        uColor2: { value: new Float32Array([1, 1, 1]) },
        uColor3: { value: new Float32Array([1, 1, 1]) },
        uGrainOnly: { value: 0 },
      },
    });
    programRef.current = program;

    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)));
      const res = (program.uniforms.iResolution as { value: Float32Array }).value;
      res[0] = gl.drawingBufferWidth;
      res[1] = gl.drawingBufferHeight;
    };
    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    let raf = 0;
    const t0 = performance.now();
    let last = t0;
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      (program.uniforms.iTime as { value: number }).value = (t - t0) * 0.001;

      // Exponential ease toward target colors. `1 - exp(-k*dt)` is the
      // frame-rate-independent equivalent of `lerp(curr, target, alpha)`.
      const k = 4;
      const ease = 1 - Math.exp(-k * dt);
      const targets = targetsRef.current;
      const c1 = (program.uniforms.uColor1 as { value: Float32Array }).value;
      const c2 = (program.uniforms.uColor2 as { value: Float32Array }).value;
      const c3 = (program.uniforms.uColor3 as { value: Float32Array }).value;
      for (let i = 0; i < 3; i++) {
        c1[i]! += (targets.c1[i]! - c1[i]!) * ease;
        c2[i]! += (targets.c2[i]! - c2[i]!) * ease;
        c3[i]! += (targets.c3[i]! - c3[i]!) * ease;
      }

      renderer.render({ scene: mesh });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      try {
        container.removeChild(canvas);
      } catch {
        // Canvas may already be detached during fast remounts; ignore.
      }
      programRef.current = null;
    };
  }, []);

  // Update uniforms in place — never recreates the WebGL context.
  useEffect(() => {
    const program = programRef.current;
    if (!program) return;
    const u = program.uniforms as Record<string, { value: number | Float32Array }>;
    u.uTimeSpeed!.value = timeSpeed;
    u.uColorBalance!.value = colorBalance;
    u.uWarpStrength!.value = warpStrength;
    u.uWarpFrequency!.value = warpFrequency;
    u.uWarpSpeed!.value = warpSpeed;
    u.uWarpAmplitude!.value = warpAmplitude;
    u.uBlendAngle!.value = blendAngle;
    u.uBlendSoftness!.value = blendSoftness;
    u.uRotationAmount!.value = rotationAmount;
    u.uNoiseScale!.value = noiseScale;
    u.uGrainAmount!.value = grainAmount;
    u.uGrainScale!.value = grainScale;
    u.uGrainAnimated!.value = grainAnimated ? 1 : 0;
    u.uContrast!.value = contrast;
    u.uGamma!.value = gamma;
    u.uSaturation!.value = saturation;
    u.uZoom!.value = zoom;
    u.uGrainOnly!.value = grainOnly ? 1 : 0;
    (u.uCenterOffset!.value as Float32Array).set([centerX, centerY]);

    // Update the *target* colors; the RAF loop eases the live uniforms
    // toward them. On first pass we also snap the live values so we don't
    // animate from white on mount.
    const targets = targetsRef.current;
    targets.c1 = hexToRgb(color1);
    targets.c2 = hexToRgb(color2);
    targets.c3 = hexToRgb(color3);
    if (!targets.initialized) {
      (u.uColor1!.value as Float32Array).set(targets.c1);
      (u.uColor2!.value as Float32Array).set(targets.c2);
      (u.uColor3!.value as Float32Array).set(targets.c3);
      targets.initialized = true;
    }
  }, [
    timeSpeed,
    colorBalance,
    warpStrength,
    warpFrequency,
    warpSpeed,
    warpAmplitude,
    blendAngle,
    blendSoftness,
    rotationAmount,
    noiseScale,
    grainAmount,
    grainScale,
    grainAnimated,
    contrast,
    gamma,
    saturation,
    centerX,
    centerY,
    zoom,
    grainOnly,
    color1,
    color2,
    color3,
  ]);

  return (
    <div ref={containerRef} className={cn("relative h-full w-full overflow-hidden", className)} />
  );
}
