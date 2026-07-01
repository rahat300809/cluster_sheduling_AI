'use client';

import { ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';

interface MetricGaugeProps {
  value: number;
  label: string;
  color: string;
}

export function MetricGauge({ value, label, color }: MetricGaugeProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const data = [{ value: clamped, fill: color }];

  const getColor = (v: number) => {
    if (v > 90) return '#ef4444';
    if (v > 75) return '#f59e0b';
    return color;
  };

  const displayColor = getColor(clamped);

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-20">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="65%"
            outerRadius="100%"
            data={data}
            startAngle={90}
            endAngle={-270}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              dataKey="value"
              background={{ fill: 'rgba(255,255,255,0.04)' }}
              cornerRadius={4}
              fill={displayColor}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-white tabular-nums">{clamped.toFixed(0)}%</span>
        </div>
      </div>
      <span className="text-xs text-slate-400 mt-1">{label}</span>
    </div>
  );
}
