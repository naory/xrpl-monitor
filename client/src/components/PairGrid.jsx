import { Box, Typography } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { useWsStore } from '../store/useWsStore';
import { PairCard } from './PairCard';

export function PairGrid() {
  const topK = useWsStore((s) => s.topK);

  if (!topK.length) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          Waiting for trades…
        </Typography>
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
        {topK.map((pair) => (
          <motion.div
            key={pair.pairKey}
            layout
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ duration: 0.2 }}
          >
            <PairCard pairKey={pair.pairKey} />
          </motion.div>
        ))}
      </AnimatePresence>
    </Box>
  );
}
