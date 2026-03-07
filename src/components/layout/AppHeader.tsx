import {
	Cancel01Icon,
	Clock01Icon,
	ComputerTerminal01Icon,
	Menu01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useInterval } from "ahooks";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { UserMenu } from "@/components/layout/UserMenu";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { authClient } from "@/lib/auth-client";
import { setAuthSession } from "@/lib/auth-store";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import { useMagnetic } from "@/lib/hooks/use-cursor";

const springTransition = {
	type: "spring",
	stiffness: 1000,
	damping: 30,
	mass: 0.1,
} as const;

function MagneticLink({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	const { ref, position } = useMagnetic(0.2);
	return (
		<motion.div
			ref={ref as React.RefObject<HTMLDivElement>}
			data-magnetic
			data-cursor-corner-size="8"
			animate={{ x: position.x, y: position.y }}
			transition={springTransition}
			className={className}
		>
			{children}
		</motion.div>
	);
}

const getUtcTime = () => {
	const now = new Date();
	return `UTC ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
};

export function AppHeader() {
	const [utcTime, setUtcTime] = useState(getUtcTime);
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const [isMac, setIsMac] = useState(false);
	useInterval(() => setUtcTime(getUtcTime()), 1000);
	const { setOpen: openPalette } = useCommandPalette();
	const { data: session } = authClient.useSession();
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	const PAGE_TITLES: Record<string, string> = {
		"/command-center": "COMMANDS",
		"/collab": "COLLAB",
		"/profile": "PROFILE",
	};
	const mobileTitle =
		PAGE_TITLES[pathname] ??
		(pathname.startsWith("/collab/") ? "COLLAB" : null);

	useEffect(() => {
		setAuthSession(session ?? null);
	}, [session]);

	useEffect(() => {
		if (typeof navigator === "undefined") return;
		setIsMac(navigator.platform.toLowerCase().includes("mac"));
	}, []);

	return (
		<>
			<header className="fixed top-0 left-0 right-0 z-50 flex items-start justify-between px-4 sm:px-6 pt-4 sm:pt-5 lg:px-10 pointer-events-none before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-32 before:bg-gradient-to-b before:from-background before:via-background/70 before:to-transparent before:pointer-events-none before:-z-10">
				{/* Logo */}
				<MagneticLink className="shrink-0 pointer-events-auto">
					<Link to="/" className="flex items-center gap-2">
						<motion.div
							className="h-7 w-7"
							style={{
								maskImage: "url(/brackeys-logo.svg)",
								maskSize: "contain",
								maskRepeat: "no-repeat",
								maskPosition: "center",
								WebkitMaskImage: "url(/brackeys-logo.svg)",
								WebkitMaskSize: "contain",
								WebkitMaskRepeat: "no-repeat",
								WebkitMaskPosition: "center",
							}}
							initial={{
								backgroundImage:
									"linear-gradient(to bottom, var(--color-brackeys-yellow), var(--color-brackeys-fuscia), var(--color-brackeys-purple), var(--color-brackeys-fuscia), var(--color-brackeys-yellow))",
								backgroundPosition: "0 0%",
								backgroundSize: "100% 500%",
							}}
							animate={{
								backgroundPosition: [
									"0 0%",
									"0 0%",
									"0 100%",
									"0 100%",
									"0 0%",
								],
							}}
							transition={{
								duration: 6,
								times: [0, 0.2, 0.4, 0.6, 0.8],
								repeat: Infinity,
								ease: "linear",
							}}
						/>
						<span className="hidden sm:inline font-mono font-bold text-foreground text-xl leading-wide">
							Brackeys
							<span className="bg-linear-to-r from-[var(--color-brackeys-yellow)] via-[var(--color-brackeys-fuscia)] to-[var(--color-brackeys-purple)] bg-clip-text text-transparent">
								Community
							</span>
						</span>
					</Link>
				</MagneticLink>

				{/* Desktop nav */}
				<div className="hidden lg:flex items-center gap-6 pointer-events-auto">
					<nav className="flex items-center gap-6 font-mono text-sm font-bold tracking-widest">
						<MagneticLink>
							<Link
								data-cursor-no-drift
								className="px-2 py-1 text-foreground hover:text-primary transition-colors"
								to="/command-center"
							>
								COMMANDS
							</Link>
						</MagneticLink>
						<MagneticLink>
							<Link
								data-cursor-no-drift
								className="px-2 py-1 text-foreground hover:text-primary transition-colors"
								to="/collab"
							>
								COLLAB
							</Link>
						</MagneticLink>
						<MagneticLink>
							<Link
								data-cursor-no-drift
								className="px-2 py-1 text-foreground hover:text-primary transition-colors"
								to="/profile"
							>
								PROFILE
							</Link>
						</MagneticLink>
					</nav>

					<div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
						<HugeiconsIcon icon={Clock01Icon} size={14} />
						<span>{utcTime}</span>
					</div>

					<Button
						variant="outline"
						size="sm"
						isMagnetic
						data-cursor-no-drift
						onClick={() => openPalette(true)}
						className="border-muted hover:border-primary hover:text-primary shadow-[2px_2px_0px_var(--color-primary)] font-mono text-xs gap-2 text-muted-foreground"
					>
						<HugeiconsIcon icon={ComputerTerminal01Icon} size={14} />
						<KbdGroup className="hidden xl:inline-flex opacity-60">
							<Kbd>{isMac ? "CMD" : "CTRL"}</Kbd>
							<Kbd>K</Kbd>
						</KbdGroup>
					</Button>

					{session?.user ? (
						<UserMenu user={session.user} />
					) : (
						<Button
							variant="default"
							isMagnetic
							className="font-mono text-xs font-bold tracking-widest px-5"
							data-cursor-no-drift
							onClick={() => authClient.signIn.social({ provider: "discord" })}
						>
							LOGIN
						</Button>
					)}
				</div>

				{/* Mobile page title + menu button */}
				<div className="flex lg:hidden items-center gap-3 pointer-events-auto">
					{mobileTitle && (
						<span className="font-mono text-xs font-bold tracking-widest text-foreground/70 uppercase">
							{mobileTitle}
						</span>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={() => openPalette(true)}
						className="border-muted hover:border-primary hover:text-primary font-mono text-xs text-muted-foreground h-9 w-9 p-0"
					>
						<HugeiconsIcon icon={ComputerTerminal01Icon} size={16} />
					</Button>
					<button
						type="button"
						onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
						className="h-9 w-9 flex items-center justify-center border border-muted bg-card/40 text-foreground hover:border-primary hover:text-primary transition-colors"
					>
						<HugeiconsIcon
							icon={mobileMenuOpen ? Cancel01Icon : Menu01Icon}
							size={18}
						/>
					</button>
				</div>
			</header>

			{/* Mobile menu overlay */}
			<AnimatePresence>
				{mobileMenuOpen && (
					<motion.div
						initial={{ opacity: 0, y: -10 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.15 }}
						className="fixed inset-x-0 top-[57px] z-40 bg-background/95 backdrop-blur-md border-b border-muted/30 pointer-events-auto"
					>
						<nav className="flex flex-col p-4 gap-1">
							<Link
								to="/command-center"
								onClick={() => setMobileMenuOpen(false)}
								className="px-4 py-3 font-mono text-sm font-bold tracking-widest text-foreground hover:text-primary hover:bg-primary/5 transition-colors"
							>
								COMMANDS
							</Link>
							<Link
								to="/collab"
								onClick={() => setMobileMenuOpen(false)}
								className="px-4 py-3 font-mono text-sm font-bold tracking-widest text-foreground hover:text-primary hover:bg-primary/5 transition-colors"
							>
								COLLAB
							</Link>
							<Link
								to="/profile"
								onClick={() => setMobileMenuOpen(false)}
								className="px-4 py-3 font-mono text-sm font-bold tracking-widest text-foreground hover:text-primary hover:bg-primary/5 transition-colors"
							>
								PROFILE
							</Link>
							<div className="border-t border-muted/20 mt-2 pt-3 px-4 flex items-center justify-between">
								<div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
									<HugeiconsIcon icon={Clock01Icon} size={14} />
									<span>{utcTime}</span>
								</div>
								{session?.user ? (
									<UserMenu user={session.user} />
								) : (
									<Button
										variant="default"
										size="sm"
										className="font-mono text-xs font-bold tracking-widest"
										onClick={() => {
											authClient.signIn.social({ provider: "discord" });
											setMobileMenuOpen(false);
										}}
									>
										LOGIN
									</Button>
								)}
							</div>
						</nav>
					</motion.div>
				)}
			</AnimatePresence>
		</>
	);
}
