export type GameLoopOptions = {
  tickRate: number;
  /** A longer frame (a tab coming back, a debugger pause) counts as this long. Defaults to 250. */
  maxDeltaMs?: number;
  onTick: (dt: number) => void;
  onRender: (alpha: number) => void;
};

export type GameLoop = {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  getFPS: () => number;
  /** Frames keep rendering; no ticks run until `resume`. */
  pause: () => void;
  /** Starts timing afresh, so the time spent paused is never caught up. */
  resume: () => void;
  isPaused: () => boolean;
  /** Runs exactly `n` ticks now, paused or not. */
  step: (n?: number) => void;
  /** Scales how much simulated time each frame adds; every tick still gets the fixed `dt`. */
  setTimeScale: (scale: number) => void;
  getTimeScale: () => number;
};

export function createGameLoop(options: GameLoopOptions): GameLoop {
  const { tickRate, onTick, onRender, maxDeltaMs = 250 } = options;
  const tickMs = 1000 / tickRate;

  let running = false;
  let paused = false;
  let timeScale = 1;
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

    if (paused) {
      onRender(accumulator / tickMs);
      return;
    }

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
    accumulator += deltaMs * timeScale;

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

  function pause(): void {
    paused = true;
  }

  function resume(): void {
    if (!paused) return;
    paused = false;
    lastTime = -1;
    accumulator = 0;
  }

  function isPaused(): boolean {
    return paused;
  }

  function step(n = 1): void {
    for (let i = 0; i < n; i++) onTick(tickMs);
  }

  function setTimeScale(scale: number): void {
    if (!Number.isFinite(scale) || scale < 0) {
      throw new RangeError(`time scale must be a finite number >= 0, got ${scale}`);
    }
    timeScale = scale;
  }

  function getTimeScale(): number {
    return timeScale;
  }

  return {
    start,
    stop,
    isRunning,
    getFPS,
    pause,
    resume,
    isPaused,
    step,
    setTimeScale,
    getTimeScale,
  };
}
