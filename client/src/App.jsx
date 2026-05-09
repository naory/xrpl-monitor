import { useEffect, useState } from 'react';
import { Box, AppBar, Toolbar, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { createSocketConnection } from './api/socket';
import { useWsStore } from './store/useWsStore';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Dashboard } from './components/Dashboard';

const WS_URL = import.meta.env.VITE_WS_URL
  ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

const MODES   = ['iou', 'mpt', 'amm', 'ledger', 'bridge'];
const WINDOWS = ['10m', '1h', '24h'];

export function App() {
  const [mode,   setMode]   = useState('iou');
  const [window, setWindow] = useState('1h');

  useEffect(() => {
    const disconnect = createSocketConnection(WS_URL, useWsStore.getState());
    return disconnect;
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          {/* Logo */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'linear-gradient(135deg, #00e5ff 0%, #7c4dff 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.75rem', fontWeight: 900, color: '#000',
            }}>
              X
            </Box>
            <Typography variant="h6" sx={{ fontSize: '0.95rem', letterSpacing: 2, fontWeight: 700 }}>
              XRPL MONITOR
            </Typography>
          </Box>

          {/* Mode tabs */}
          <ToggleButtonGroup value={mode} exclusive size="small"
            onChange={(_, v) => v && setMode(v)} sx={{ height: 26 }}>
            {MODES.map((m) => (
              <ToggleButton key={m} value={m} sx={{ fontSize: '0.65rem', px: 1.5, py: 0, letterSpacing: 0.5 }}>
                {m.toUpperCase()}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          {/* Window selector */}
          <ToggleButtonGroup value={window} exclusive size="small"
            onChange={(_, v) => v && setWindow(v)} sx={{ height: 26 }}>
            {WINDOWS.map((w) => (
              <ToggleButton key={w} value={w} sx={{ fontSize: '0.65rem', px: 1.2, py: 0 }}>
                {w}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Box sx={{ flex: 1 }} />
          <ConnectionStatus />
        </Toolbar>
      </AppBar>

      <Dashboard mode={mode} window={window} />
    </Box>
  );
}
