/**
 * Saves a blob to the visitor's disk through a temporary `<a download>`.
 * The object URL is revoked a second later, since some browsers start the
 * download after the click's tick.
 */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
