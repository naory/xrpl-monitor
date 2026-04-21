import { useEffect, useRef, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import { useWsStore } from '../store/useWsStore';

function fillToPoint(fill) {
  const time  = Math.floor(new Date(fill.ledgerTime).getTime() / 1000);
  const value = parseFloat(fill.paysValue) / (parseFloat(fill.getsValue) || 1);
  return Number.isFinite(value) && value > 0 ? { time, value } : null;
}

export function PriceChart() {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRef    = useRef(null);
  const lastTimeRef  = useRef(0);

  const fills         = useWsStore((s) => s.fills);
  const selectedPair  = useWsStore((s) => s.selectedPair);

  const pairFills = useMemo(
    () => fills.filter((f) => f.pairKey === selectedPair),
    [fills, selectedPair],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9fa8da',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true, secondsVisible: false },
      handleScale: { mouseWheel: true, pinch: true },
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const series = chart.addLineSeries({
      color:     '#00e5ff',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius:  5,
      lastValueVisible: true,
      priceLineVisible: true,
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  // Reset chart when selected pair changes
  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.setData([]);
      lastTimeRef.current = 0;
    }
  }, [selectedPair]);

  // Feed new fills into the chart
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || pairFills.length === 0) return;

    const newest = pairFills[0];
    const point  = fillToPoint(newest);
    if (!point) return;

    const t = Math.max(point.time, lastTimeRef.current + 1);
    series.update({ time: t, value: point.value });
    lastTimeRef.current = t;
  }, [pairFills]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h6" sx={{ fontSize: '0.85rem', color: 'primary.main', textTransform: 'uppercase', letterSpacing: 2 }}>
          Price — {selectedPair ? selectedPair.split('~').map((s) => s.split('|')[0]).join('/') : 'No pair selected'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {pairFills.length} point{pairFills.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      {!selectedPair && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="caption" color="text.secondary">Select a pair to see price action</Typography>
        </Box>
      )}

      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          display: selectedPair ? 'block' : 'none',
          minHeight: 0,
        }}
      />
    </Box>
  );
}
