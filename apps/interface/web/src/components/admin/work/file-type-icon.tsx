import { FileIcon, defaultStyles, type DefaultExtensionType } from 'react-file-icon';

const MIME_EXTENSION: Record<string, DefaultExtensionType> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/rtf': 'rtf',
  'application/zip': 'zip',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/tiff': 'tif',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

function extensionOf(name: string, mimeType: string): DefaultExtensionType {
  const fromMime = MIME_EXTENSION[mimeType];
  if (fromMime) return fromMime;
  const fromName = name.split('.').pop()?.toLowerCase();
  if (fromName && fromName in defaultStyles) return fromName as DefaultExtensionType;
  if (mimeType.startsWith('image/')) return 'jpg';
  return 'txt';
}

/** Colored file-type glyph from `react-file-icon` (PDF red, image, office, …). */
export function FileTypeIcon({ name, mimeType }: { name: string; mimeType: string }) {
  const extension = extensionOf(name, mimeType);
  return (
    <span className="inline-block w-7 shrink-0" aria-hidden="true">
      <FileIcon extension={extension} {...defaultStyles[extension]} labelUppercase />
    </span>
  );
}
