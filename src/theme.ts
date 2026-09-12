import { createTheme } from '@mui/material/styles';

/** Shared surfaces: CSS variables in styles.css must stay in sync. */
const surface = {
  canvas: '#12141a',
  panel: '#1b1e25',
  raised: '#252a33',
  field: '#15171c',
  border: '#343a44',
} as const;

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#4f8cff' },
    error: { main: '#e46a6a' },
    background: {
      default: surface.canvas,
      paper: surface.panel,
    },
    text: {
      primary: '#e8eaee',
      secondary: '#a0a7b4',
    },
    divider: surface.border,
  },
  typography: {
    fontFamily: `'Hiragino Sans', 'Yu Gothic UI', system-ui, sans-serif`,
    fontSize: 13,
    button: {
      textTransform: 'none',
      fontWeight: 500,
    },
  },
  shape: { borderRadius: 6 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        'html, body, #root': {
          height: '100%',
          margin: 0,
        },
        html: {
          colorScheme: 'dark',
        },
        body: {
          overscrollBehavior: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        },
      },
    },
    MuiButton: {
      defaultProps: { size: 'small', disableElevation: true, variant: 'outlined' },
      styleOverrides: {
        root: {
          minWidth: 0,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: surface.field,
        },
      },
    },
    MuiIconButton: {
      defaultProps: { size: 'small' },
    },
    MuiDialog: {
      defaultProps: {
        slotProps: { paper: { elevation: 8 } },
      },
      styleOverrides: {
        paper: {
          '& .MuiDialogTitle-root + .MuiDialogContent-root': {
            paddingTop: 16,
          },
        },
      },
    },
    MuiMenu: {
      defaultProps: {
        slotProps: { paper: { elevation: 8 } },
      },
    },
    MuiSlider: {
      defaultProps: { size: 'small' },
    },
    MuiTextField: {
      defaultProps: { size: 'small', variant: 'outlined' },
    },
    MuiSelect: {
      defaultProps: { size: 'small' },
    },
    MuiTooltip: {
      defaultProps: { enterDelay: 400 },
    },
  },
});
