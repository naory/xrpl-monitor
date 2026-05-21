import { useEffect, useRef, useState } from 'react';
import { Box, AppBar, Toolbar, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { Select, MenuItem, Snackbar, Alert } from '@mui/material';
import { createSocketConnection } from './api/socket';
import { useWsStore } from './store/useWsStore';
import { fetchCurrentNetwork, switchNetwork as switchNetworkApi } from './api/http';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Dashboard } from './components/Dashboard';

const WS_URL = import.meta.env.VITE_WS_URL
  ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

const MODES       = ['iou', 'mpt', 'amm', 'ledger', 'xrp-flow', 'escrow-time', 'escrow-ilp'];
const MODE_LABELS = {
  'xrp-flow':    'XRP FLOW',
  'escrow-time': 'ESCROW TIME',
  'escrow-ilp':  'ESCROW ILP',
};
const WINDOWS = ['10m', '1h', '24h'];

export function App() {
  const [mode,   setMode]   = useState('iou');
  const [window, setWindow] = useState('1h');

  const [pendingNetwork, setPendingNetwork] = useState(null);
  const [networkError, setNetworkError]     = useState(false);
  const switchTimerRef                      = useRef(null);
  const currentNetwork = useWsStore((s) => s.currentNetwork);
  const setNetwork     = useWsStore((s) => s.setNetwork);

  useEffect(() => {
    const disconnect = createSocketConnection(WS_URL, useWsStore.getState());
    fetchCurrentNetwork().then(({ network }) => setNetwork(network)).catch(() => {});
    return disconnect;
  }, []);

  async function handleNetworkChange(e) {
    const name = e.target.value;
    if (name === currentNetwork || pendingNetwork) return;
    setPendingNetwork(name);
    switchTimerRef.current = setTimeout(() => {
      setPendingNetwork(null);
      setNetworkError(true);
    }, 5000);
    try {
      await switchNetworkApi(name);
    } catch {
      clearTimeout(switchTimerRef.current);
      setPendingNetwork(null);
      setNetworkError(true);
    }
  }

  useEffect(() => {
    if (pendingNetwork && currentNetwork === pendingNetwork) {
      clearTimeout(switchTimerRef.current);
      setPendingNetwork(null);
    }
  }, [currentNetwork]);

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
                {MODE_LABELS[m] ?? m.toUpperCase()}
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

          {/* Network selector */}
          <Select
            value={pendingNetwork ?? currentNetwork}
            onChange={handleNetworkChange}
            disabled={!!pendingNetwork}
            size="small"
            variant="outlined"
            sx={{
              height: 26,
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: 0.5,
              color: pendingNetwork ? 'text.secondary' : (
                currentNetwork === 'mainnet' ? 'success.main' :
                currentNetwork === 'testnet' ? 'warning.main' : 'info.main'
              ),
              '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.12)' },
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.3)' },
            }}
          >
            <MenuItem value="mainnet" sx={{ fontSize: '0.7rem', fontWeight: 700 }}>MAINNET</MenuItem>
            <MenuItem value="testnet" sx={{ fontSize: '0.7rem', fontWeight: 700 }}>TESTNET</MenuItem>
            <MenuItem value="devnet"  sx={{ fontSize: '0.7rem', fontWeight: 700 }}>DEVNET</MenuItem>
          </Select>

          <ConnectionStatus />

          <Snackbar
            open={networkError}
            autoHideDuration={4000}
            onClose={() => setNetworkError(false)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          >
            <Alert severity="error" onClose={() => setNetworkError(false)} sx={{ fontSize: '0.8rem' }}>
              Network switch failed. Please try again.
            </Alert>
          </Snackbar>
        </Toolbar>
      </AppBar>

      <Dashboard mode={mode} window={window} />
    </Box>
  );
}
