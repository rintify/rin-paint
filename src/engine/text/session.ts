import { create } from 'zustand';
import type { TextStyle } from '../../types';
import { DEFAULT_TEXT_STYLE } from './model';

interface TextSession {
  id: string | null;
  start: number;
  end: number;
  typingStyle: TextStyle;
  composing: boolean;
  set: (value: Partial<Omit<TextSession, 'set'>>) => void;
}
export const useTextSession = create<TextSession>(set => ({ id: null, start: 0, end: 0, typingStyle: { ...DEFAULT_TEXT_STYLE }, composing: false, set }));

export function plainEditorText(root: Node): string {
  if (root.nodeType === Node.TEXT_NODE) return root.textContent ?? '';
  if (root instanceof HTMLElement && (root.tagName === 'RT' || root.dataset.placeholder)) return '';
  if (root instanceof HTMLBRElement) return '\n';
  let result = '';
  for (const child of root.childNodes) {
    const block = child instanceof HTMLElement && /^(DIV|P)$/.test(child.tagName);
    if (block && result && !result.endsWith('\n')) result += '\n';
    result += plainEditorText(child);
  }
  return result;
}
export function editorSelection(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = plainEditorText(prefix.cloneContents()).length;
  prefix.setEnd(range.endContainer, range.endOffset);
  return { start, end: plainEditorText(prefix.cloneContents()).length };
}
export function restoreEditorSelection(root: HTMLElement, start: number, end: number): void {
  const nodes: Text[] = [];
  const walk = (node: Node) => {
    if (node instanceof HTMLElement && node.tagName === 'RT') return;
    if (node.nodeType === Node.TEXT_NODE) nodes.push(node as Text);
    else node.childNodes.forEach(walk);
  };
  walk(root);
  const point = (offset: number): [Node, number] => {
    let remaining = offset;
    for (const node of nodes) { if (remaining <= node.length) return [node, remaining]; remaining -= node.length; }
    return nodes.length ? [nodes[nodes.length - 1], nodes[nodes.length - 1].length] : [root, 0];
  };
  const range = document.createRange();
  range.setStart(...point(start)); range.setEnd(...point(end));
  const selection = window.getSelection();
  selection?.removeAllRanges(); selection?.addRange(range);
}
