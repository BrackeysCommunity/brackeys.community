export type GameLoopOptions = {
  tickRate: number;
  onTick: (dt: number) => void;
  onRender: (alpha: number) => void;
};

export type GameLoop = {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  getFPS: () => number;
};

export function createGameLoop(options: GameLoopOptions): GameLoop {
  const { tickRate, onTick, onRender } = options;
  const tickMs = 1000 / tickRate;
  const maxDeltaMs = 250; // prevent spiral of death

  let running = false;
  let rafHandle = 0;
  let accumulator = 0;
  let lastTime = -1;

  // FPS tracking — rolling average
  let frameCount = 0;
  let fpsAccumulator = 0;
  let currentFPS = 0;

  function frame(now: number): void {
    if (!running) return;

    rafHandle = requestAnimationFrame(frame);

    if (lastTime < 0) {
      lastTime = now;
      return;
    }

    let deltaMs = now - lastTime;
    lastTime = now;

    // Clamp to prevent spiral of death after tab-away or debugger pause
    if (deltaMs > maxDeltaMs) {
      deltaMs = maxDeltaMs;
    }

    // FPS calculation
    frameCount++;
    fpsAccumulator += deltaMs;
    if (fpsAccumulator >= 1000) {
      currentFPS = (frameCount / fpsAccumulator) * 1000;
      frameCount = 0;
      fpsAccumulator = 0;
    }

    // Fixed timestep accumulator
    accumulator += deltaMs;

    while (accumulator >= tickMs) {
      onTick(tickMs);
      accumulator -= tickMs;
    }

    // Interpolation alpha for smooth rendering between ticks
    const alpha = accumulator / tickMs;
    onRender(alpha);
  }

  function start(): void {
    if (running) return;
    running = true;
    lastTime = -1;
    accumulator = 0;
    frameCount = 0;
    fpsAccumulator = 0;
    currentFPS = 0;
    rafHandle = requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    if (rafHandle) {
      cancelAnimationFrame(rafHandle);
      rafHandle = 0;
    }
  }

  function isRunning(): boolean {
    return running;
  }

  function getFPS(): number {
    return currentFPS;
  }

  return { start, stop, isRunning, getFPS };
}
