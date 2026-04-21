import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: '#00e5ff' },
    secondary:  { main: '#7c4dff' },
    success:    { main: '#00e676' },
    error:      { main: '#ff1744' },
    warning:    { main: '#ffab40' },
    background: { default: '#080d1a', paper: '#0f1729' },
    text:       { primary: '#e8eaf6', secondary: '#9fa8da' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", sans-serif',
    h6: { fontWeight: 700, letterSpacing: 0.5 },
    caption: { fontFamily: '"JetBrains Mono", monospace', fontSize: '0.72rem' },
    body2: { fontFamily: '"JetBrains Mono", monospace', fontSize: '0.78rem' },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(255,255,255,0.06)',
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected': { background: 'rgba(0,229,255,0.15)', color: '#00e5ff' },
        },
      },
    },
  },
});
