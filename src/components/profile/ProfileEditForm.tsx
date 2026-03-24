import {
	Delete02Icon,
	GameController01Icon,
	Github01Icon,
	Globe02Icon,
	Link01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CharCount } from "@/components/ui/form-primitives";
import { Spinner } from "@/components/ui/spinner";
import { env } from "@/env";
import { authClient } from "@/lib/auth-client";
import { useMagnetic } from "@/lib/hooks/use-cursor";
import type { UploadedProfileProjectImage } from "@/lib/profile-project-images";
import type {
	ProfileProjectSubType,
	ProfileProjectType,
} from "@/lib/profile-projects";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";
import {
	buildCompletenessItems,
	type CompletenessItem,
} from "./ProfileCompleteness";
import { AddJamForm } from "./ProfileJamEditor";
import {
	AddProjectForm,
	EditableProjectCard,
	type ProjectUpdateData,
} from "./ProfileProjectEditor";
import {
	PendingSkillTag,
	SkillAutocomplete,
	SkillTag,
} from "./ProfileSkillEditor";

interface ProfileEditFormProps {
	profile: {
		id: string;
		discordId: string | null;
		discordUsername: string | null;
		avatarUrl: string | null;
		guildNickname: string | null;
		guildJoinedAt: Date | null;
		guildRoles: string[] | null;
		bio: string | null;
		tagline: string | null;
		githubUrl: string | null;
		twitterUrl: string | null;
		websiteUrl: string | null;
		availableForWork: boolean | null;
		availability: string | null;
		rateType: string | null;
		rateMin: number | null;
		rateMax: number | null;
		createdAt: Date;
		updatedAt: Date;
	};
	skills: Array<{ id: number; name: string; category: string | null }>;
	projects: Array<{
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
	}>;
	pendingSkillRequests?: Array<{ name: string }>;
	linkedAccounts?: Array<{
		id: number;
		provider: string;
		providerUserId: string;
		providerUsername: string | null;
		providerAvatarUrl: string | null;
		providerProfileUrl: string | null;
		linkedAt: Date;
	}>;
	urlStub: string | null;
	profileQueryKey: readonly unknown[];
	onCompletenessChange?: (items: CompletenessItem[]) => void;
}

function EditSection({
	label,
	complete,
	children,
	className,
}: {
	label: string;
	complete?: boolean;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("group/section", className)}>
			<div className="px-4 py-2 border-b border-muted/30 flex items-center justify-between">
				<span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
					{label}
				</span>
				{complete !== undefined && (
					<span
						className={cn(
							"w-1.5 h-1.5 rounded-full transition-colors",
							complete ? "bg-green-500" : "bg-muted/40",
						)}
						title={complete ? "Complete" : "Incomplete"}
					/>
				)}
			</div>
			{children}
		</div>
	);
}

const fieldSpring = {
	type: "spring",
	stiffness: 1000,
	damping: 30,
	mass: 0.1,
} as const;

function MagneticField({
	children,
	className,
	bounce = 0.01,
}: {
	children: React.ReactNode;
	className?: string;
	bounce?: number;
}) {
	const { ref, position } = useMagnetic(0);
	return (
		<motion.div
			ref={ref as React.RefObject<HTMLDivElement>}
			data-magnetic
			data-cursor-no-drift
			data-cursor-bounce={bounce}
			animate={{ x: position.x, y: position.y }}
			transition={fieldSpring}
			className={className}
		>
			{children}
		</motion.div>
	);
}

function LinkInput({
	icon,
	value,
	onChange,
	placeholder,
}: {
	icon: React.ReactNode;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
}) {
	return (
		<MagneticField>
			<div className="flex items-center gap-2 bg-muted/5 border border-muted/15 px-2.5 py-1.5 hover:border-muted/40 focus-within:border-primary/40 focus-within:bg-muted/10 transition-all group/link">
				<span className="text-muted-foreground/30 group-focus-within/link:text-primary/50 transition-colors shrink-0">
					{icon}
				</span>
				<input
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					className="flex-1 bg-transparent font-mono text-xs text-foreground placeholder-muted-foreground/20 outline-none"
				/>
				{value && (
					<span className="w-1.5 h-1.5 rounded-full bg-green-500/60 shrink-0" />
				)}
			</div>
		</MagneticField>
	);
}

type LinkedAccount = NonNullable<
	ProfileEditFormProps["linkedAccounts"]
>[number];
type LinkProvider = "github" | "itchio";

function LinkedAccountRow({
	icon,
	account,
	providerLabel,
	onLink,
	onUnlink,
	linking,
	linkDisabled,
	unlinking,
	extra,
}: {
	icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
	account: LinkedAccount | undefined;
	providerLabel: string;
	onLink: () => void;
	onUnlink: () => void;
	linking: boolean;
	linkDisabled: boolean;
	unlinking: boolean;
	extra?: React.ReactNode;
}) {
	if (account) {
		return (
			<MagneticField>
				<div className="flex items-center justify-between gap-2 bg-muted/5 border border-muted/15 px-2.5 py-2 hover:border-muted/40 transition-all">
					<div className="flex items-center gap-2 min-w-0">
						<span className="text-primary/60 shrink-0">
							<HugeiconsIcon icon={icon} size={14} />
						</span>
						<div className="min-w-0">
							<p className="font-mono text-xs text-foreground truncate">
								{account.providerUsername}
							</p>
							{account.providerProfileUrl && (
								<a
									href={account.providerProfileUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="font-mono text-[10px] text-muted-foreground/50 hover:text-primary/60 transition-colors truncate block"
								>
									{account.providerProfileUrl}
								</a>
							)}
						</div>
					</div>
					<div className="flex items-center gap-1.5 shrink-0">
						{extra}
						<button
							type="button"
							onClick={onUnlink}
							disabled={unlinking}
							className="text-muted-foreground/30 hover:text-destructive transition-colors p-0.5 disabled:opacity-50"
							title={`Unlink ${providerLabel}`}
						>
							<HugeiconsIcon icon={Delete02Icon} size={12} />
						</button>
					</div>
				</div>
			</MagneticField>
		);
	}

	return (
		<MagneticField>
			<button
				type="button"
				onClick={onLink}
				disabled={linkDisabled}
				aria-busy={linking}
				className="w-full flex items-center justify-center gap-2 bg-muted/5 border border-dashed border-muted/20 px-2.5 py-2.5 hover:border-primary/30 hover:bg-muted/10 transition-all group/link-btn disabled:cursor-wait disabled:opacity-70"
			>
				{linking ? (
					<Spinner className="size-3.5 text-primary/70" />
				) : (
					<HugeiconsIcon
						icon={Link01Icon}
						size={13}
						className="text-muted-foreground/30 group-hover/link-btn:text-primary/50 transition-colors"
					/>
				)}
				<span className="font-mono text-[10px] text-muted-foreground/40 group-hover/link-btn:text-foreground/60 transition-colors tracking-wider">
					{linking
						? `Redirecting to ${providerLabel}...`
						: `Link ${providerLabel} account`}
				</span>
			</button>
		</MagneticField>
	);
}

export function ProfileEditForm({
	profile,
	skills,
	projects,
	pendingSkillRequests,
	linkedAccounts,
	urlStub: initialUrlStub,
	profileQueryKey,
	onCompletenessChange,
}: ProfileEditFormProps) {
	const queryClient = useQueryClient();

	const serverPendingNames = useMemo(
		() => (pendingSkillRequests ?? []).map((r) => r.name),
		[pendingSkillRequests],
	);
	const [localPendingRequests, setLocalPendingRequests] = useState<string[]>(
		[],
	);
	const [linkingProvider, setLinkingProvider] = useState<LinkProvider | null>(
		null,
	);
	const pendingRequests = useMemo(() => {
		const all = new Set([...serverPendingNames, ...localPendingRequests]);
		return Array.from(all);
	}, [serverPendingNames, localPendingRequests]);

	const [tagline, setTagline] = useState(profile.tagline ?? "");
	const [bio, setBio] = useState(profile.bio ?? "");
	const [websiteUrl, setWebsiteUrl] = useState(profile.websiteUrl ?? "");
	const [availableForWork, setAvailableForWork] = useState(
		profile.availableForWork ?? false,
	);
	const [availability, setAvailability] = useState(
		profile.availability ?? "",
	);
	const [rateType, setRateType] = useState(profile.rateType ?? "");
	const [rateMin, setRateMin] = useState(profile.rateMin ?? 0);
	const [rateMax, setRateMax] = useState(profile.rateMax ?? 0);

	const githubAccount = linkedAccounts?.find((a) => a.provider === "github");
	const itchIoAccount = linkedAccounts?.find((a) => a.provider === "itchio");
	const githubUrl =
		githubAccount?.providerProfileUrl ?? profile.githubUrl ?? "";
	const itchIoUrl = itchIoAccount?.providerProfileUrl ?? "";
	const hasPendingLink = linkingProvider !== null;

	useEffect(() => {
		const handlePageShow = (event: PageTransitionEvent) => {
			if (event.persisted) {
				setLinkingProvider(null);
			}
		};

		window.addEventListener("pageshow", handlePageShow);
		return () => window.removeEventListener("pageshow", handlePageShow);
	}, []);

	useEffect(() => {
		onCompletenessChange?.(
			buildCompletenessItems({
				tagline,
				bio,
				skills,
				pendingSkillCount: pendingRequests.length,
				githubUrl,
				twitterUrl: null,
				websiteUrl,
				itchIoUrl,
				projects,
			}),
		);
	}, [
		tagline,
		bio,
		skills,
		pendingRequests.length,
		githubUrl,
		websiteUrl,
		itchIoUrl,
		projects,
		onCompletenessChange,
	]);

	const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const updateMutation = useMutation({
		mutationFn: (input: Parameters<typeof client.updateProfile>[0]) =>
			client.updateProfile(input),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: profileQueryKey }),
	});

	const debouncedSave = useCallback(
		(fields: Record<string, string | undefined>) => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => {
				updateMutation.mutate(fields);
			}, 800);
		},
		[updateMutation],
	);

	const handleFieldChange = (
		field: string,
		value: string,
		setter: (v: string) => void,
	) => {
		setter(value);
		debouncedSave({ [field]: value });
	};

	const addUserSkillMutation = useMutation({
		mutationFn: (skillId: number) => client.addUserSkill({ skillId }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: profileQueryKey });
			toast.success("Skill added");
		},
	});

	const [removedSkillIds, setRemovedSkillIds] = useState<Set<number>>(
		new Set(),
	);
	const removeUserSkillMutation = useMutation({
		mutationFn: (userSkillId: number) =>
			client.removeUserSkill({ userSkillId }),
		onMutate: (userSkillId) => {
			setRemovedSkillIds((prev) => new Set(prev).add(userSkillId));
		},
		onSuccess: async (_data, userSkillId) => {
			await queryClient.invalidateQueries({ queryKey: profileQueryKey });
			setRemovedSkillIds((prev) => {
				const next = new Set(prev);
				next.delete(userSkillId);
				return next;
			});
			toast.success("Skill removed");
		},
		onError: (_err, userSkillId) => {
			setRemovedSkillIds((prev) => {
				const next = new Set(prev);
				next.delete(userSkillId);
				return next;
			});
			toast.error("Failed to remove skill");
		},
	});

	const requestSkillMutation = useMutation({
		mutationFn: (name: string) => client.requestSkill({ name }),
		onSuccess: (_data, name) => {
			setLocalPendingRequests((prev) => [...prev, name]);
			toast.success("Skill requested");
		},
	});

	const [removedPendingNames, setRemovedPendingNames] = useState<Set<string>>(
		new Set(),
	);
	const cancelSkillRequestMutation = useMutation({
		mutationFn: (name: string) => client.cancelSkillRequest({ name }),
		onMutate: (name) => {
			setRemovedPendingNames((prev) => new Set(prev).add(name));
			setLocalPendingRequests((prev) => prev.filter((n) => n !== name));
		},
		onSuccess: async (_data, name) => {
			await queryClient.invalidateQueries({ queryKey: profileQueryKey });
			setRemovedPendingNames((prev) => {
				const next = new Set(prev);
				next.delete(name);
				return next;
			});
			toast.success("Skill request cancelled");
		},
		onError: (_err, name) => {
			setRemovedPendingNames((prev) => {
				const next = new Set(prev);
				next.delete(name);
				return next;
			});
			toast.error("Failed to cancel skill request");
		},
	});

	const addProjectMutation = useMutation({
		mutationFn: (data: {
			title: string;
			description?: string;
			url?: string;
			image?: UploadedProfileProjectImage;
			type: Exclude<ProfileProjectType, "jam">;
			subTypes?: ProfileProjectSubType[];
		}) => client.addProject(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: profileQueryKey });
			toast.success("Project added");
		},
	});

	const updateProjectMutation = useMutation({
		mutationFn: (data: ProjectUpdateData) => client.updateProject(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: profileQueryKey });
			toast.success("Project updated");
		},
		onError: () => {
			toast.error("Failed to update project");
		},
	});

	const [removedProjectIds, setRemovedProjectIds] = useState<Set<string>>(
		new Set(),
	);
	const removeProjectMutation = useMutation({
		mutationFn: (projectId: string) => client.removeProject({ projectId }),
		onMutate: (projectId) => {
			setRemovedProjectIds((prev) => new Set(prev).add(projectId));
		},
		onSuccess: async (_data, projectId) => {
			await queryClient.invalidateQueries({ queryKey: profileQueryKey });
			setRemovedProjectIds((prev) => {
				const next = new Set(prev);
				next.delete(projectId);
				return next;
			});
			toast.success("Project removed");
		},
		onError: (_err, projectId) => {
			setRemovedProjectIds((prev) => {
				const next = new Set(prev);
				next.delete(projectId);
				return next;
			});
			toast.error("Failed to remove project");
		},
	});

	const addJamMutation = useMutation({
		mutationFn: (data: {
			jamName: string;
			submissionTitle?: string;
			submissionUrl?: string;
			result?: string;
		}) => client.addJamParticipation(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: profileQueryKey });
			toast.success("Jam entry added");
		},
	});

	const removeJamMutation = useMutation({
		mutationFn: (jamId: string) => client.removeJamParticipation({ jamId }),
		onMutate: (jamId) => {
			setRemovedProjectIds((prev) => new Set(prev).add(jamId));
		},
		onSuccess: async (_data, jamId) => {
			await queryClient.invalidateQueries({ queryKey: profileQueryKey });
			setRemovedProjectIds((prev) => {
				const next = new Set(prev);
				next.delete(jamId);
				return next;
			});
			toast.success("Jam entry removed");
		},
		onError: (_err, jamId) => {
			setRemovedProjectIds((prev) => {
				const next = new Set(prev);
				next.delete(jamId);
				return next;
			});
			toast.error("Failed to remove jam entry");
		},
	});

	const unlinkItchIoMutation = useMutation({
		mutationFn: () => client.unlinkItchIo({}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: profileQueryKey });
			toast.success("itch.io account unlinked");
		},
		onError: () => {
			toast.error("Failed to unlink itch.io account");
		},
	});

	const importItchIoGamesMutation = useMutation({
		mutationFn: () => client.importItchIoGames({}),
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: profileQueryKey });
			if (data.imported > 0) {
				toast.success(
					`Imported ${data.imported} game${data.imported === 1 ? "" : "s"} from itch.io`,
				);
			} else {
				toast.info("No new games to import");
			}
		},
		onError: (err: Error) => {
			toast.error(err.message || "Failed to import games from itch.io");
		},
	});

	const unlinkGitHubMutation = useMutation({
		mutationFn: () => client.unlinkGitHub({}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: profileQueryKey });
			toast.success("GitHub account unlinked");
		},
		onError: () => {
			toast.error("Failed to unlink GitHub account");
		},
	});

	const handleLinkGitHub = async () => {
		if (hasPendingLink) return;

		setLinkingProvider("github");

		try {
			const result = await authClient.signIn.social({
				provider: "github",
				callbackURL: "/oauth/github/callback",
			});

			if (
				result &&
				typeof result === "object" &&
				"error" in result &&
				result.error
			) {
				const message =
					typeof result.error === "string"
						? result.error
						: result.error.message || "Failed to start GitHub OAuth";
				throw new Error(message);
			}
		} catch (error) {
			setLinkingProvider(null);
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to start GitHub OAuth",
			);
		}
	};

	const handleLinkItchIo = () => {
		const clientId = env.VITE_ITCHIO_CLIENT_ID;
		if (!clientId) {
			toast.error("itch.io integration is not configured");
			return;
		}

		if (hasPendingLink) return;

		setLinkingProvider("itchio");

		const redirectUri = `${window.location.origin}/oauth/itchio/callback`;
		const params = new URLSearchParams({
			client_id: clientId,
			scope: "profile:me profile:games",
			response_type: "token",
			redirect_uri: redirectUri,
		});
		window.location.href = `https://itch.io/user/oauth?${params.toString()}`;
	};

	const visibleSkills = skills.filter((s) => !removedSkillIds.has(s.id));
	const visiblePendingRequests = pendingRequests.filter(
		(n) => !removedPendingNames.has(n),
	);
	const visibleProjects = projects.filter((p) => !removedProjectIds.has(p.id));

	const [urlStub, setUrlStub] = useState(initialUrlStub ?? "");
	const [urlStubError, setUrlStubError] = useState("");

	useEffect(() => {
		if (initialUrlStub && urlStub === "") {
			setUrlStub(initialUrlStub);
		}
	}, [initialUrlStub, urlStub]);

	const setUrlStubMutation = useMutation({
		mutationFn: (stub: string) => client.setUrlStub({ stub }),
		onSuccess: () => {
			setUrlStubError("");
			queryClient.invalidateQueries({ queryKey: profileQueryKey });
		},
		onError: (err: Error) => {
			setUrlStubError(err.message);
		},
	});

	const urlStubDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const handleUrlStubChange = (value: string) => {
		const sanitized = value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
		setUrlStub(sanitized);
		setUrlStubError("");
		if (urlStubDebounceRef.current) clearTimeout(urlStubDebounceRef.current);
		if (sanitized.length >= 3) {
			urlStubDebounceRef.current = setTimeout(() => {
				setUrlStubMutation.mutate(sanitized);
			}, 800);
		}
	};

	return (
		<>
			<EditSection label="Tagline" complete={!!tagline.trim()}>
				<div className="px-4 py-3 border-b border-muted/30 space-y-1">
					<MagneticField>
						<input
							type="text"
							value={tagline}
							onChange={(e) =>
								handleFieldChange("tagline", e.target.value, setTagline)
							}
							placeholder="What do you do? e.g. 'Unity developer & pixel art enthusiast'"
							maxLength={120}
							className="w-full bg-transparent border-b border-muted/15 pb-1.5 font-mono text-sm text-foreground placeholder-muted-foreground/20 outline-none focus:border-primary/40 hover:border-muted/40 transition-colors"
						/>
					</MagneticField>
					<div className="flex justify-end">
						<CharCount current={tagline.length} min={5} max={120} />
					</div>
				</div>
			</EditSection>

			<EditSection label="Bio" complete={!!bio.trim()}>
				<div className="px-4 py-3 border-b border-muted/30 space-y-1">
					<MagneticField bounce={0.01}>
						<textarea
							value={bio}
							onChange={(e) => handleFieldChange("bio", e.target.value, setBio)}
							placeholder="Tell the community about yourself, your experience, what you're working on..."
							rows={4}
							maxLength={500}
							className="w-full bg-muted/5 border border-muted/15 p-2.5 font-mono text-xs text-foreground placeholder-muted-foreground/20 outline-none focus:border-primary/40 hover:border-muted/40 hover:bg-muted/10 resize-none transition-all leading-relaxed"
						/>
					</MagneticField>
					<div className="flex justify-end">
						<CharCount current={bio.length} min={20} max={500} />
					</div>
				</div>
			</EditSection>

			<EditSection label="Skills" complete={visibleSkills.length > 0}>
				<div className="px-4 py-3 border-b border-muted/30">
					{visibleSkills.length === 0 && visiblePendingRequests.length === 0 ? (
						<div className="flex flex-col items-center gap-2 py-2">
							<p className="font-mono text-[10px] text-muted-foreground/30 tracking-wider">
								No skills added yet
							</p>
							<SkillAutocomplete
								onAddSkill={(skillId) => addUserSkillMutation.mutate(skillId)}
								onRequestSkill={(name) => requestSkillMutation.mutate(name)}
							/>
						</div>
					) : (
						<div className="flex flex-wrap gap-1.5">
							{visibleSkills.map((skill) => (
								<SkillTag
									key={skill.id}
									name={skill.name}
									onRemove={() => removeUserSkillMutation.mutate(skill.id)}
								/>
							))}
							{visiblePendingRequests.map((name) => (
								<PendingSkillTag
									key={name}
									name={name}
									onRemove={() => cancelSkillRequestMutation.mutate(name)}
								/>
							))}
							<SkillAutocomplete
								onAddSkill={(skillId) => addUserSkillMutation.mutate(skillId)}
								onRequestSkill={(name) => requestSkillMutation.mutate(name)}
							/>
						</div>
					)}
				</div>
			</EditSection>

			<EditSection label="Available for Work">
				<div className="px-4 py-3 border-b border-muted/30 space-y-3">
					{/* Toggle */}
					<MagneticField>
						<button
							type="button"
							onClick={() => {
								const next = !availableForWork;
								setAvailableForWork(next);
								if (!next) {
									setAvailability("");
									setRateType("");
									setRateMin(0);
									setRateMax(0);
								}
								updateMutation.mutate({
									availableForWork: next,
									...(!next && {
										availability: null,
										rateType: null,
										rateMin: null,
										rateMax: null,
									}),
								});
							}}
							className={cn(
								"w-full flex items-center justify-between px-2.5 py-2 border transition-all",
								availableForWork
									? "bg-cyan-500/5 border-cyan-500/30"
									: "bg-muted/5 border-muted/15 hover:border-muted/40",
							)}
						>
							<span className="font-mono text-[10px] font-bold tracking-widest uppercase text-muted-foreground/60">
								Available for hire
							</span>
							<div
								className={cn(
									"w-8 h-4 rounded-full relative transition-colors",
									availableForWork ? "bg-cyan-500" : "bg-muted/30",
								)}
							>
								<div
									className={cn(
										"absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
										availableForWork ? "left-4" : "left-0.5",
									)}
								/>
							</div>
						</button>
					</MagneticField>

					{availableForWork && (
						<div className="space-y-3">
							{/* Availability type */}
							<div className="space-y-1.5">
								<span className="font-mono text-[10px] tracking-widest text-muted-foreground/40 uppercase">
									Availability
								</span>
								<div className="grid grid-cols-3 gap-1.5">
									{(
										[
											["full_time", "Full-Time"],
											["part_time", "Part-Time"],
											["limited", "Limited"],
										] as const
									).map(([value, label]) => (
										<button
											key={value}
											type="button"
											onClick={() => {
												setAvailability(value);
												updateMutation.mutate({ availability: value });
											}}
											className={cn(
												"px-2 py-1.5 font-mono text-[10px] font-bold tracking-widest uppercase border transition-all text-center",
												availability === value
													? "bg-cyan-500/10 border-cyan-500/40 text-cyan-500"
													: "bg-muted/5 border-muted/15 text-muted-foreground/40 hover:border-muted/40 hover:text-muted-foreground/60",
											)}
										>
											{label}
										</button>
									))}
								</div>
							</div>

							{/* Rate type */}
							<div className="space-y-1.5">
								<span className="font-mono text-[10px] tracking-widest text-muted-foreground/40 uppercase">
									Rate Type
								</span>
								<div className="grid grid-cols-3 gap-1.5">
									{(
										[
											["hourly", "Hourly"],
											["fixed", "Fixed"],
											["negotiable", "Negotiable"],
										] as const
									).map(([value, label]) => (
										<button
											key={value}
											type="button"
											onClick={() => {
												setRateType(value);
												if (value === "negotiable") {
													setRateMin(0);
													setRateMax(0);
													updateMutation.mutate({
														rateType: value,
														rateMin: null,
														rateMax: null,
													});
												} else {
													updateMutation.mutate({ rateType: value });
												}
											}}
											className={cn(
												"px-2 py-1.5 font-mono text-[10px] font-bold tracking-widest uppercase border transition-all text-center",
												rateType === value
													? "bg-cyan-500/10 border-cyan-500/40 text-cyan-500"
													: "bg-muted/5 border-muted/15 text-muted-foreground/40 hover:border-muted/40 hover:text-muted-foreground/60",
											)}
										>
											{label}
										</button>
									))}
								</div>
							</div>

							{/* Rate range (only for hourly/fixed) */}
							{rateType && rateType !== "negotiable" && (
								<div className="space-y-1.5">
									<span className="font-mono text-[10px] tracking-widest text-muted-foreground/40 uppercase">
										Rate Range ($)
									</span>
									<div className="grid grid-cols-2 gap-2">
										<MagneticField>
											<div className="flex items-center gap-1.5 bg-muted/5 border border-muted/15 px-2.5 py-1.5 hover:border-muted/40 focus-within:border-primary/40 transition-all">
												<span className="font-mono text-[10px] text-muted-foreground/30">
													MIN
												</span>
												<input
													type="number"
													min={0}
													value={rateMin || ""}
													onChange={(e) => {
														const v = Number.parseInt(e.target.value) || 0;
														setRateMin(v);
														debouncedSave({ rateMin: v } as never);
													}}
													placeholder="0"
													className="w-full bg-transparent font-mono text-xs text-foreground placeholder-muted-foreground/20 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
												/>
											</div>
										</MagneticField>
										<MagneticField>
											<div className="flex items-center gap-1.5 bg-muted/5 border border-muted/15 px-2.5 py-1.5 hover:border-muted/40 focus-within:border-primary/40 transition-all">
												<span className="font-mono text-[10px] text-muted-foreground/30">
													MAX
												</span>
												<input
													type="number"
													min={0}
													value={rateMax || ""}
													onChange={(e) => {
														const v = Number.parseInt(e.target.value) || 0;
														setRateMax(v);
														debouncedSave({ rateMax: v } as never);
													}}
													placeholder="0"
													className="w-full bg-transparent font-mono text-xs text-foreground placeholder-muted-foreground/20 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
												/>
											</div>
										</MagneticField>
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			</EditSection>

			<EditSection label="Profile URL">
				<div className="px-4 py-3 border-b border-muted/30 space-y-1.5">
					<MagneticField>
						<div className="flex items-center gap-1 hover:bg-muted/5 -mx-1 px-1 py-0.5 rounded transition-colors">
							<span className="font-mono text-[10px] text-muted-foreground/40 shrink-0">
								/profile/
							</span>
							<input
								type="text"
								value={urlStub}
								onChange={(e) => handleUrlStubChange(e.target.value)}
								placeholder="your-name"
								maxLength={32}
								className="flex-1 bg-transparent border-b border-muted/15 pb-0.5 font-mono text-xs text-foreground placeholder-muted-foreground/20 outline-none focus:border-primary/50 hover:border-muted/40 transition-colors"
							/>
						</div>
					</MagneticField>
					<div className="flex justify-between items-center">
						<div>
							{urlStubError && (
								<p className="font-mono text-[10px] text-destructive">
									{urlStubError}
								</p>
							)}
							{!urlStubError &&
								urlStub.length >= 3 &&
								initialUrlStub === urlStub && (
									<p className="font-mono text-[10px] text-green-500">Saved</p>
								)}
						</div>
						<CharCount current={urlStub.length} min={3} max={32} />
					</div>
				</div>
			</EditSection>

			<EditSection
				label="Linked Accounts"
				complete={!!(githubAccount || itchIoAccount)}
			>
				<div className="px-4 py-3 border-b border-muted/30 space-y-2">
					<LinkedAccountRow
						icon={Github01Icon}
						account={githubAccount}
						providerLabel="GitHub"
						onLink={handleLinkGitHub}
						onUnlink={() => unlinkGitHubMutation.mutate()}
						linking={linkingProvider === "github"}
						linkDisabled={hasPendingLink}
						unlinking={unlinkGitHubMutation.isPending}
					/>
					<LinkedAccountRow
						icon={GameController01Icon}
						account={itchIoAccount}
						providerLabel="itch.io"
						onLink={handleLinkItchIo}
						onUnlink={() => unlinkItchIoMutation.mutate()}
						linking={linkingProvider === "itchio"}
						linkDisabled={hasPendingLink}
						unlinking={unlinkItchIoMutation.isPending}
						extra={
							itchIoAccount ? (
								<button
									type="button"
									onClick={() => importItchIoGamesMutation.mutate()}
									disabled={importItchIoGamesMutation.isPending}
									className="font-mono text-[10px] text-muted-foreground/50 hover:text-primary/80 transition-colors px-1.5 py-0.5 hover:bg-muted/10 disabled:opacity-50"
								>
									{importItchIoGamesMutation.isPending
										? "Importing..."
										: "Import games"}
								</button>
							) : undefined
						}
					/>
				</div>
			</EditSection>

			<EditSection label="Links" complete={!!websiteUrl}>
				<div className="px-4 py-3 border-b border-muted/30 space-y-2">
					<LinkInput
						icon={<HugeiconsIcon icon={Globe02Icon} size={13} />}
						value={websiteUrl}
						onChange={(v) => handleFieldChange("websiteUrl", v, setWebsiteUrl)}
						placeholder="portfolio.dev"
					/>
				</div>
			</EditSection>

			<EditSection label="Projects" complete={visibleProjects.length > 0}>
				<div className="px-4 py-3 border-b border-muted/30 space-y-2">
					{visibleProjects.length === 0 ? (
						<div className="text-center py-2">
							<p className="font-mono text-[10px] text-muted-foreground/30 tracking-wider mb-2">
								Showcase your work and jam history
							</p>
							<div className="space-y-2">
								<AddProjectForm
									onAdd={(data) => addProjectMutation.mutate(data)}
								/>
								<AddJamForm onAdd={(data) => addJamMutation.mutate(data)} />
							</div>
						</div>
					) : (
						<>
							{visibleProjects.map((project) => (
								<EditableProjectCard
									key={project.id}
									project={project}
									onRemove={() =>
										project.type === "jam"
											? removeJamMutation.mutate(project.id)
											: removeProjectMutation.mutate(project.id)
									}
									onEdit={(data) => updateProjectMutation.mutate(data)}
								/>
							))}
							<div className="space-y-2 pt-1">
								<AddProjectForm
									onAdd={(data) => addProjectMutation.mutate(data)}
								/>
								<AddJamForm onAdd={(data) => addJamMutation.mutate(data)} />
							</div>
						</>
					)}
				</div>
			</EditSection>
		</>
	);
}
