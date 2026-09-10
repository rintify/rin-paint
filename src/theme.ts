import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#4f8cff' },
    error: { main: '#e46a6a' },
    background: {
      default: '#17191d',
      paper: '#22252b',
    },
    text: {
      primary: '#e8eaee',
      secondary: '#9aa1ad',
    },
    divider: '#383d47',
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
        body: {
          overscrollBehavior: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        },
      },
    },
    MuiButton: {
      defaultProps: { size: 'small', disableElevation: true },
      styleOverrides: {
        root: {
          minWidth: 0,
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
