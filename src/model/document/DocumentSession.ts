import { documentKey } from './ProjectRepository';
import type { DocumentKey, EditTarget, OccurrenceId } from './types';

export interface DocumentView {
  scopeId: string;
  selectedIds: OccurrenceId[];
  zoom: number;
  pan: {x:number;y:number};
  workRectMm: {w:number;h:number};
}
export interface SessionSnapshot {
  target: EditTarget | null;
  views: Record<string, DocumentView>;
  returnPage: DocumentKey | null;
}

/** View state belongs to the editor; bin assets never store page addresses. */
export class DocumentSession {
  private state: SessionSnapshot = {target:null,views:{},returnPage:null};
  snapshot(): SessionSnapshot { return structuredClone(this.state); }
  restore(snapshot: SessionSnapshot): void { this.state = structuredClone(snapshot); }
  open(document: DocumentKey, initial: DocumentView): void {
    const key = documentKey(document);
    this.state.views[key] ??= structuredClone(initial);
    this.state.target = {document,scope:{document,scopeId:this.state.views[key].scopeId}};
    if (document.kind === 'page') this.state.returnPage = document;
  }
  select(scopeId: string, ids: OccurrenceId[]): void {
    const target = this.state.target;
    if (!target) return;
    target.scope = {document:target.document,scopeId};
    const view = this.state.views[documentKey(target.document)];
    view.scopeId = scopeId;
    view.selectedIds = [...new Set(ids)];
  }
  updateView(patch: Partial<Omit<DocumentView,'scopeId'|'selectedIds'>>): void {
    if (!this.state.target) return;
    Object.assign(this.state.views[documentKey(this.state.target.document)],structuredClone(patch));
  }
  returnToPage(): boolean {
    const page = this.state.returnPage;
    if (!page) return false;
    this.open(page,this.state.views[documentKey(page)]); return true;
  }
}
