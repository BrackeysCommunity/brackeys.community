import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, wrapEffect } from "@react-three/postprocessing";
import { Effect } from "postprocessing";
import { forwardRef, useEffect, useRef, useState } from "react";
import * as THREE from "three";

import DITHER_FRAGMENT from "@/shaders/dither.frag.glsl?raw";
import WAVE_FRAGMENT from "@/shaders/dither.wave.frag.glsl?raw";
import WAVE_VERTEX from "@/shaders/dither.wave.vert.glsl?raw";

import "./Dither.css";

class RetroEffectImpl extends Effect {
  constructor() {
    const uniforms = new Map([
      ["colorNum", new THREE.Uniform(4.0)],
      ["pixelSize", new THREE.Uniform(2.0)],
    ]);
    super("RetroEffect", DITHER_FRAGMENT, { uniforms });
    // @ts-ignore
    this.uniforms = uniforms;
  }
  set colorNum(v) {
    this.uniforms.get("colorNum")!.value = v;
  }
  get colorNum() {
    return this.uniforms.get("colorNum")!.value;
  }
  set pixelSize(v) {
    this.uniforms.get("pixelSize")!.value = v;
  }
  get pixelSize() {
    return this.uniforms.get("pixelSize")!.value;
  }
}

const WrappedRetro = wrapEffect(RetroEffectImpl);

const RetroEffect = forwardRef((props: { colorNum?: number; pixelSize?: number }, ref) => {
  const { colorNum, pixelSize } = props;
  return <WrappedRetro ref={ref} colorNum={colorNum} pixelSize={pixelSize} />;
});
RetroEffect.displayName = "RetroEffect";

function createWaveUniforms(
  waveSpeed: number,
  waveFrequency: number,
  waveAmplitude: number,
  waveColor: [number, number, number],
  enableMouseInteraction: boolean | undefined,
  mouseRadius: number | undefined,
) {
  return {
    time: new THREE.Uniform(0),
    resolution: new THREE.Uniform(new THREE.Vector2(0, 0)),
    waveSpeed: new THREE.Uniform(waveSpeed),
    waveFrequency: new THREE.Uniform(waveFrequency),
    waveAmplitude: new THREE.Uniform(waveAmplitude),
    waveColor: new THREE.Uniform(new THREE.Color(...waveColor)),
    mousePos: new THREE.Uniform(new THREE.Vector2(0, 0)),
    enableMouseInteraction: new THREE.Uniform(enableMouseInteraction ? 1 : 0),
    mouseRadius: new THREE.Uniform(mouseRadius),
  };
}

interface DitheredWavesProps {
  waveSpeed: number;
  waveFrequency: number;
  waveAmplitude: number;
  waveColor: [r: number, g: number, b: number];
  colorNum?: number;
  pixelSize?: number;
  disableAnimation?: boolean;
  enableMouseInteraction?: boolean;
  mouseRadius?: number;
}

function DitheredWaves({
  waveSpeed,
  waveFrequency,
  waveAmplitude,
  waveColor,
  colorNum,
  pixelSize,
  disableAnimation,
  enableMouseInteraction,
  mouseRadius,
}: DitheredWavesProps) {
  const mesh = useRef(null);
  const mouseRef = useRef(new THREE.Vector2());
  const { viewport, size, gl } = useThree();

  const uniformsRef = useRef(
    createWaveUniforms(
      waveSpeed,
      waveFrequency,
      waveAmplitude,
      waveColor,
      enableMouseInteraction,
      mouseRadius,
    ),
  );
  const shaderRef = useRef<THREE.ShaderMaterial>(null);

  useEffect(() => {
    if (shaderRef.current) {
      shaderRef.current.uniforms = uniformsRef.current;
      shaderRef.current.needsUpdate = true;
    }
  }, []);

  useEffect(() => {
    const dpr = gl.getPixelRatio();
    const w = Math.floor(size.width * dpr),
      h = Math.floor(size.height * dpr);
    const res = uniformsRef.current.resolution.value;
    if (res.x !== w || res.y !== h) {
      res.set(w, h);
    }
  }, [size, gl]);

  const prevColor = useRef([...waveColor]);
  useFrame(({ clock }) => {
    const u = uniformsRef.current;
    if (!disableAnimation) {
      u.time.value = clock.getElapsedTime();
    }

    if (u.waveSpeed.value !== waveSpeed) u.waveSpeed.value = waveSpeed;
    if (u.waveFrequency.value !== waveFrequency) u.waveFrequency.value = waveFrequency;
    if (u.waveAmplitude.value !== waveAmplitude) u.waveAmplitude.value = waveAmplitude;

    if (!prevColor.current.every((v, i) => v === waveColor[i])) {
      u.waveColor.value.set(...waveColor);
      prevColor.current = [...waveColor];
    }

    u.enableMouseInteraction.value = enableMouseInteraction ? 1 : 0;
    u.mouseRadius.value = mouseRadius;

    if (enableMouseInteraction) {
      u.mousePos.value.copy(mouseRef.current);
    }
  });

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!enableMouseInteraction) return;
    const rect = gl.domElement.getBoundingClientRect();
    const dpr = gl.getPixelRatio();
    mouseRef.current.set((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
  };

  return (
    <>
      <mesh ref={mesh} scale={[viewport.width, viewport.height, 1]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial ref={shaderRef} vertexShader={WAVE_VERTEX} fragmentShader={WAVE_FRAGMENT} />
      </mesh>

      <EffectComposer>
        <RetroEffect colorNum={colorNum} pixelSize={pixelSize} />
      </EffectComposer>

      <mesh
        onPointerMove={handlePointerMove}
        position={[0, 0, 0.01]}
        scale={[viewport.width, viewport.height, 1]}
        visible={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </>
  );
}

const MAX_DITHER_RES = 1920;

function useCappedDpr() {
  const [dpr, setDpr] = useState(() => {
    if (typeof window === "undefined") return 1;
    const maxDim = Math.max(window.innerWidth, window.innerHeight);
    return maxDim > MAX_DITHER_RES ? MAX_DITHER_RES / maxDim : 1;
  });

  useEffect(() => {
    const update = () => {
      const maxDim = Math.max(window.innerWidth, window.innerHeight);
      setDpr(maxDim > MAX_DITHER_RES ? MAX_DITHER_RES / maxDim : 1);
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return dpr;
}

interface DitherProps {
  waveSpeed?: number;
  waveFrequency?: number;
  waveAmplitude?: number;
  waveColor?: [r: number, g: number, b: number];
  colorNum?: number;
  pixelSize?: number;
  disableAnimation?: boolean;
  enableMouseInteraction?: boolean;
  mouseRadius?: number;
}

export default function Dither({
  waveSpeed = 0.05,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  waveColor = [0.5, 0.5, 0.5],
  colorNum = 4,
  pixelSize = 2,
  disableAnimation = false,
  enableMouseInteraction = true,
  mouseRadius = 1,
}: DitherProps) {
  const dpr = useCappedDpr();

  return (
    <div className="dither-container">
      <Canvas
        camera={{ position: [0, 0, 6] }}
        dpr={dpr}
        gl={{ antialias: false }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        <DitheredWaves
          waveSpeed={waveSpeed}
          waveFrequency={waveFrequency}
          waveAmplitude={waveAmplitude}
          waveColor={waveColor}
          colorNum={colorNum}
          pixelSize={pixelSize}
          disableAnimation={disableAnimation}
          enableMouseInteraction={enableMouseInteraction}
          mouseRadius={mouseRadius}
        />
      </Canvas>
    </div>
  );
}
