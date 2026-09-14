export const LAYER_KIND_IDS = {
  raster: 'rin.layer.raster',
  adjust: 'rin.layer.adjust',
  outline: 'rin.layer.outline',
  clip: 'rin.layer.clip',
  transform: 'rin.layer.transform',
  shape: 'rin.layer.shape',
  text: 'rin.layer.text',
  image: 'rin.layer.image',
} as const;

export type BuiltinLayerKind = keyof typeof LAYER_KIND_IDS;

export const LAYER_KIND_BY_ID: Record<string, BuiltinLayerKind> = Object.fromEntries(
  Object.entries(LAYER_KIND_IDS).map(([type, kindId]) => [kindId, type]),
) as Record<string, BuiltinLayerKind>;

export const TOOL_KIND_IDS = {
  cursor: 'rin.tool.cursor',
  pen: 'rin.tool.pen',
  line: 'rin.tool.line',
  rect: 'rin.tool.rect',
  ellipse: 'rin.tool.ellipse',
  polygon: 'rin.tool.polygon',
  panelFrame: 'rin.tool.panel-frame',
  speechBubble: 'rin.tool.speech-bubble',
  fill: 'rin.tool.fill',
  eyedropper: 'rin.tool.eyedropper',
  polygonSplit: 'rin.tool.polygon-split',
  lasso: 'rin.tool.lasso',
  move: 'rin.tool.move',
  blur: 'rin.tool.blur',
  text: 'rin.tool.text',
  image: 'rin.tool.image',
} as const;

export const SETTINGS_NAMESPACE_IDS = {
  tools: 'rin.settings.tools',
  colors: 'rin.settings.colors',
  view: 'rin.settings.view',
  shortcuts: 'rin.settings.shortcuts',
} as const;
