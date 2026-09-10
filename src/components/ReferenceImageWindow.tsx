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
  importReferenceImage,
  REFERENCE_IMAGE_IMPORT_EVENT,
} from '../referenceImage';
import {
  clearReferenceImage,
  loadReferenceImage,
  saveReferenceImage,
} from '../engine/persistence/db';

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

  const close = () => {
    loadSequence.current++;
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = null;
    interaction.current = null;
    setReference(null);
    void clearReferenceImage();
  };

  useEffect(() => {
    const openFile = (event: Event) => {
      const file = (event as CustomEvent<File>).detail;
      if (!file?.type.startsWith('image/')) return;
      const sequence = ++loadSequence.current;
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        if (sequence !== loadSequence.current) {
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
          alert('画像を読み込めませんでした');
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
      loadSequence.current++;
      window.removeEventListener(REFERENCE_IMAGE_IMPORT_EVENT, openFile);
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    };
  }, [areaRef]);

  useEffect(() => {
    if (!reference) return;
    const { url: _url, ...saved } = reference;
    const persist = () => {
      void saveReferenceImage(saved);
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

  const transfer = () => {
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
      alert('転写するには、表示中のラスターレイヤーを選択してください');
      return;
    }
    close();
  };

  return (
    <>
      <div
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
      </div>
      <div className="reference-toolbar" data-canvas-ui="true">
        <span className="reference-name" title={reference.name}>
          {reference.name}
        </span>
        <label>
          <span>透明度</span>
          <input
            type="range"
            min="5"
            max="100"
            value={Math.round(reference.opacity * 100)}
            onChange={(event) =>
              setReference({
                ...reference,
                opacity: Number(event.target.value) / 100,
              })
            }
          />
          <span className="reference-percent">
            {Math.round(reference.opacity * 100)}%
          </span>
        </label>
        <button
          className={reference.locked ? 'toggled' : ''}
          onClick={() => setReference({ ...reference, locked: !reference.locked })}
          title="固定すると画像を貫通してキャンバスへ描けます"
        >
          {reference.locked ? '固定中' : '固定'}
        </button>
        <button
          onClick={() => setReference({ ...reference, rotation: 0 })}
          title="画像の回転を0度へ戻す"
        >
          回転リセット
        </button>
        <button className="primary" onClick={transfer}>
          転写
        </button>
        <button onClick={close}>閉じる</button>
      </div>
    </>
  );
}

export function handleReferenceImageDrop(event: DragEvent): boolean {
  const file = [...event.dataTransfer.files].find((item) =>
    item.type.startsWith('image/'),
  );
  return file ? importReferenceImage(file) : false;
}
