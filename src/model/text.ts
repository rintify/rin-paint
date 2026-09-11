export interface TextStyle {
  fontId: string;
  color: string;
  sizePt: number;
}

export interface TextRange extends TextStyle {
  start: number;
  end: number;
}

export interface RubyRange {
  start: number;
  end: number;
  text: string;
}

export interface TextParams {
  content: string;
  style: TextStyle;
  ranges: TextRange[];
  ruby: RubyRange[];
  direction: 'horizontal' | 'vertical';
  lineHeight: number;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  /** 文字枠の中心基準の回転角（ラジアン） */
  rotation?: number;
}

export interface ProjectFont {
  id: string;
  name: string;
  dataUrl: string;
}
