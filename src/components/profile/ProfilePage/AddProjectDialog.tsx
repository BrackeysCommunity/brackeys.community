import { Add01Icon, Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { type FileRejection, useDropzone } from "react-dropzone";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { errorMessage } from "@/lib/error-message";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { postImageForm } from "@/lib/image-upload";
import {
  PROFILE_PROJECT_IMAGE_ACCEPTED_MIME_TYPES,
  PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES,
  type UploadedProfileProjectImage,
} from "@/lib/image-upload-policy";
import { reportMutationError } from "@/lib/posthog";
import {
  getAllowedSubTypesForProjectType,
  PROFILE_PROJECT_SUBTYPE_LABELS,
  type ProfileProjectSubType,
} from "@/lib/profile-projects";
import { projectTypeLabel } from "@/lib/project-links";
import { MANUAL_PROJECT_TYPES, type ManualProjectType } from "@/lib/project-taxonomy";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface AddProjectInput {
  title: string;
  description?: string;
  url?: string;
  image?: UploadedProfileProjectImage;
  /** The *canonical* kind. The placement stores the nearest value its enum
   * can hold; `project.projects.type` keeps the real one. */
  type: ManualProjectType;
  subTypes?: ProfileProjectSubType[];
  /** Repo, live site, store page — everything that isn't the primary URL. */
  links?: { label: string; url: string }[];
}

/** Existing project values used to seed the dialog when it's
 * editing rather than creating. The dialog still surfaces the same
 * fields; the parent decides whether to call `onAdd` (create) or
 * `onSave` (update) based on which it passed. */
export interface ProjectInitial {
  title: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  type: ManualProjectType;
  subTypes: ProfileProjectSubType[];
  links: { label: string; url: string }[];
}

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onAdd: (input: AddProjectInput) => void;
  /** When set, the dialog opens in EDIT mode — title becomes "Edit
   * project", initial values seed the form, and the primary button
   * calls `onSave` instead of `onAdd`. */
  initial?: ProjectInitial;
  onSave?: (input: AddProjectInput) => void;
}

const dropzoneAccept = Object.fromEntries(
  PROFILE_PROJECT_IMAGE_ACCEPTED_MIME_TYPES.map((m) => [m, []]),
);

/**
 * Modal "add project" form, rebuilt against the new design's
 * primitives — opens directly into the editable fields (no
 * collapsed pre-step), uses `Input` / `Textarea` / `ToggleGroup` /
 * `Button` rather than the legacy editor's bespoke styles, and
 * resolves the legacy form's nested-`<button>` accessibility error
 * by making the cover-image dropzone a labelled `<div>` with an
 * adjacent delete button instead.
 */
export function AddProjectDialog({
  open,
  onOpenChange,
  onAdd,
  initial,
  onSave,
}: AddProjectDialogProps) {
  const isMobile = useIsMobile();
  const isEditing = initial != null;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<ManualProjectType>("game");
  const [subTypes, setSubTypes] = useState<ProfileProjectSubType[]>([]);
  const [links, setLinks] = useState<{ label: string; url: string }[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle(initial?.title ?? "");
    setDescription(initial?.description ?? "");
    setUrl(initial?.url ?? "");
    setType(initial?.type ?? "game");
    setSubTypes(initial?.subTypes ?? []);
    setLinks(initial?.links ?? []);
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    // Edit mode previews the *existing* image URL so users don't
    // think they have to re-upload to keep what's already there.
    setImagePreview(initial?.imageUrl ?? null);
    setSubmitting(false);
  };

  // Re-seed when the dialog opens with new initial data (i.e. the
  // user clicks edit on a different project) and when it closes.
  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    setTitle(initial?.title ?? "");
    setDescription(initial?.description ?? "");
    setUrl(initial?.url ?? "");
    setType(initial?.type ?? "game");
    setSubTypes(initial?.subTypes ?? []);
    setLinks(initial?.links ?? []);
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(initial?.imageUrl ?? null);
    // We deliberately don't depend on `imagePreview`; reset handles
    // its own URL.revokeObjectURL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const allowedSubTypes = getAllowedSubTypesForProjectType(type);

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const uploaded = imageFile ? await uploadImage(imageFile) : undefined;
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        url: url.trim() || undefined,
        image: uploaded,
        type,
        subTypes: subTypes.length > 0 ? subTypes : undefined,
        // Blank rows are how a half-typed link looks; they never ship.
        links: links.filter((link) => link.label.trim() && link.url.trim()),
      };
      if (isEditing && onSave) onSave(payload);
      else onAdd(payload);
    } catch (e) {
      reportMutationError(e, "profile.upload_project_image");
      toast.error(errorMessage(e, "Failed to upload image."));
    } finally {
      setSubmitting(false);
    }
  };

  // Body content shared between the desktop slideout and the mobile
  // dialog so we render exactly the same form regardless of where it
  // docks.
  const body = (
    <div className="flex flex-col gap-4 px-1 py-2">
      <CoverImageField
        file={imageFile}
        previewUrl={imagePreview}
        onSelect={(file) => {
          if (imagePreview) URL.revokeObjectURL(imagePreview);
          setImageFile(file);
          setImagePreview(file ? URL.createObjectURL(file) : null);
        }}
        onClear={() => {
          if (imagePreview) URL.revokeObjectURL(imagePreview);
          setImageFile(null);
          setImagePreview(null);
        }}
      />

      <FieldRow label="TITLE" required>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Project title"
          maxLength={120}
        />
      </FieldRow>

      <FieldRow label="TYPE">
        <ToggleGroup
          value={[type]}
          onValueChange={(v: string[]) => {
            const picked = v[0];
            if (!picked) return;
            const next = picked as ManualProjectType;
            setType(next);
            // Drop sub-types that don't apply to the new parent
            // type so we don't send `app/web` after switching to
            // `game`.
            const nextAllowed = getAllowedSubTypesForProjectType(next);
            setSubTypes((curr) => curr.filter((s) => nextAllowed.includes(s)));
          }}
          variant="outline"
          size="sm"
          className="flex-wrap [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md"
        >
          {MANUAL_PROJECT_TYPES.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="bg-card! px-3 text-[11px] tracking-widest uppercase"
            >
              {/* One label table for every surface — the same words the
                  project page's hero badge uses. */}
              {projectTypeLabel({ type: value })}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FieldRow>

      {allowedSubTypes.length > 0 ? (
        <FieldRow label="SUB-TYPE">
          <ToggleGroup
            multiple
            value={subTypes}
            onValueChange={(v) => setSubTypes(v as ProfileProjectSubType[])}
            variant="outline"
            size="sm"
            className="flex-wrap [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md"
          >
            {allowedSubTypes.map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="bg-card! px-3 text-[11px] tracking-widest uppercase"
              >
                {PROFILE_PROJECT_SUBTYPE_LABELS[value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldRow>
      ) : null}

      <FieldRow label="DESCRIPTION" hint="optional · short">
        <Textarea
          value={description}
          rows={3}
          maxLength={400}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is it?"
        />
      </FieldRow>

      <FieldRow label="URL" hint="the main link — what the CTA points at">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
      </FieldRow>

      <LinksField links={links} onChange={setLinks} />

      <div className="mt-1 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenChange(false)}
          className="tracking-widest"
        >
          CANCEL
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={!title.trim() || submitting}
          onClick={() => void handleSubmit()}
          className="tracking-widest"
        >
          {submitting ? "SAVING…" : isEditing ? "SAVE CHANGES" : "ADD PROJECT"}
        </Button>
      </div>
    </div>
  );

  // Desktop docks the form into a right-side `Sheet` slideout to
  // match the rest of the page's edit pattern (the profile flyout
  // uses the same edge); mobile keeps the centred `Dialog` so it
  // doesn't compete with the bottom-nav for screen real estate.
  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="tracking-widest uppercase">
              {isEditing ? "Edit project" : "Add project"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update any of the fields below — only what you change will be persisted."
                : "Drop a tool, game, or experiment. You can swap the cover image, type, and tags anytime after."}
            </DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[28rem] max-w-[100vw] overflow-y-auto sm:max-w-[28rem]"
      >
        <SheetHeader className="border-b border-muted/30 pb-4">
          <SheetTitle className="tracking-widest uppercase">
            {isEditing ? "Edit project" : "Add project"}
          </SheetTitle>
          <SheetDescription>
            {isEditing
              ? "Update any of the fields below — only what you change will be persisted."
              : "Drop a tool, game, or experiment. You can swap the cover image, type, and tags anytime after."}
          </SheetDescription>
        </SheetHeader>
        <div className="px-5 py-5">{body}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Cover-image dropzone. Uses `react-dropzone` for the drag/drop
 * affordance but exposes the picker on a `Button` rather than the
 * dropzone's default click target — that way the delete button can
 * sit alongside it without nesting `<button>` inside `<button>`.
 */
function CoverImageField({
  file,
  previewUrl,
  onSelect,
  onClear,
}: {
  file: File | null;
  previewUrl: string | null;
  onSelect: (file: File) => void;
  onClear: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  // `react-dropzone` exposes an `open()` callback that triggers the
  // hidden `<input>`'s file picker via its own internal ref — that's
  // the documented way to drive a "Choose file" button alongside the
  // drop target without manually wiring a separate ref. Trying to
  // attach our own ref to the `<input>` collided with the one
  // `getInputProps()` already sets, which is why the previous
  // implementation didn't open anything on click.
  const {
    getInputProps,
    getRootProps,
    isDragActive,
    open: openFilePicker,
  } = useDropzone({
    accept: dropzoneAccept,
    maxFiles: 1,
    maxSize: PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES,
    multiple: false,
    noClick: true,
    onDropAccepted: ([f]) => {
      if (!f) return;
      setError(null);
      onSelect(f);
    },
    onDropRejected: (rejections: FileRejection[]) => {
      const first = rejections[0]?.errors[0];
      setError(first?.message ?? "Invalid file");
    },
  });

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[11px] tracking-widest text-muted-foreground uppercase">COVER</Label>
      <Well
        {...getRootProps({
          className: cn(
            "relative flex min-h-32 items-center justify-center overflow-hidden p-3",
            isDragActive && "ring-2 ring-accent/40",
          ),
        })}
      >
        <input {...getInputProps()} />
        {file && previewUrl ? (
          <>
            <img
              src={previewUrl}
              alt="Project cover preview"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-background/40" />
            <div className="relative flex flex-col items-center gap-2">
              <Text size="xs" className="tracking-widest uppercase">
                {file.name}
              </Text>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={openFilePicker}
                  className="tracking-widest"
                >
                  Replace
                </Button>
                <Button variant="outline" size="xs" onClick={onClear} className="tracking-widest">
                  Remove
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <HugeiconsIcon icon={Image01Icon} size={20} />
            <Text size="xs" variant="muted" className="tracking-widest uppercase">
              {isDragActive ? "Drop the image" : "Drag an image or"}
            </Text>
            {!isDragActive ? (
              <Button
                variant="outline"
                size="xs"
                onClick={openFilePicker}
                className="tracking-widest"
              >
                <HugeiconsIcon icon={Add01Icon} size={12} />
                Choose file
              </Button>
            ) : null}
            {error ? (
              <Text size="xs" variant="danger" className="tracking-widest">
                {error}
              </Text>
            ) : null}
          </div>
        )}
      </Well>
    </div>
  );
}

const MAX_LINKS = 6;

/**
 * Secondary links — repo, live site, store page, registry.
 *
 * A website project wants a live URL *and* a repo; a library wants a repo and
 * a registry page. One `url` column could never say that, so the canonical
 * row carries a `{label, url}[]` rather than growing a column per provider —
 * a GitHub import later is a new source, not a new field here.
 */
function LinksField({
  links,
  onChange,
}: {
  links: { label: string; url: string }[];
  onChange: (next: { label: string; url: string }[]) => void;
}) {
  const update = (index: number, patch: Partial<{ label: string; url: string }>) => {
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  };

  return (
    <FieldRow label="MORE LINKS" hint="optional · repo, site, store">
      <div className="flex flex-col gap-2">
        {links.map((link, index) => (
          // Rows have no stable id until they're saved; they're only ever
          // appended or removed by index, so the index *is* the identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
          <div key={index} className="flex items-center gap-2">
            <Input
              value={link.label}
              maxLength={40}
              placeholder="REPO"
              className="w-28 shrink-0"
              aria-label={`Link ${index + 1} label`}
              onChange={(e) => update(index, { label: e.target.value })}
            />
            <Input
              type="url"
              value={link.url}
              placeholder="https://…"
              aria-label={`Link ${index + 1} URL`}
              onChange={(e) => update(index, { url: e.target.value })}
            />
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove link ${index + 1}`}
              title={`Remove link ${index + 1}`}
              onClick={() => onChange(links.filter((_, i) => i !== index))}
            >
              ✕
            </Button>
          </div>
        ))}
        {links.length < MAX_LINKS ? (
          <Button
            variant="outline"
            size="xs"
            className="self-start tracking-widest"
            onClick={() => onChange([...links, { label: "", url: "" }])}
          >
            <HugeiconsIcon icon={Add01Icon} size={12} />
            ADD LINK
          </Button>
        ) : null}
      </div>
    </FieldRow>
  );
}

function FieldRow({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[11px] tracking-widest text-muted-foreground uppercase">
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
        {hint ? (
          <Text size="xs" variant="muted" className="text-right tracking-wide">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function uploadImage(file: File): Promise<UploadedProfileProjectImage> {
  return postImageForm<UploadedProfileProjectImage>("/api/profile/project-image", file);
}
