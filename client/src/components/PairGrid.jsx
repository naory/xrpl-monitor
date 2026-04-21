import { Box, Typography, CircularProgress } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { useStats } from '../hooks/useStats';
import { PairCard } from './PairCard';

export function PairGrid({ window }) {
  const { data, isLoading, isError } = useStats(window);
  const pairs = data?.volumeLeaderboard ?? [];

  if (isLoading && !pairs.length) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (isError) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="error">Failed to load pairs</Typography>
      </Box>
    );
  }

  if (!pairs.length) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.secondary">No trades yet…</Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 1,
        overflowY: 'auto',
        height: '100%',
        alignContent: 'start',
        pr: 0.5,
      }}
    >
      <AnimatePresence initial={false}>
        {pairs.map((pair) => (
          <motion.div
            key={pair.pairKey}
            layout
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ duration: 0.2 }}
          >
            <PairCard pairKey={pair.pairKey} window={window} windowVolume={pair.volume} />
          </motion.div>
        ))}
      </AnimatePresence>
    </Box>
  );
}
