import { alpha, Box, Card, Stack, Switch, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export function FieldStack({ children }: { children: ReactNode }) {
  return <Stack spacing={1.5}>{children}</Stack>;
}

export function LabeledControl({
  label,
  color = 'text.secondary',
  children,
}: {
  label: string;
  color?: 'text.primary' | 'text.secondary' | 'secondary' | 'warning' | 'warning.main';
  children: ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0, width: '100%' }}>
      <Typography variant="caption" color={color} sx={{ width: 80, flex: 'none', lineHeight: 1.3 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}

/** Boolean settings share the inspector's label column and compact control spacing. */
export function ToggleControl({
  label,
  ariaLabel = label,
  checked,
  onChange,
}: {
  label: string;
  ariaLabel?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <Stack
      component="label"
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'center',
        minWidth: 0,
        width: '100%',
        minHeight: 32,
        cursor: 'pointer',
      }}
    >
      <Typography
        variant="caption"
        color="text.primary"
        sx={{ width: 80, flex: 'none', lineHeight: 1.3 }}
      >
        {label}
      </Typography>
      <Switch
        size="small"
        checked={checked}
        onChange={(_, value) => onChange(value)}
        slotProps={{ input: { 'aria-label': ariaLabel } }}
      />
    </Stack>
  );
}

export function InfoCard({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'link' | 'warning';
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        p: 1.5,
        bgcolor: theme => (
          tone === 'link' ? alpha(theme.palette.secondary.main, 0.1)
            : tone === 'warning' ? alpha(theme.palette.warning.main, 0.1)
              : 'var(--field)'
        ),
        borderColor: tone === 'link' ? 'secondary.main' : tone === 'warning' ? 'warning.main' : 'divider',
      }}
    >
      <Stack spacing={1}>{children}</Stack>
    </Card>
  );
}
