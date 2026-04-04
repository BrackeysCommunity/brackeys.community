import type { GameConfig, GameEventMap, GameInstance, GameStoreState } from "./types";
import { DEFAULT_GAME_CONFIG } from "./types";
import { GameEventEmitter } from "./events";
import {
  createGameStore,
  incrementTick,
  resetGameStore,
  setFPS,
  setPhase,
  updateCamera,
  updatePlayer,
} from "./store";
import { createRenderer } from "./renderer";
import { createGameLoop } from "./loop";
import { createInputSystem } from "./input";
import { createCamera } from "./camera";
import { createPlayerEntity } from "./entities/player";
import { createCloudPlatformSystem } from "./entities/cloud-platform";
import { createMovingPlatformSystem } from "./entities/moving-platform";
import { createGrappleAnchorSystem } from "./entities/grapple-anchor";
import { createShaperSystem } from "./systems/shaper";
import { type ConstructType, CONSTRUCT_CONFIGS } from "./entities/shaper-constructs";
import { initAssets } from "./assets";
import { initRapier, createPhysicsWorld } from "./physics";
import { createDebugOverlay, type DebugOverlay } from "./debug";
import type { Store } from "@tanstack/store";

export async function createGame(
  canvas: HTMLCanvasElement,
  config?: Partial<GameConfig>,
): Promise<GameInstance> {
  const cfg: GameConfig = { ...DEFAULT_GAME_CONFIG, ...config };

  // ─── Initialize subsystems ────────────────────────────────

  const store = createGameStore();
  const events = new GameEventEmitter();

  setPhase(store, "loading");

  // Renderer (must be created first — Application.init() initializes Assets internally)
  const renderer = await createRenderer(canvas, cfg);

  // Register asset bundles (after renderer so Assets is already initialized)
  await initAssets();

  // Camera (display dimensions drive the expand-viewport scaling)
  const camera = createCamera(
    renderer.worldContainer,
    cfg.displayWidth,
    cfg.displayHeight,
    cfg.camera,
  );

  // Physics (Rapier WASM)
  await initRapier();
  const physics = createPhysicsWorld();

  // Input
  const input = createInputSystem(cfg.bindings);

  // Moving platform system (must be created before player so player can reference it)
  const movingPlatforms = createMovingPlatformSystem(physics, renderer.worldContainer);

  // ─── Test scene: moving platforms ─────────────────
  // Horizontal platform over the pit
  movingPlatforms.add({
    waypoints: [
      { x: 1500, y: 950 },
      { x: 1700, y: 950 },
    ],
    speed: 80,
    pauseMs: 500,
    width: 100,
    height: 12,
    mode: "ping_pong",
  });
  // Vertical elevator near the wall-jump corridor
  movingPlatforms.add({
    waypoints: [
      { x: 1300, y: 1000 },
      { x: 1300, y: 700 },
    ],
    speed: 100,
    pauseMs: 800,
    width: 80,
    height: 12,
    mode: "ping_pong",
  });
  // Diagonal path platform
  movingPlatforms.add({
    waypoints: [
      { x: 200, y: 800 },
      { x: 400, y: 700 },
      { x: 600, y: 750 },
    ],
    speed: 120,
    pauseMs: 300,
    width: 70,
    height: 12,
    mode: "loop",
  });

  // Grapple anchor system (Shaper places these, Runners swing from them)
  const grappleAnchors = createGrappleAnchorSystem(renderer.worldContainer);
  // Test anchors
  grappleAnchors.add({ x: 600, y: 600 });
  grappleAnchors.add({ x: 900, y: 500 });
  grappleAnchors.add({ x: 1100, y: 550 });
  grappleAnchors.add({ x: 400, y: 500 });

  // Player entity (character controller handles platform riding via collision resolution)
  const player = createPlayerEntity(renderer.worldContainer, physics, grappleAnchors);

  // Cloud platform system — handles one-way pass-through independently
  const cloudPlatforms = createCloudPlatformSystem(physics, renderer.worldContainer);

  // Shaper system — object placement (Tab toggles mode, number keys select, click places)
  const shaperSystem = createShaperSystem(renderer.worldContainer, physics, grappleAnchors);

  // ─── Shaper input handling ────────────────────────
  let shaperMode = false;
  function setupShaperInput(): void {
    window.addEventListener("keydown", onShaperKeyDown);
    window.addEventListener("mousedown", onShaperMouseDown);
    window.addEventListener("wheel", onShaperWheel, { passive: true });
  }

  function onShaperKeyDown(e: KeyboardEvent): void {
    if (e.key === "Tab") {
      e.preventDefault();
      shaperMode = !shaperMode;
      shaperSystem.setActive(shaperMode);
      if (!shaperMode) shaperSystem.clearSelection();
      return;
    }

    if (!shaperMode) return;

    // Number keys select construct type
    const hotkeyNum = parseInt(e.key);
    if (hotkeyNum >= 1 && hotkeyNum <= 6) {
      const entry = Object.entries(CONSTRUCT_CONFIGS).find(([, cfg]) => cfg.hotkey === hotkeyNum);
      if (entry) {
        shaperSystem.selectType(entry[0] as ConstructType);
      }
    }

    if (e.key === "Escape") {
      shaperSystem.clearSelection();
    }
  }

  function onShaperMouseDown(e: MouseEvent): void {
    if (!shaperMode || !shaperSystem.getSelectedType()) return;
    if (e.button === 0) {
      // Left click = place
      const result = shaperSystem.place();
      if (!result.valid && import.meta.env.DEV) {
        console.log(`[shaper] placement rejected: ${result.reason}`);
      }
    } else if (e.button === 2) {
      // Right click = cancel selection
      shaperSystem.clearSelection();
    }
  }

  function onShaperWheel(e: WheelEvent): void {
    if (!shaperMode) return;
    shaperSystem.rotatePreview(e.deltaY > 0 ? 1 : -1);
  }

  // Initialize player in store
  updatePlayer(store, "local", {
    id: "local",
    position: player.getPosition(),
    velocity: { x: 0, y: 0 },
  });

  // Debug overlay (dev-only, tree-shaken in production)
  let debugOverlay: DebugOverlay | null = null;
  if (import.meta.env.DEV) {
    debugOverlay = createDebugOverlay({
      worldContainer: renderer.worldContainer,
      uiContainer: renderer.uiContainer,
      camera,
      store,
      physics,
      inputTarget: window,
    });
  }

  // ─── Game loop ────────────────────────────────────────────

  const loop = createGameLoop({
    tickRate: cfg.targetFPS,

    onTick(dt: number) {
      const tick = store.state.tick;

      // 1. Poll input
      const actions = input.poll(tick);

      // 2a. Update moving platforms (before player, so rider delta is ready)
      movingPlatforms.update(dt);

      // 2b. Update shaper preview (cursor tracking in world space)
      if (shaperMode) {
        const mousePos = input.getMousePosition();
        const scale = camera.getDisplayScale();
        const vp = camera.getViewport();
        shaperSystem.updatePreview({
          x: vp.x + mousePos.x / scale,
          y: vp.y + mousePos.y / scale,
        });
      }

      // 2c. Update cloud platforms (sets collision groups before player's
      //    character controller runs, so each cloud is independently
      //    solid or pass-through based on the player's position)
      cloudPlatforms.update(player.getPosition(), player.getHalfHeight(), player.isHoldingDown());

      // 2c. Compute ground platform delta hint for player stick velocity.
      //     If the player is standing on a moving platform, pass its Y delta
      //     so the player can adjust ground stick velocity to track it.
      let groundDeltaY = 0;
      if (player.isGrounded()) {
        const groundHandle = player.getGroundColliderHandle();
        if (groundHandle !== null) {
          const pd = movingPlatforms.getFrameDeltaForCollider(groundHandle);
          if (pd) groundDeltaY = pd.y;
        }
      }

      // 3. Update player
      player.update(dt, actions, groundDeltaY);

      // 3. Step physics world + drain collision events
      physics.step();
      const collisionEvents = physics.drainEvents();

      // Log collision events for testing (will be wired into game state later)
      for (const evt of collisionEvents) {
        if (import.meta.env.DEV) {
          console.log(`[collision] ${evt.type}`, evt);
        }
      }

      // 4. Update camera to follow player
      camera.update(dt, player.getPosition());

      // 5. Sync state to store
      incrementTick(store);
      updatePlayer(store, "local", {
        position: player.getPosition(),
        velocity: player.getVelocity(),
      });
      updateCamera(store, {
        position: camera.getPosition(),
      });

      // 6. Update debug overlay
      if (debugOverlay) {
        const mousePos = input.getMousePosition();
        // Convert screen mouse to world coordinates (screen px → game units)
        const scale = camera.getDisplayScale();
        const vp = camera.getViewport();
        const mouseWorld = {
          x: vp.x + mousePos.x / scale,
          y: vp.y + mousePos.y / scale,
        };
        debugOverlay.update(
          dt,
          {
            position: player.getPosition(),
            velocity: player.getVelocity(),
            grounded: player.isGrounded(),
            holdingJump: player.isHoldingJump(),
            holdingMove: player.isHoldingMove(),
            wallSliding: player.isWallSliding(),
            wallDirection: player.getWallDirection(),
            preUpdate: player.getPreUpdateState(),
          },
          mouseWorld,
        );
      }

      // 7. Emit tick event
      events.emit("game:tick", { tick: store.state.tick });
    },

    onRender(_alpha: number) {
      // Future: interpolate visual positions between physics ticks
      // For now, PixiJS renders automatically via its ticker (driven by rAF)

      // Update FPS in store periodically
      setFPS(store, loop.getFPS());
    },
  });

  // ─── Public API ───────────────────────────────────────────

  let destroyed = false;

  function start(): void {
    if (destroyed) return;
    setPhase(store, "running");
    input.attach(window);
    setupShaperInput();
    loop.start();
    events.emit("game:start");
  }

  function resize(width: number, height: number): void {
    if (destroyed) return;
    renderer.resize(width, height);
    camera.resize(width, height);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;

    loop.stop();
    window.removeEventListener("keydown", onShaperKeyDown);
    window.removeEventListener("mousedown", onShaperMouseDown);
    window.removeEventListener("wheel", onShaperWheel);
    debugOverlay?.destroy();
    shaperSystem.destroy();
    input.destroy();
    camera.destroy();
    grappleAnchors.destroy();
    cloudPlatforms.destroy();
    movingPlatforms.destroy();
    player.destroy();
    physics.destroy();
    renderer.destroy();

    events.emit("game:destroy");
    events.destroy();

    resetGameStore(store);
    setPhase(store, "destroyed");
  }

  function on<K extends keyof GameEventMap>(
    event: K,
    handler: (payload: GameEventMap[K]) => void,
  ): void {
    events.on(event, handler);
  }

  function off<K extends keyof GameEventMap>(
    event: K,
    handler: (payload: GameEventMap[K]) => void,
  ): void {
    events.off(event, handler);
  }

  function getStore(): Store<GameStoreState> {
    return store;
  }

  setPhase(store, "idle");

  return { start, destroy, resize, on, off, getStore };
}
