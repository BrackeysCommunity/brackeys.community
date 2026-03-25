import { useEffect, useRef, useState } from "react"
import { useStore } from "@tanstack/react-store"
import type { Store } from "@tanstack/store"
import type { GameInstance, GameStoreState } from "@/game"
import { createGame, selectFPS, selectPhase } from "@/game"

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

			instance = await createGame(canvas, {
				width: window.innerWidth,
				height: window.innerHeight,
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

		// Handle window resize
		function handleResize() {
			if (!canvas) return
			canvas.width = window.innerWidth
			canvas.height = window.innerHeight
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
	}, [roomId])

	return (
		<div className="fixed inset-0 z-40">
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

	return (
		<div className="fixed top-4 left-4 z-50 pointer-events-none font-mono text-xs space-y-1">
			<div className="text-brackeys-yellow/80 tracking-widest uppercase">
				Room: {roomId}
			</div>
			<div className="text-muted-foreground/60">
				{phase === "running" ? `${Math.round(fps)} FPS` : phase}
			</div>
			<div className="text-muted-foreground/40 text-[10px] mt-2">
				WASD / Arrow keys to move · Space to jump
			</div>
		</div>
	)
}
