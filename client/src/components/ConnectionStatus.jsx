import { Box, Chip } from '@mui/material';
import { useWsStore } from '../store/useWsStore';

export function ConnectionStatus() {
  const connected = useWsStore((s) => s.connected);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box
        sx={{
          width: 8, height: 8, borderRadius: '50%',
          bgcolor: connected ? 'success.main' : 'error.main',
          boxShadow: connected
            ? '0 0 8px rgba(0,230,118,0.8)'
            : '0 0 8px rgba(255,23,68,0.8)',
          animation: connected ? 'pulse 2s ease-in-out infinite' : 'none',
          '@keyframes pulse': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.4 },
          },
        }}
      />
      <Chip
        label={connected ? 'LIVE' : 'OFFLINE'}
        size="small"
        color={connected ? 'success' : 'error'}
        variant="outlined"
        sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, letterSpacing: 1 }}
      />
    </Box>
  );
}
