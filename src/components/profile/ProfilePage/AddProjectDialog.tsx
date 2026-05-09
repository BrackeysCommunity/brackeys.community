import { Add01Icon, Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { type FileRejection, useDropzone } from "react-dropzone";
import { toast } from "sonner";

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
import { useIsTouchDevice } from "@/hooks/use-touch-device";
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
} from "@/lib/profile-projects";
import { cn } from "@/lib/utils";

interface AddProjectInput {
  title: string;
  description?: string;
  url?: string;
  image?: UploadedProfileProjectImage;
  type: ManualProfileProjectType;
  subTypes?: ProfileProjectSubType[];
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
  type: ManualProfileProjectType;
  subTypes: ProfileProjectSubType[];
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
  const isTouch = useIsTouchDevice();
  const isEditing = initial != null;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<ManualProfileProjectType>("game");
  const [subTypes, setSubTypes] = useState<ProfileProjectSubType[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle(initial?.title ?? "");
    setDescription(initial?.description ?? "");
    setUrl(initial?.url ?? "");
    setType(initial?.type ?? "game");
    setSubTypes(initial?.subTypes ?? []);
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
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(initial?.imageUrl ?? null);
    // We deliberately don't depend on `imagePreview`; reset handles
    // its own URL.revokeObjectURL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const allowedSubTypes = getAllowedProfileProjectSubTypes(type);

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
      };
      if (isEditing && onSave) onSave(payload);
      else onAdd(payload);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload image.");
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
            const next = picked as ManualProfileProjectType;
            setType(next);
            // Drop sub-types that don't apply to the new parent
            // type so we don't send `app/web` after switching to
            // `game`.
            const nextAllowed = getAllowedProfileProjectSubTypes(next);
            setSubTypes((curr) => curr.filter((s) => nextAllowed.includes(s)));
          }}
          variant="outline"
          size="sm"
          className="flex-wrap [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md"
        >
          {MANUAL_PROFILE_PROJECT_TYPES.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="bg-card! px-3 font-mono text-[11px] tracking-widest uppercase"
            >
              {PROFILE_PROJECT_TYPE_LABELS[value]}
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
                className="bg-card! px-3 font-mono text-[11px] tracking-widest uppercase"
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

      <FieldRow label="URL" hint="itch.io / GitHub / your site">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
      </FieldRow>

      <div className="mt-1 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenChange(false)}
          className="font-mono tracking-widest"
        >
          CANCEL
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={!title.trim() || submitting}
          onClick={() => void handleSubmit()}
          className="font-mono tracking-widest"
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
  if (isTouch) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono tracking-widest uppercase">
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
          <SheetTitle className="font-mono tracking-widest uppercase">
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
      <Label className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
        COVER
      </Label>
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
              <Text monospace size="xs" className="tracking-widest uppercase">
                {file.name}
              </Text>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={openFilePicker}
                  className="font-mono tracking-widest"
                >
                  Replace
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={onClear}
                  className="font-mono tracking-widest"
                >
                  Remove
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <HugeiconsIcon icon={Image01Icon} size={20} />
            <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
              {isDragActive ? "Drop the image" : "Drag an image or"}
            </Text>
            {!isDragActive ? (
              <Button
                variant="outline"
                size="xs"
                onClick={openFilePicker}
                className="font-mono tracking-widest"
              >
                <HugeiconsIcon icon={Add01Icon} size={12} />
                Choose file
              </Button>
            ) : null}
            {error ? (
              <Text monospace size="xs" variant="danger" className="tracking-widest">
                {error}
              </Text>
            ) : null}
          </div>
        )}
      </Well>
    </div>
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
        <Label className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
        {hint ? (
          <Text monospace size="xs" variant="muted" className="text-right tracking-wide">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}

async function uploadImage(file: File): Promise<UploadedProfileProjectImage> {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch("/api/profile/project-image", { method: "POST", body: fd });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message ?? "Upload failed.");
  }
  return (await res.json()) as UploadedProfileProjectImage;
}
