import { useStore } from "@tanstack/react-store"
import type { Store } from "@tanstack/store"
import { useEffect, useRef, useState } from "react"
import type { GameInstance, GameStoreState } from "@/game"
import { createGame, selectDebugMode, selectFPS, selectPhase } from "@/game"

type GameCanvasProps = {
	roomId: string
}

export function GameCanvas({ roomId }: GameCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const gameRef = useRef<GameInstance | null>(null)
	const [store, setStore] = useState<Store<GameStoreState> | null>(null)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return

		let instance: GameInstance | null = null
		let mounted = true

		async function init() {
			if (!canvas || !mounted) return

			// Display resolution = window size (Native mode).
			// A future settings UI can override with a fixed resolution.
			instance = await createGame(canvas, {
				displayWidth: window.innerWidth,
				displayHeight: window.innerHeight,
			})

			if (!mounted) {
				instance.destroy()
				return
			}

			gameRef.current = instance
			setStore(instance.getStore())
			instance.start()
		}

		init()

		function handleResize() {
			if (!instance) return
			instance.resize(window.innerWidth, window.innerHeight)
		}

		window.addEventListener("resize", handleResize)

		return () => {
			mounted = false
			window.removeEventListener("resize", handleResize)
			if (instance) {
				instance.destroy()
				instance = null
			}
			gameRef.current = null
			setStore(null)
		}
	}, [])

	return (
		<div className="fixed inset-0 z-[100] bg-[#1a1a2e]">
			<canvas
				ref={canvasRef}
				className="block w-full h-full"
				style={{ touchAction: "none" }}
			/>
			{store && <GameHUD store={store} roomId={roomId} />}
		</div>
	)
}

// ─── HUD overlay ─────────────────────────────────────────

function GameHUD({
	store,
	roomId,
}: { store: Store<GameStoreState>; roomId: string }) {
	const phase = useStore(store, selectPhase)
	const fps = useStore(store, selectFPS)
	const debugMode = useStore(store, selectDebugMode)

	return (
		<div className="fixed top-4 left-4 z-50 pointer-events-none font-mono text-xs space-y-1">
			<div className="text-brackeys-yellow/80 tracking-widest uppercase">
				Room: {roomId}
			</div>
			<div className="text-muted-foreground/60">
				{phase === "running" ? `${Math.round(fps)} FPS` : phase}
			</div>
			{import.meta.env.DEV && debugMode !== "off" && (
				<div className="text-cyan-400/70 uppercase tracking-wider">
					Debug: {debugMode}
				</div>
			)}
			<div className="text-muted-foreground/40 text-[10px] mt-2">
				WASD / Arrow keys to move · Space to jump
				{import.meta.env.DEV && " · F3 debug overlay"}
			</div>
		</div>
	)
}
