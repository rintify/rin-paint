import {
  Box,
  Button,
  Paper,
  Slider,
  Stack,
  Typography,
} from '@mui/material';
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { engine } from '../engine/PaintEngine';
import {
  clearReferenceImage,
  loadReferenceImage,
  saveReferenceImage,
  referenceEpoch,
} from '../engine/persistence/db';
import {
  importReferenceImage,
  REFERENCE_IMAGE_IMPORT_EVENT,
} from '../referenceImage';
import { appAlert } from './AppDialogs';

interface ReferenceImageState {
  blob: Blob;
  url: string;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  width: number;
  rotation: number;
  opacity: number;
  locked: boolean;
}

type Interaction =
  | {
      kind: 'move';
      pointerId: number;
      clientX: number;
      clientY: number;
      x: number;
      y: number;
    }
  | {
      kind: 'resize';
      pointerId: number;
      centerX: number;
      centerY: number;
      rotation: number;
    }
  | {
      kind: 'rotate';
      pointerId: number;
      centerX: number;
      centerY: number;
      offset: number;
    };

function rotatedPoint(
  centerX: number,
  centerY: number,
  x: number,
  y: number,
  rotation: number,
): { x: number; y: number } {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: centerX + x * cos - y * sin,
    y: centerY + x * sin + y * cos,
  };
}

export function ReferenceImageWindow({
  areaRef,
}: {
  areaRef: RefObject<HTMLDivElement | null>;
}) {
  const [reference, setReference] = useState<ReferenceImageState | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const currentUrl = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const generation = useRef(referenceEpoch());

  const close = () => {
    loadSequence.current++;
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = null;
    interaction.current = null;
    setReference(null);
    void clearReferenceImage();
  };

  useEffect(() => {
    const reset = () => {
      generation.current = referenceEpoch();
      loadSequence.current++;
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = null;
      interaction.current = null;
      setReference(null);
      const sequence = loadSequence.current;
      void loadReferenceImage().then(saved => {
        if (!saved || sequence !== loadSequence.current) return;
        const url = URL.createObjectURL(saved.blob);
        currentUrl.current = url;
        setReference({ ...saved, url });
      }).catch(() => undefined);
    };
    window.addEventListener('rinpaint:project-reset', reset);
    const openFile = (event: Event) => {
      const file = (event as CustomEvent<File>).detail;
      if (!file?.type.startsWith('image/')) return;
      const sequence = ++loadSequence.current;
      const epoch = referenceEpoch();
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        if (sequence !== loadSequence.current || epoch !== referenceEpoch()) {
          URL.revokeObjectURL(url);
          return;
        }
        const area = areaRef.current;
        if (!area) {
          URL.revokeObjectURL(url);
          return;
        }
        if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = url;
        const maxW = Math.max(160, Math.min(420, area.clientWidth * 0.55));
        const maxH = Math.max(120, area.clientHeight * 0.55);
        const scale = Math.min(
          maxW / image.naturalWidth,
          maxH / image.naturalHeight,
        );
        setReference({
          blob: file,
          url,
          name: file.name,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          x: area.clientWidth / 2,
          y: area.clientHeight / 2,
          width: Math.max(80, image.naturalWidth * scale),
          rotation: 0,
          opacity: 0.7,
          locked: false,
        });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        if (sequence === loadSequence.current) {
          void appAlert('画像を読み込めませんでした');
        }
      };
      image.src = url;
    };
    window.addEventListener(REFERENCE_IMAGE_IMPORT_EVENT, openFile);
    const restoreSequence = ++loadSequence.current;
    void loadReferenceImage()
      .then((saved) => {
        if (!saved || restoreSequence !== loadSequence.current) return;
        const url = URL.createObjectURL(saved.blob);
        currentUrl.current = url;
        setReference({ ...saved, url });
      })
      .catch(() => {
        // 参照画像だけが読めない場合もキャンバス操作は続けられる。
      });
    return () => {
      window.removeEventListener('rinpaint:project-reset', reset);
      loadSequence.current++;
      window.removeEventListener(REFERENCE_IMAGE_IMPORT_EVENT, openFile);
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    };
  }, [areaRef]);

  useEffect(() => {
    if (!reference) return;
    const epoch = generation.current;
    const { url: _url, ...saved } = reference;
    const persist = () => {
      void saveReferenceImage(saved, epoch);
    };
    const timer = setTimeout(persist, 120);
    window.addEventListener('pagehide', persist);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', persist);
    };
  }, [reference]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = interaction.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.kind === 'move') {
        setReference((current) =>
          current
            ? {
                ...current,
                x: drag.x + event.clientX - drag.clientX,
                y: drag.y + event.clientY - drag.clientY,
              }
            : current,
        );
      } else if (drag.kind === 'resize') {
        const dx = event.clientX - drag.centerX;
        const dy = event.clientY - drag.centerY;
        const localX =
          dx * Math.cos(drag.rotation) + dy * Math.sin(drag.rotation);
        setReference((current) =>
          current
            ? {
                ...current,
                width: Math.max(
                  80,
                  Math.min(
                    Math.max(
                      areaRef.current?.clientWidth ?? 800,
                      areaRef.current?.clientHeight ?? 600,
                    ) * 2,
                    Math.abs(localX) * 2,
                  ),
                ),
              }
            : current,
        );
      } else {
        const angle = Math.atan2(
          event.clientY - drag.centerY,
          event.clientX - drag.centerX,
        );
        setReference((current) =>
          current ? { ...current, rotation: angle + drag.offset } : current,
        );
      }
      event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      if (interaction.current?.pointerId === event.pointerId) {
        interaction.current = null;
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [areaRef]);

  if (!reference) return null;
  const height =
    reference.width * (reference.naturalHeight / reference.naturalWidth);

  const beginMove = (event: ReactPointerEvent) => {
    if (reference.locked || event.button !== 0) return;
    interaction.current = {
      kind: 'move',
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: reference.x,
      y: reference.y,
    };
    event.preventDefault();
  };

  const beginResize = (event: ReactPointerEvent) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return;
    interaction.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      centerX: rect.left + reference.x,
      centerY: rect.top + reference.y,
      rotation: reference.rotation,
    };
    event.stopPropagation();
    event.preventDefault();
  };

  const beginRotate = (event: ReactPointerEvent) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + reference.x;
    const centerY = rect.top + reference.y;
    const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    interaction.current = {
      kind: 'rotate',
      pointerId: event.pointerId,
      centerX,
      centerY,
      offset: reference.rotation - angle,
    };
    event.stopPropagation();
    event.preventDefault();
  };

  const transfer = async () => {
    const areaRect = areaRef.current?.getBoundingClientRect();
    const image = imageRef.current;
    if (!areaRect || !image) return;
    const centerX = areaRect.left + reference.x;
    const centerY = areaRect.top + reference.y;
    const hw = reference.width / 2;
    const hh = height / 2;
    const ok = engine.transferReferenceImage(
      image,
      reference.naturalWidth,
      reference.naturalHeight,
      {
        topLeft: rotatedPoint(centerX, centerY, -hw, -hh, reference.rotation),
        topRight: rotatedPoint(centerX, centerY, hw, -hh, reference.rotation),
        bottomLeft: rotatedPoint(centerX, centerY, -hw, hh, reference.rotation),
        bottomRight: rotatedPoint(centerX, centerY, hw, hh, reference.rotation),
      },
      reference.opacity,
    );
    if (!ok) {
      await appAlert('転写するには、表示中のラスターレイヤーを選択してください');
      return;
    }
    close();
  };

  return (
    <>
      <Box
        className={`reference-image-window${reference.locked ? ' locked' : ''}`}
        data-canvas-ui={reference.locked ? undefined : 'true'}
        style={{
          left: reference.x,
          top: reference.y,
          width: reference.width,
          height,
          transform: `translate(-50%, -50%) rotate(${reference.rotation}rad)`,
          opacity: reference.opacity,
        }}
        onPointerDown={beginMove}
      >
        <img
          ref={imageRef}
          src={reference.url}
          alt={reference.name}
          draggable={false}
        />
        {!reference.locked && (
          <>
            <button
              className="reference-rotate-handle"
              title="ドラッグして回転"
              onPointerDown={beginRotate}
            />
            <button
              className="reference-resize-handle"
              title="ドラッグして拡大・縮小"
              onPointerDown={beginResize}
            />
          </>
        )}
      </Box>
      <Paper
        className="reference-toolbar"
        data-canvas-ui="true"
        elevation={6}
        sx={{
          position: 'absolute',
          zIndex: 12,
          left: '50%',
          bottom: 18,
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          maxWidth: 'calc(100% - 28px)',
          p: 1,
          borderRadius: 1.5,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          whiteSpace: 'nowrap',
        }}
      >
        <Typography
          variant="body2"
          title={reference.name}
          noWrap
          sx={{ maxWidth: 130 }}
        >
          {reference.name}
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            透明度
          </Typography>
          <Slider
            min={5}
            max={100}
            value={Math.round(reference.opacity * 100)}
            onChange={(_, v) =>
              setReference({
                ...reference,
                opacity: (v as number) / 100,
              })
            }
            sx={{ width: 112 }}
          />
          <Typography
            variant="caption"
            sx={{ width: 34, fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(reference.opacity * 100)}%
          </Typography>
        </Stack>
        <Button
          variant={reference.locked ? 'contained' : 'outlined'}
          onClick={() => setReference({ ...reference, locked: !reference.locked })}
          title="固定すると画像を貫通してキャンバスへ描けます"
        >
          {reference.locked ? '固定中' : '固定'}
        </Button>
        <Button
          onClick={() => setReference({ ...reference, rotation: 0 })}
          title="画像の回転を0度へ戻す"
        >
          回転リセット
        </Button>
        <Button variant="contained" onClick={() => void transfer()}>
          転写
        </Button>
        <Button onClick={close}>閉じる</Button>
      </Paper>
    </>
  );
}

export function handleReferenceImageDrop(event: DragEvent): boolean {
  const file = [...event.dataTransfer.files].find((item) =>
    item.type.startsWith('image/'),
  );
  return file ? importReferenceImage(file) : false;
}
