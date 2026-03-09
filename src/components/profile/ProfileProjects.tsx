import { Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { startTransition, useState } from "react";
import {
	PROFILE_PROJECT_TYPE_LABELS,
	PROFILE_PROJECT_TYPES,
	type ProfileProjectType,
} from "@/lib/profile-projects";
import { cn } from "@/lib/utils";
import { ProfileProjectTypeBadge } from "./ProfileProjectTypeBadge";

interface Project {
	id: string;
	type: ProfileProjectType;
	subTypes: string[];
	title: string;
	description: string | null;
	url: string | null;
	imageUrl: string | null;
	tags: string[] | null;
	pinned: boolean | null;
	status: string;
	jamName: string | null;
	jamUrl: string | null;
	submissionTitle: string | null;
	submissionUrl: string | null;
	result: string | null;
	participatedAt: Date | null;
}

interface ProfileProjectsProps {
	projects: Project[];
	className?: string;
	showFilters?: boolean;
}

type ProjectFilter = "all" | ProfileProjectType;

export function ProfileProjects({
	projects,
	className,
	showFilters = true,
}: ProfileProjectsProps) {
	const [activeFilter, setActiveFilter] = useState<ProjectFilter>("all");

	if (projects.length === 0) return null;

	const availableTypes = PROFILE_PROJECT_TYPES.filter((type) =>
		projects.some((project) => project.type === type),
	);

	const sortedProjects = [...projects].sort((a, b) => {
		if (a.pinned && !b.pinned) return -1;
		if (!a.pinned && b.pinned) return 1;

		if (a.type === "jam" && b.type === "jam") {
			return (
				(b.participatedAt?.getTime() ?? 0) - (a.participatedAt?.getTime() ?? 0)
			);
		}

		return a.title.localeCompare(b.title);
	});

	const filteredProjects = sortedProjects.filter((project) =>
		activeFilter === "all" ? true : project.type === activeFilter,
	);

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			{showFilters && availableTypes.length > 1 && (
				<div className="flex flex-wrap gap-1.5">
					<FilterChip
						active={activeFilter === "all"}
						onClick={() => startTransition(() => setActiveFilter("all"))}
					>
						All
					</FilterChip>
					{availableTypes.map((type) => (
						<FilterChip
							key={type}
							active={activeFilter === type}
							onClick={() => startTransition(() => setActiveFilter(type))}
						>
							{PROFILE_PROJECT_TYPE_LABELS[type]}
						</FilterChip>
					))}
				</div>
			)}

			{filteredProjects.length === 0 ? (
				<div className="border border-dashed border-muted/25 px-3 py-4 text-center">
					<p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
						No{" "}
						{activeFilter === "all"
							? "projects"
							: PROFILE_PROJECT_TYPE_LABELS[activeFilter].toLowerCase()}{" "}
						entries yet
					</p>
				</div>
			) : (
				filteredProjects.map((project) =>
					project.type === "jam" ? (
						<JamTimelineCard key={project.id} project={project} />
					) : (
						<ProjectCard key={project.id} project={project} />
					),
				)
			)}
		</div>
	);
}

function FilterChip({
	active,
	children,
	onClick,
}: {
	active: boolean;
	children: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] transition-colors",
				active
					? "border-primary/35 bg-primary/10 text-primary"
					: "border-muted/25 text-muted-foreground/45 hover:border-muted/45 hover:text-foreground/70",
			)}
		>
			{children}
		</button>
	);
}

function ProjectCard({ project }: { project: Project }) {
	return (
		<div className="group flex gap-3 border border-muted/60 bg-card/30 p-3 transition-all duration-200 hover:border-muted hover:bg-card/60 hover:-translate-y-0.5 hover:shadow-[2px_2px_0px_var(--color-muted)]">
			{project.imageUrl && (
				<img
					src={project.imageUrl}
					alt={project.title}
					className="h-20 w-20 shrink-0 object-cover border border-muted/40 grayscale group-hover:grayscale-0 transition-all duration-500"
				/>
			)}

			<div className="min-w-0 flex-1 space-y-1.5">
				<div className="flex items-start justify-between gap-2">
					<div className="flex flex-wrap items-center gap-2 min-w-0">
						<h5 className="font-mono text-xs font-bold tracking-widest text-foreground uppercase group-hover:text-primary transition-colors">
							{project.pinned && (
								<span className="text-brackeys-yellow mr-1.5" title="Pinned">
									*
								</span>
							)}
							{project.title}
						</h5>
						<ProfileProjectTypeBadge
							type={project.type}
							subTypes={project.subTypes}
						/>
					</div>

					{project.url && (
						<a
							href={project.url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-muted-foreground/50 hover:text-primary transition-colors shrink-0"
						>
							<HugeiconsIcon icon={Link01Icon} size={12} />
						</a>
					)}
				</div>

				{project.description && (
					<p className="font-sans text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
						{project.description}
					</p>
				)}

				{project.tags && project.tags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{project.tags.map((tag) => (
							<span
								key={tag}
								className="px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-muted-foreground/50 border border-muted/30 uppercase hover:text-muted-foreground hover:border-muted/60 transition-colors"
							>
								{tag}
							</span>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function JamTimelineCard({ project }: { project: Project }) {
	return (
		<div className="group border border-muted/60 bg-card/25 px-3 py-3 transition-all duration-200 hover:border-muted hover:bg-card/45">
			<div className="flex items-start gap-3">
				<div className="relative mt-1.5 shrink-0">
					<div className="absolute left-1/2 top-3 h-[calc(100%+12px)] w-px -translate-x-1/2 bg-muted/30 group-last:hidden" />
					<div className="h-3 w-3 rounded-full border-2 border-brackeys-yellow/50 bg-background group-hover:border-brackeys-yellow/80 transition-colors" />
				</div>

				<div className="min-w-0 flex-1 space-y-1.5">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-mono text-xs font-bold tracking-widest text-foreground uppercase truncate">
							{project.jamUrl ? (
								<a
									href={project.jamUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									{project.jamName ?? project.title}
								</a>
							) : (
								(project.jamName ?? project.title)
							)}
						</span>
						<ProfileProjectTypeBadge
							type={project.type}
							subTypes={project.subTypes}
						/>
					</div>

					{project.submissionTitle && (
						<p className="font-mono text-[10px] text-muted-foreground/60 truncate">
							{project.submissionUrl ? (
								<a
									href={project.submissionUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									{project.submissionTitle}
								</a>
							) : (
								project.submissionTitle
							)}
						</p>
					)}

					<div className="flex flex-wrap items-center gap-2">
						{project.result && (
							<span className="font-mono text-[10px] font-bold tracking-widest text-brackeys-yellow uppercase">
								{project.result}
							</span>
						)}
						{project.participatedAt && (
							<span className="font-mono text-[10px] text-muted-foreground/40">
								{new Date(project.participatedAt).toLocaleDateString(
									undefined,
									{
										month: "short",
										year: "numeric",
									},
								)}
							</span>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
