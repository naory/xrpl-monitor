import { Box, Typography, CircularProgress } from '@mui/material';
import { useAmmStats } from '../hooks/useAmmStats';
import { AmmCard } from './AmmCard';

export function AmmGrid({ window }) {
  const { data, isLoading, error } = useAmmStats(window);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography sx={{ color: 'error.main', fontSize: '0.75rem', p: 2 }}>
        Failed to load AMM data
      </Typography>
    );
  }

  const pools = data?.pools ?? [];

  if (!pools.length) {
    return (
      <Typography sx={{ color: 'text.disabled', fontSize: '0.75rem', p: 2 }}>
        No AMM pools yet
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 1,
        height: '100%',
        overflow: 'auto',
        alignContent: 'start',
      }}
    >
      {pools.map((pool) => (
        <AmmCard key={pool.ammAccount} pool={pool} />
      ))}
    </Box>
  );
}
