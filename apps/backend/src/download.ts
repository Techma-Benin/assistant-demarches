import type { Schemas } from "./domain.js";

const extensions: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

/**
 * Content-Disposition of an issued case document. The Interface proxy forwards this header and the browser
 * names the saved file from it; without it the file would be saved under the opaque document id.
 */
export function documentDisposition(
  documents: Schemas["Case"]["documents"] | undefined,
  documentId: string,
  mimeType: string,
): string {
  const named = documents?.find((document) => document.id === documentId)?.name;
  const base = (named ?? "document").replace(/[\u0000-\u001f\u007f/\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "document";
  const extension = extensions[mimeType.split(";")[0]!.trim().toLowerCase()] ?? "";
  const name = extension && !base.toLowerCase().endsWith(extension) ? base + extension : base;
  const ascii = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase())}`;
}
