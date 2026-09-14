export const shortcutDefinitions = [
  { id: 'history.undo', category: '編集', label: '取り消し', defaultBinding: 'Mod+KeyZ' },
  { id: 'history.redo', category: '編集', label: 'やり直し', defaultBinding: 'Mod+Shift+KeyZ' },
  { id: 'history.redoAlternate', category: '編集', label: 'やり直し（別キー）', defaultBinding: 'Mod+KeyY' },
  { id: 'layers.copy', category: '編集', label: 'レイヤーをコピー', defaultBinding: 'Mod+KeyC' },
  { id: 'layers.paste', category: '編集', label: 'レイヤーをペースト', defaultBinding: 'Mod+KeyV' },
  { id: 'selection.rename', category: '選択', label: '選択中の名称を変更', defaultBinding: 'Mod+Enter' },
  { id: 'selection.delete', category: '選択', label: '選択中のレイヤー／ツールを削除・グループを解除', defaultBinding: 'Delete' },
  { id: 'view.reset', category: '表示', label: '表示位置をリセット', defaultBinding: 'Mod+Digit0' },
  { id: 'view.pan', category: '表示', label: 'ページを移動', defaultBinding: 'Space' },
  { id: 'tools.deselect', category: 'ツール', label: 'ツール選択を解除', defaultBinding: 'KeyF' },
  { id: 'operation.cancel', category: '操作', label: '現在の操作をキャンセル', defaultBinding: 'Escape' },
] as const;

export type ShortcutId = typeof shortcutDefinitions[number]['id'];
export type ShortcutBindings = Record<ShortcutId, string>;

export function defaultShortcutBindings(): ShortcutBindings {
  return Object.fromEntries(shortcutDefinitions.map(item => [item.id, item.defaultBinding])) as ShortcutBindings;
}

const ALIASES: Record<string, string> = {
  Backspace: 'Delete',
  NumpadEnter: 'Enter',
  ' ': 'Space',
};

function normalizedCode(code: string): string {
  return ALIASES[code] ?? code;
}

export function shortcutFromEvent(event: KeyboardEvent): string | null {
  const code = normalizedCode(event.code || event.key);
  if (['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight'].includes(code)) return null;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(code);
  return parts.join('+');
}

export function shortcutIdForEvent(event: KeyboardEvent, bindings: ShortcutBindings): ShortcutId | null {
  const chord = shortcutFromEvent(event);
  if (!chord) return null;
  return shortcutDefinitions.find(item => bindings[item.id] === chord)?.id ?? null;
}

export function shortcutLabel(binding: string): string {
  if (!binding) return '未割り当て';
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return binding.split('+').map(part => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (part === 'Shift') return mac ? '⇧' : 'Shift';
    if (part === 'Alt') return mac ? '⌥' : 'Alt';
    if (part === 'Delete') return mac ? '⌫' : 'Delete';
    if (part === 'Escape') return 'Esc';
    if (part === 'Space') return 'スペース';
    if (part === 'Enter') return '↩';
    const symbol = toolShortcutKeys.find(key => key.code === part);
    if (symbol) return symbol.label;
    return part.replace(/^Key/, '').replace(/^Digit/, '');
  }).join(mac ? '' : ' + ');
}

import type { LoadResult } from './engine/schema';

export function loadShortcutBindings(value: unknown): LoadResult<ShortcutBindings> {
  if (value === undefined) return { status: 'ok', value: defaultShortcutBindings() };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'invalid', reason: 'ショートカット設定が不正です', raw: value };
  }
  const raw = value as Record<string, unknown>;
  const result = defaultShortcutBindings();
  const assigned = new Set<string>();
  for (const item of shortcutDefinitions) {
    if (!Object.prototype.hasOwnProperty.call(raw, item.id)) continue;
    const binding = raw[item.id];
    if (typeof binding !== 'string' || binding.length > 80 || !validBinding(binding)) {
      return { status: 'invalid', reason: 'ショートカット設定が不正です', raw: value };
    }
    result[item.id] = binding;
    if (binding) assigned.add(binding);
  }
  for (const item of shortcutDefinitions) {
    if (Object.prototype.hasOwnProperty.call(raw, item.id)) continue;
    result[item.id] = assigned.has(item.defaultBinding) ? '' : item.defaultBinding;
    if (result[item.id]) assigned.add(result[item.id]);
  }
  const knownAssigned = Object.values(result).filter(Boolean);
  if (new Set(knownAssigned).size !== knownAssigned.length) {
    return { status: 'invalid', reason: 'ショートカットの割り当てが重複しています', raw: value };
  }
  return { status: 'ok', value: result };
}

export function validateShortcutBindings(value: unknown): ShortcutBindings {
  const loaded = loadShortcutBindings(value);
  if (loaded.status !== 'ok') throw new Error(loaded.reason);
  return loaded.value;
}

function validBinding(binding: string): boolean {
  if (!binding) return true;
  const parts = binding.split('+');
  const code = parts.pop()!;
  const modifiers = parts;
  if (new Set(modifiers).size !== modifiers.length || modifiers.some(value => !['Mod', 'Alt', 'Shift'].includes(value))) return false;
  if (modifiers.join('+') !== ['Mod', 'Alt', 'Shift'].filter(value => modifiers.includes(value)).join('+')) return false;
  return /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Enter|Delete|Escape|Space|Tab|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen)$/.test(code);
}

// Physical key codes share the application's chord format, leaving modifiers extensible.
export const toolShortcutKeys = [
  ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter => ({ code: `Key${letter}`, label: letter })),
  ...Array.from('0123456789', digit => ({ code: `Digit${digit}`, label: digit })),
  ...Object.entries({
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    IntlBackslash: '追加のバックスラッシュ', IntlRo: 'ろ / _', IntlYen: '¥',
  }).map(([code, label]) => ({ code, label })),
];

export function isToolShortcut(binding: unknown): binding is string {
  return typeof binding === 'string' && (binding === '' || toolShortcutKeys.some(key => key.code === binding));
}

export function toolShortcutConflicts(
  tools: readonly { id: string; name: string; shortcut?: string }[],
  shortcuts: ShortcutBindings,
  toolId: string,
  binding: string,
): string[] {
  if (!binding) return [];
  return [
    ...tools.filter(tool => tool.id !== toolId && tool.shortcut === binding).map(tool => tool.name),
    ...shortcutDefinitions.filter(item => shortcuts[item.id] === binding).map(item => item.label),
  ];
}
