import { useState } from "react";
import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-store";
import { Button } from "@/components/ui/button";
import { activeUserStore } from "@/lib/active-user-store";
import type { BotCommand } from "@/data/commands";

interface CommandRowProps {
	command: BotCommand;
}

const botBadgeStyles: Record<string, string> = {
	hammer: "text-cyan-400 border-cyan-400/40 bg-cyan-950/20",
	pencil: "text-violet-400 border-violet-400/40 bg-violet-950/20",
};

/** Build the Discord slash-command string: `/cmd opt1: opt2:` */
export function buildCopyText(command: BotCommand, username?: string): string {
	if (!command.options?.length) return command.cmd;
	const opts = command.options
		.filter((o) => username || !["mention", "user"].includes(o.name))
		.map((o) =>
			["mention", "user"].includes(o.name) && username
				? `${o.name}:@${username}`
				: `${o.name}:${o.default}`,
		)
		.join(" ");
	return opts ? `${command.cmd} ${opts}` : command.cmd;
}

export function CommandRow({ command }: CommandRowProps) {
	const user = useStore(activeUserStore);
	const username = user.profile?.discordUsername ?? undefined;
	console.log(buildCopyText(command, username ?? undefined));
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(buildCopyText(command, username ?? undefined));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="group flex flex-col md:flex-row md:items-start justify-between p-6 hover:bg-card/50 transition-colors gap-4">
			<div className="flex-1 space-y-2">
				<div className="flex items-center gap-3 flex-wrap">
					<code className="text-brackeys-yellow font-mono text-lg font-bold bg-brackeys-yellow-muted/20 px-2 py-0.5 border border-brackeys-yellow/30">
						{command.cmd}
					</code>
					<span
						className={`text-xs font-mono border px-1.5 py-0.5 uppercase ${botBadgeStyles[command.bot]}`}
					>
						{command.bot}
					</span>
				</div>

				<p className="text-[#cccccc] text-sm md:text-base leading-relaxed font-sans max-w-2xl">
					{command.description}
				</p>

				{command.options && command.options.length > 0 && (
					<div className="space-y-1">
						{command.options
							.filter((opt) => username || opt.name !== "mention")
							.map((opt) => (
								<div
									key={opt.name}
									className="text-xs font-mono text-muted-foreground flex items-center gap-2"
								>
									<span className="text-primary">{opt.name}:</span>
									<span>{opt.description}</span>
									{opt.required && (
										<span className="text-destructive/70 text-[10px] uppercase tracking-wider">
											required
										</span>
									)}
								</div>
							))}
					</div>
				)}

				<div className="text-xs font-mono text-muted-foreground">
					<span className="text-primary">EXAMPLE:</span>{" "}
					<span className="text-brackeys-yellow/80">{buildCopyText(command, username)}</span>
				</div>
			</div>

			<Button
				variant="outline"
				isMagnetic
				onClick={handleCopy}
				className="flex items-center gap-2 px-3 py-2 bg-black border border-muted hover:border-primary text-muted-foreground hover:text-white transition-all group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:shadow-[2px_2px_0px_var(--color-primary)] active:translate-x-0 active:translate-y-0 active:shadow-none self-start md:self-center shrink-0 relative z-10"
			>
				<HugeiconsIcon icon={Copy01Icon} size={16} />
				<span className="font-mono text-xs font-bold uppercase">{copied ? "Copied!" : "Copy"}</span>
			</Button>
		</div>
	);
}
