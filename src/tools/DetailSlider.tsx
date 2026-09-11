import { Box, Slider, Typography } from '@mui/material';

export function DetailSlider({
  label,
  value,
  onChange,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '92px minmax(120px, 1fr) 32px',
        alignItems: 'center',
        gap: 1.25,
        mb: 1,
      }}
    >
      <Typography variant="body2">{label}</Typography>
      <Slider
        min={0}
        max={max}
        value={value}
        onChange={(_, v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
    </Box>
  );
}
