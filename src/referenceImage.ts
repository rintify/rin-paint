export const REFERENCE_IMAGE_IMPORT_EVENT = 'rinpaint:reference-image-import';

export function importReferenceImage(file: File): boolean {
  if (!file.type.startsWith('image/')) return false;
  window.dispatchEvent(
    new CustomEvent<File>(REFERENCE_IMAGE_IMPORT_EVENT, { detail: file }),
  );
  return true;
}
