import { engine } from './engine/instance';

export function importReferenceImage(file: File): boolean {
  if (!file.type.startsWith('image/')) return false;
  engine.events.emit('referenceImageImport', file);
  return true;
}
