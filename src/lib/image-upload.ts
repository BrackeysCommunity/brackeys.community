/**
 * Client half of the image-upload endpoints in `src/routes/api.$.ts` — the
 * one place the multipart POST + error-body unwrapping lives, replacing the
 * four hand-rolled copies that used to sit next to each upload control.
 */

/** What every upload endpoint responds with on 201 (some return more). */
export interface UploadedImageRecord {
  key: string;
  url: string;
}

/**
 * POST `file` (plus any extra string fields) as multipart form data. On
 * failure the thrown `Error` carries the server's `{ message }` when there
 * is one, so `toastMutationError`/`errorMessage` surface it as-is.
 */
export async function postImageForm<T extends UploadedImageRecord = UploadedImageRecord>(
  path: string,
  file: File,
  fields?: Record<string, string>,
  fallbackMessage = "Upload failed.",
): Promise<T> {
  const formData = new FormData();
  formData.append("image", file);
  for (const [key, value] of Object.entries(fields ?? {})) {
    formData.append(key, value);
  }

  const response = await fetch(path, { method: "POST", body: formData });
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message ?? fallbackMessage);
  }
  return (await response.json()) as T;
}
