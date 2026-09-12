import { Box, ButtonBase } from '@mui/material';
import { TRANSPARENT } from '../model';
import { useStore } from '../state/store';

function Swatch({
  color,
  selected,
  disabled,
  onSelect,
}: {
  color: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (color: string) => void;
}) {
  const transparent = color === TRANSPARENT;
  return (
    <ButtonBase
      title={transparent ? '透明' : color}
      disabled={disabled}
      onClick={() => onSelect(color)}
      className={transparent ? 'checker' : undefined}
      aria-label={transparent ? '透明' : color}
      sx={{
        aspectRatio: '1',
        borderRadius: 0.75,
        border: '1px solid rgba(255,255,255,0.18)',
        bgcolor: transparent ? undefined : color,
        outline: selected ? '2px solid' : 'none',
        outlineColor: 'primary.main',
        outlineOffset: 1,
      }}
    />
  );
}

export function ColorHistoryGrid({
  value,
  onSelect,
  disabled = false,
  allowTransparent = false,
}: {
  value: string | null;
  onSelect: (color: string) => void;
  disabled?: boolean;
  allowTransparent?: boolean;
}) {
  const colorHistory = useStore(s => s.colorHistory);
  const colors = allowTransparent ? [TRANSPARENT, ...colorHistory] : colorHistory;
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 1fr)',
        gap: 0.625,
      }}
    >
      {colors.map(color => (
        <Swatch
          key={color}
          color={color}
          selected={color === value}
          disabled={disabled}
          onSelect={onSelect}
        />
      ))}
    </Box>
  );
}
