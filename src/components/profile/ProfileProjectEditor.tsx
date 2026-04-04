import {
  Add01Icon,
  Delete02Icon,
  Image01Icon,
  Link01Icon,
  PencilEdit01Icon,
  Tick01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { type FileRejection, useDropzone } from "react-dropzone";
import { useMagnetic } from "@/lib/hooks/use-cursor";
import {
  PROFILE_PROJECT_IMAGE_ACCEPTED_MIME_TYPES,
  PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES,
  type UploadedProfileProjectImage,
} from "@/lib/profile-project-images";
import {
  getAllowedProfileProjectSubTypes,
  MANUAL_PROFILE_PROJECT_TYPES,
  type ManualProfileProjectType,
  PROFILE_PROJECT_SUBTYPE_LABELS,
  PROFILE_PROJECT_TYPE_LABELS,
  type ProfileProjectSubType,
  type ProfileProjectType,
} from "@/lib/profile-projects";
import { cn } from "@/lib/utils";
import { ProfileProjectTypeBadge } from "./ProfileProjectTypeBadge";

const fieldSpring = {
  type: "spring",
  stiffness: 1000,
  damping: 30,
  mass: 0.1,
} as const;
const inputCls =
  "w-full bg-transparent border border-muted/20 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/25 outline-none focus:border-primary/40 transition-colors";
const dropzoneAccept = Object.fromEntries(
  PROFILE_PROJECT_IMAGE_ACCEPTED_MIME_TYPES.map((mimeType) => [mimeType, []]),
);

async function uploadProfileProjectImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/api/profile/project-image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(errorData?.message ?? "Upload failed.");
  }

  return (await response.json()) as UploadedProfileProjectImage;
}

interface EditableProject {
  id: string;
  type: ProfileProjectType;
  subTypes: string[];
  title: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  pinned: boolean | null;
  status: string;
  jamName: string | null;
  jamUrl: string | null;
  submissionTitle: string | null;
  submissionUrl: string | null;
  result: string | null;
  participatedAt: Date | null;
}

export interface ProjectUpdateData {
  projectId: string;
  title?: string;
  description?: string;
  url?: string;
  image?: UploadedProfileProjectImage;
  type?: ManualProfileProjectType;
  subTypes?: ProfileProjectSubType[];
}

export function EditableProjectCard({
  project,
  onRemove,
  onEdit,
}: {
  project: EditableProject;
  onRemove: () => void;
  onEdit?: (data: ProjectUpdateData) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (project.type === "jam") {
    return (
      <div className="group border border-muted/20 bg-muted/5 hover:border-muted/40 transition-colors p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="relative flex min-w-0 flex-1 gap-3">
            <div className="mt-1.5 shrink-0">
              <div className="h-3 w-3 rounded-full border-2 border-brackeys-yellow/40 bg-brackeys-yellow/10 transition-colors group-hover:border-brackeys-yellow/70" />
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-foreground">
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
                <ProfileProjectTypeBadge type={project.type} subTypes={project.subTypes} />
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
                  <span className="bg-brackeys-yellow/10 border border-brackeys-yellow/25 px-1.5 py-0.5 font-mono text-[9px] text-brackeys-yellow uppercase tracking-wider">
                    {project.result}
                  </span>
                )}
                {project.participatedAt && (
                  <span className="font-mono text-[10px] text-muted-foreground/45">
                    {new Date(project.participatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onRemove}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all shrink-0 mt-0.5"
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} />
          </button>
        </div>
      </div>
    );
  }

  if (editing && onEdit) {
    return (
      <InlineProjectEditForm
        project={project}
        onSave={(data) => {
          onEdit(data);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="group flex gap-3 border border-muted/20 bg-muted/5 hover:border-muted/40 hover:bg-muted/10 transition-colors p-3">
      {project.imageUrl && (
        <img
          src={project.imageUrl}
          alt={project.title}
          className="h-16 w-16 shrink-0 object-cover border border-muted/20"
        />
      )}

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="font-mono text-[11px] font-bold text-foreground uppercase tracking-wider truncate">
              {project.pinned && <span className="text-brackeys-yellow mr-1.5">*</span>}
              {project.title}
            </span>
            <ProfileProjectTypeBadge type={project.type} subTypes={project.subTypes} />
            {project.status === "pending" && (
              <span className="shrink-0 bg-brackeys-yellow/10 border border-brackeys-yellow/25 px-1.5 py-0.5 font-mono text-[9px] text-brackeys-yellow uppercase tracking-wider">
                Pending
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-primary transition-all"
              >
                <HugeiconsIcon icon={PencilEdit01Icon} size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all"
            >
              <HugeiconsIcon icon={Delete02Icon} size={12} />
            </button>
          </div>
        </div>

        {project.description && (
          <p className="font-mono text-[10px] text-muted-foreground/60 line-clamp-2 leading-relaxed">
            {project.description}
          </p>
        )}

        {project.url && (
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[10px] text-primary/60 hover:text-primary transition-colors truncate"
          >
            <HugeiconsIcon icon={Link01Icon} size={10} />
            {project.url}
          </a>
        )}
      </div>
    </div>
  );
}

function InlineProjectEditForm({
  project,
  onSave,
  onCancel,
}: {
  project: EditableProject;
  onSave: (data: ProjectUpdateData) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? "");
  const [url, setUrl] = useState(project.url ?? "");
  const [type, setType] = useState<ManualProfileProjectType>(
    project.type as ManualProfileProjectType,
  );
  const [subTypes, setSubTypes] = useState<ProfileProjectSubType[]>(
    (project.subTypes ?? []) as ProfileProjectSubType[],
  );
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const allowedSubTypes = getAllowedProfileProjectSubTypes(type);

  const handleTypeChange = (nextType: ManualProfileProjectType) => {
    const nextAllowed = getAllowedProfileProjectSubTypes(nextType);
    setType(nextType);
    setSubTypes((current) => current.filter((s) => nextAllowed.includes(s)));
  };

  const toggleSubType = (subType: ProfileProjectSubType) => {
    setSubTypes((current) =>
      current.includes(subType) ? current.filter((v) => v !== subType) : [...current, subType],
    );
  };

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const {
    getInputProps,
    getRootProps,
    isDragActive,
    open: openFilePicker,
  } = useDropzone({
    accept: dropzoneAccept,
    disabled: isUploading,
    maxFiles: 1,
    maxSize: PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES,
    multiple: false,
    noClick: true,
    onDropAccepted: ([file]) => {
      if (!file) return;
      setUploadError("");
      setSelectedImageFile(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(file));
    },
    onDropRejected: (rejections: FileRejection[]) => {
      const firstError = rejections[0]?.errors[0];
      if (!firstError) {
        setUploadError("Image upload failed.");
        return;
      }
      switch (firstError.code) {
        case "file-invalid-type":
          setUploadError("Use a PNG, JPG, WEBP, or GIF image.");
          break;
        case "file-too-large":
          setUploadError("Image must be smaller than 5 MB.");
          break;
        default:
          setUploadError(firstError.message);
      }
    },
  });

  const handleSubmit = async () => {
    if (!title.trim() || isUploading) return;

    setUploadError("");
    setIsUploading(true);

    try {
      const uploadedImage = selectedImageFile
        ? await uploadProfileProjectImage(selectedImageFile)
        : undefined;

      onSave({
        projectId: project.id,
        title: title.trim(),
        description: description.trim() || undefined,
        url: url.trim() || undefined,
        image: uploadedImage,
        type,
        subTypes: subTypes.length > 0 ? subTypes : undefined,
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to upload image.");
    } finally {
      setIsUploading(false);
    }
  };

  const currentImageUrl = previewUrl ?? project.imageUrl;

  return (
    <div className="border border-primary/25 bg-primary/3 p-3 space-y-3">
      <div className="flex gap-3">
        {/* Image preview / dropzone */}
        <button
          type="button"
          {...getRootProps()}
          className={cn(
            "relative h-16 w-16 shrink-0 border border-dashed flex items-center justify-center cursor-pointer transition-colors",
            isDragActive
              ? "border-primary/50 bg-primary/10"
              : "border-muted/30 bg-muted/5 hover:border-muted/50",
          )}
          onClick={openFilePicker}
        >
          <input {...getInputProps()} />
          {currentImageUrl ? (
            <img src={currentImageUrl} alt="Preview" className="h-full w-full object-cover" />
          ) : (
            <HugeiconsIcon icon={Image01Icon} size={16} className="text-muted-foreground/30" />
          )}
        </button>

        {/* Title + type */}
        <div className="min-w-0 flex-1 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Project title *"
            className={inputCls}
          />
          <div className="flex flex-wrap gap-1.5">
            {MANUAL_PROFILE_PROJECT_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => handleTypeChange(option)}
                className={cn(
                  "border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] transition-colors",
                  type === option
                    ? "border-primary/40 bg-primary/12 text-primary"
                    : "border-muted/20 text-muted-foreground/40 hover:border-muted/40 hover:text-foreground/60",
                )}
              >
                {PROFILE_PROJECT_TYPE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {allowedSubTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allowedSubTypes.map((subType) => (
            <button
              key={subType}
              type="button"
              onClick={() => toggleSubType(subType)}
              className={cn(
                "border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] transition-colors",
                subTypes.includes(subType)
                  ? "border-primary/35 bg-primary/10 text-primary"
                  : "border-muted/20 text-muted-foreground/40 hover:border-muted/40 hover:text-foreground/60",
              )}
            >
              {PROFILE_PROJECT_SUBTYPE_LABELS[subType]}
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Short description"
        className={inputCls}
      />
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL (itch.io, GitHub...)"
        className={inputCls}
      />

      {uploadError && <p className="font-mono text-[10px] text-destructive">{uploadError}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isUploading || !title.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 bg-primary/15 border border-primary/30 py-1.5 font-mono text-[10px] text-primary uppercase tracking-widest hover:bg-primary/25 transition-colors disabled:opacity-50"
        >
          <HugeiconsIcon icon={Tick01Icon} size={10} />
          {isUploading ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 flex items-center justify-center gap-1.5 border border-muted/20 py-1.5 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest hover:border-muted/40 transition-colors"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={10} />
          Cancel
        </button>
      </div>
    </div>
  );
}

export function AddProjectForm({
  onAdd,
}: {
  onAdd: (data: {
    title: string;
    description?: string;
    url?: string;
    image?: UploadedProfileProjectImage;
    type: ManualProfileProjectType;
    subTypes?: ProfileProjectSubType[];
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [type, setType] = useState<ManualProfileProjectType>("game");
  const [subTypes, setSubTypes] = useState<ProfileProjectSubType[]>([]);

  const allowedSubTypes = getAllowedProfileProjectSubTypes(type);

  const handleTypeChange = (nextType: ManualProfileProjectType) => {
    const nextAllowedSubTypes = getAllowedProfileProjectSubTypes(nextType);
    setType(nextType);
    setSubTypes((current) => current.filter((subType) => nextAllowedSubTypes.includes(subType)));
  };

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setUrl("");
    setSelectedImageFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setUploadError("");
    setType("game");
    setSubTypes([]);
    setOpen(false);
  };

  const handleSubmit = async () => {
    if (!title.trim() || isUploading) return;

    setUploadError("");
    setIsUploading(true);

    try {
      const uploadedImage = selectedImageFile
        ? await uploadProfileProjectImage(selectedImageFile)
        : undefined;

      onAdd({
        title: title.trim(),
        description: description.trim() || undefined,
        url: url.trim() || undefined,
        image: uploadedImage,
        type,
        subTypes: subTypes.length > 0 ? subTypes : undefined,
      });

      resetForm();
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Failed to upload profile project image.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const toggleSubType = (subType: ProfileProjectSubType) => {
    setSubTypes((current) =>
      current.includes(subType)
        ? current.filter((value) => value !== subType)
        : [...current, subType],
    );
  };

  const { ref, position } = useMagnetic(0);
  const {
    getInputProps,
    getRootProps,
    isDragActive,
    open: openFilePicker,
  } = useDropzone({
    accept: dropzoneAccept,
    disabled: isUploading,
    maxFiles: 1,
    maxSize: PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES,
    multiple: false,
    noClick: true,
    onDropAccepted: (acceptedFiles) => {
      const [file] = acceptedFiles;
      if (!file) return;

      setUploadError("");
      setSelectedImageFile(file);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(URL.createObjectURL(file));
    },
    onDropRejected: (rejections: FileRejection[]) => {
      const [rejection] = rejections;
      const firstError = rejection?.errors[0];
      if (!firstError) {
        setUploadError("Image upload failed. Please try again.");
        return;
      }

      switch (firstError.code) {
        case "file-invalid-type":
          setUploadError("Use a PNG, JPG, WEBP, or GIF image.");
          break;
        case "file-too-large":
          setUploadError("Image must be smaller than 5 MB.");
          break;
        default:
          setUploadError(firstError.message);
      }
    },
  });

  if (!open) {
    return (
      <motion.button
        ref={ref as React.RefObject<HTMLButtonElement>}
        data-magnetic
        data-cursor-no-drift
        animate={{ x: position.x, y: position.y }}
        transition={fieldSpring}
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border border-dashed border-muted/25 py-3 font-mono text-[10px] text-muted-foreground/50 hover:border-primary/40 hover:text-primary transition-colors uppercase tracking-widest flex items-center justify-center gap-1.5"
      >
        <HugeiconsIcon icon={Add01Icon} size={10} />
        Add Project
      </motion.button>
    );
  }

  return (
    <div className="border border-primary/20 bg-primary/3 p-3 space-y-3">
      <div className="flex gap-3">
        {/* Image area */}
        <button
          type="button"
          {...getRootProps()}
          className={cn(
            "relative h-16 w-16 shrink-0 border border-dashed flex items-center justify-center cursor-pointer transition-colors",
            isDragActive
              ? "border-primary/50 bg-primary/10"
              : "border-muted/30 bg-muted/5 hover:border-muted/50",
          )}
          onClick={openFilePicker}
        >
          <input {...getInputProps()} />
          {previewUrl ? (
            <>
              <img src={previewUrl} alt="Preview" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedImageFile(null);
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(null);
                  setUploadError("");
                }}
                className="absolute -top-1.5 -right-1.5 bg-background border border-muted/40 rounded-full p-0.5 text-muted-foreground/60 hover:text-destructive transition-colors"
              >
                <HugeiconsIcon icon={Delete02Icon} size={8} />
              </button>
            </>
          ) : (
            <span className="flex flex-col items-center gap-0.5">
              <HugeiconsIcon icon={Image01Icon} size={16} className="text-muted-foreground/30" />
              <span className="font-mono text-[7px] text-muted-foreground/25 uppercase">Image</span>
            </span>
          )}
        </button>

        {/* Title + type */}
        <div className="min-w-0 flex-1 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Project title *"
            className={inputCls}
          />
          <div className="flex flex-wrap gap-1.5">
            {MANUAL_PROFILE_PROJECT_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => handleTypeChange(option)}
                className={cn(
                  "border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] transition-colors",
                  type === option
                    ? "border-primary/40 bg-primary/12 text-primary"
                    : "border-muted/20 text-muted-foreground/40 hover:border-muted/40 hover:text-foreground/60",
                )}
              >
                {PROFILE_PROJECT_TYPE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {allowedSubTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allowedSubTypes.map((subType) => (
            <button
              key={subType}
              type="button"
              onClick={() => toggleSubType(subType)}
              className={cn(
                "border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] transition-colors",
                subTypes.includes(subType)
                  ? "border-primary/35 bg-primary/10 text-primary"
                  : "border-muted/20 text-muted-foreground/40 hover:border-muted/40 hover:text-foreground/60",
              )}
            >
              {PROFILE_PROJECT_SUBTYPE_LABELS[subType]}
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Short description"
        className={inputCls}
      />
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL (itch.io, GitHub...)"
        className={inputCls}
      />

      {uploadError && <p className="font-mono text-[10px] text-destructive">{uploadError}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isUploading || !title.trim()}
          className="flex-1 bg-primary/15 border border-primary/30 py-1.5 font-mono text-[10px] text-primary uppercase tracking-widest hover:bg-primary/25 transition-colors disabled:opacity-50"
        >
          {isUploading ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-1 border border-muted/20 py-1.5 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest hover:border-muted/40 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
