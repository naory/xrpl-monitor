import { useEffect } from 'react';
import { Box, AppBar, Toolbar, Typography } from '@mui/material';
import { createSocketConnection } from './api/socket';
import { useWsStore } from './store/useWsStore';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Dashboard } from './components/Dashboard';

const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}`;

export function App() {
  useEffect(() => {
    // useWsStore.getState() gives stable action refs — safe to call inside effect
    const disconnect = createSocketConnection(WS_URL, useWsStore.getState());
    return disconnect;
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'linear-gradient(135deg, #00e5ff 0%, #7c4dff 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: 900, color: '#000',
              }}
            >
              X
            </Box>
            <Typography variant="h6" sx={{ fontSize: '0.95rem', letterSpacing: 2, fontWeight: 700 }}>
              XRPL MONITOR
            </Typography>
          </Box>

          <Box sx={{ flex: 1 }} />

          <ConnectionStatus />
        </Toolbar>
      </AppBar>

      <Dashboard />
    </Box>
  );
}
