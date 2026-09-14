import { ProjectRepository, documentKey } from './ProjectRepository';
import type { DocumentKey, LayerDocument } from './types';

export interface DocumentPatch {
  /** Only authored state of the edited document belongs in its history. */
  before: LayerDocument;
  after: LayerDocument;
}
export interface CommandNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  label: string;
  patch: DocumentPatch | null;
}
export interface DocumentHistory { currentId: string; nodes: Record<string, CommandNode> }
function initialHistory(): DocumentHistory {
  return {currentId:'root',nodes:{root:{id:'root',parentId:null,childIds:[],label:'初期状態',patch:null}}};
}

/** One branching history per document. Cross-document resolved values are never captured. */
export class CommandService {
  private readonly histories = new Map<string, DocumentHistory>();
  constructor(private readonly repository: ProjectRepository) {}
  history(key: DocumentKey): DocumentHistory {
    const id = documentKey(key);
    let history = this.histories.get(id);
    if (!history) { history = initialHistory(); this.histories.set(id, history); }
    return structuredClone(history);
  }

  execute(key: DocumentKey, label: string, edit: (draft: LayerDocument) => void): boolean {
    const source = this.repository.document(key);
    if (!source) throw new Error('編集対象が存在しません');
    const before = structuredClone(source), after = structuredClone(before);
    edit(after);
    if (documentKey(after.key) !== documentKey(key)) throw new Error('編集対象は変更できません');
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this.publish(key, after);
    const history = this.history(key), id = crypto.randomUUID();
    history.nodes[id] = {id,parentId:history.currentId,childIds:[],label,patch:{before,after}};
    history.nodes[history.currentId].childIds.push(id);
    history.currentId = id;
    this.histories.set(documentKey(key),history);
    return true;
  }

  undo(key: DocumentKey): boolean {
    const history = this.history(key), current = history.nodes[history.currentId];
    if (!current.patch || current.parentId === null) return false;
    this.publish(key,current.patch.before);
    history.currentId = current.parentId;
    this.histories.set(documentKey(key),history); return true;
  }

  redo(key: DocumentKey, branchId?: string): boolean {
    const history = this.history(key), current = history.nodes[history.currentId];
    const nextId = branchId ?? current.childIds.at(-1);
    if (!nextId || !current.childIds.includes(nextId)) return false;
    const next = history.nodes[nextId];
    if (!next.patch) throw new Error('履歴が破損しています');
    this.publish(key,next.patch.after);
    history.currentId = nextId;
    this.histories.set(documentKey(key),history); return true;
  }

  private publish(key: DocumentKey, document: LayerDocument): void {
    const id = documentKey(key);
    this.repository.replace(this.repository.snapshot().map(current => documentKey(current.key) === id ? document : current));
  }
}
