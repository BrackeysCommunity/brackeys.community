export type GameLoopOptions = {
  tickRate: number;
  /** A longer frame (a tab coming back, a debugger pause) counts as this long. Defaults to 250. */
  maxDeltaMs?: number;
  onTick: (dt: number) => void;
  onRender: (alpha: number) => void;
  /**
   * True: run ticks now. While it is false the loop is idle: no ticks run, the
   * accumulator is held at 0 and frames render at alpha 1. The first frame it
   * opens on runs one tick at once; while it stays open, ticks follow scaled
   * wall time. Without it every frame may tick.
   */
  gate?: () => boolean;
  /** Once per `dt` of scaled wall time while the gate holds the loop idle; nothing simulates. */
  onIdle?: (dt: number) => void;
  /** Wall time a long frame lost to `maxDeltaMs`, on frames that would have ticked. */
  onDropped?: (ms: number) => void;
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
  /** Runs exactly `n` ticks now, paused or not, whatever the gate says. */
  step: (n?: number) => void;
  /** Scales how much simulated time each frame adds; every tick still gets the fixed `dt`. */
  setTimeScale: (scale: number) => void;
  getTimeScale: () => number;
  /** Every later tick's `dt` is `1000 / rate`; the accumulator restarts. */
  setTickRate: (rate: number) => void;
};

export function createGameLoop(options: GameLoopOptions): GameLoop {
  const { onTick, onRender, gate, onIdle, onDropped, maxDeltaMs = 250 } = options;
  let tickMs = 1000 / options.tickRate;

  let running = false;
  let paused = false;
  let timeScale = 1;
  let rafHandle = 0;
  let accumulator = 0;
  let lastTime = -1;
  /** The gate held the last frame (or nothing has ticked since start): its opening runs a tick at once. */
  let held = true;
  let idleAccumulator = 0;

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
    const dropped = deltaMs > maxDeltaMs ? deltaMs - maxDeltaMs : 0;
    if (dropped > 0) deltaMs = maxDeltaMs;

    // FPS calculation
    frameCount++;
    fpsAccumulator += deltaMs;
    if (fpsAccumulator >= 1000) {
      currentFPS = (frameCount / fpsAccumulator) * 1000;
      frameCount = 0;
      fpsAccumulator = 0;
    }

    if (gate) {
      gatedFrame(deltaMs * timeScale, dropped);
      return;
    }

    if (dropped > 0) onDropped?.(dropped);

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

  function idle(scaledMs: number): void {
    held = true;
    accumulator = 0;
    if (onIdle) {
      idleAccumulator += scaledMs;
      while (idleAccumulator >= tickMs) {
        onIdle(tickMs);
        idleAccumulator -= tickMs;
      }
    }
    onRender(1);
  }

  function gatedFrame(scaledMs: number, dropped: number): void {
    if (!gate!()) return idle(scaledMs);
    if (held) {
      // The time spent idle is never simulated: the woken tick starts the clock afresh.
      held = false;
      accumulator = 0;
      idleAccumulator = 0;
      if (timeScale > 0) onTick(tickMs);
    } else {
      if (dropped > 0) onDropped?.(dropped);
      accumulator += scaledMs;
      while (accumulator >= tickMs && gate!()) {
        onTick(tickMs);
        accumulator -= tickMs;
      }
    }
    if (!gate!()) return idle(0);
    onRender(accumulator / tickMs);
  }

  function start(): void {
    if (running) return;
    running = true;
    lastTime = -1;
    accumulator = 0;
    held = true;
    idleAccumulator = 0;
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

  function setTickRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new RangeError(`tick rate must be a finite number > 0, got ${rate}`);
    }
    tickMs = 1000 / rate;
    accumulator = 0;
    idleAccumulator = 0;
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
    setTickRate,
  };
}
