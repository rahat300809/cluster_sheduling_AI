'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Cpu, MemoryStick, Zap, Thermometer, Wifi, ListTodo, ShieldCheck, HardDrive, RotateCcw, Settings2, Info } from 'lucide-react';
import type { SchedulerWeights } from '@/types';
import { DEFAULT_SCHEDULER_WEIGHTS } from '@/types';

// ─── Storage key ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'clusteros_scheduler_weights';

// ─── Load weights from localStorage (falls back to defaults) ─────────────────
export function loadWeights(): SchedulerWeights {
  if (typeof window === 'undefined') return { ...DEFAULT_SCHEDULER_WEIGHTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SchedulerWeights;
  } catch { /* ignore */ }
  return { ...DEFAULT_SCHEDULER_WEIGHTS };
}

export function saveWeights(weights: SchedulerWeights) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(weights));
  } catch { /* ignore */ }
}

// ─── Weight Metadata ─────────────────────────────────────────────────────────
const WEIGHT_META = [
  { key: 'cpu' as keyof SchedulerWeights, label: 'CPU Availability', icon: Cpu, color: 'text-blue-400', barColor: 'bg-blue-400', desc: 'How much CPU headroom does the node have?' },
  { key: 'ram' as keyof SchedulerWeights, label: 'RAM Availability', icon: MemoryStick, color: 'text-violet-400', barColor: 'bg-violet-400', desc: 'Free memory for the new workload' },
  { key: 'gpu' as keyof SchedulerWeights, label: 'GPU Availability', icon: Zap, color: 'text-yellow-400', barColor: 'bg-yellow-400', desc: 'GPU and VRAM headroom (avg)' },
  { key: 'temperature' as keyof SchedulerWeights, label: 'Temperature Safety', icon: Thermometer, color: 'text-orange-400', barColor: 'bg-orange-400', desc: 'Prefers cooler CPU & GPU temps' },
  { key: 'network' as keyof SchedulerWeights, label: 'Network Quality', icon: Wifi, color: 'text-cyan-400', barColor: 'bg-cyan-400', desc: 'Low latency & high throughput' },
  { key: 'queue' as keyof SchedulerWeights, label: 'Queue Depth', icon: ListTodo, color: 'text-emerald-400', barColor: 'bg-emerald-400', desc: 'Fewer queued/running tasks = better' },
  { key: 'reliability' as keyof SchedulerWeights, label: 'Historical Reliability', icon: ShieldCheck, color: 'text-green-400', barColor: 'bg-green-400', desc: 'Node\'s past job success rate' },
  { key: 'disk' as keyof SchedulerWeights, label: 'Disk Health', icon: HardDrive, color: 'text-slate-400', barColor: 'bg-slate-400', desc: 'Free space + read/write throughput' },
] as const;

// ─── Props ────────────────────────────────────────────────────────────────────
interface SchedulerWeightsPanelProps {
  weights: SchedulerWeights;
  onChange: (w: SchedulerWeights) => void;
  onClose?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function SchedulerWeightsPanel({ weights, onChange, onClose }: SchedulerWeightsPanelProps) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const totalPct = Math.round(total * 100);
  const isValid = Math.abs(total - 1.0) < 0.01;

  const handleSlider = useCallback((key: keyof SchedulerWeights, rawVal: number) => {
    const val = rawVal / 100;
    const updated = { ...weights, [key]: parseFloat(val.toFixed(2)) };
    onChange(updated);
    saveWeights(updated);
  }, [weights, onChange]);

  const handleReset = useCallback(() => {
    onChange({ ...DEFAULT_SCHEDULER_WEIGHTS });
    saveWeights({ ...DEFAULT_SCHEDULER_WEIGHTS });
  }, [onChange]);

  return (
    <motion.div
      className="bg-[#090e1a] border border-slate-800/80 rounded-xl overflow-hidden"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
    >
      {/* Header */}
      <div className="bg-slate-950/60 border-b border-slate-800/60 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-violet-400" />
          <span className="text-white text-sm font-semibold">Scheduler Weights</span>
          <span className="text-slate-500 text-xs">— Configurable per session</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Total indicator */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
            isValid
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            Σ = {totalPct}%
            {!isValid && <span className="text-[9px] ml-1">(should be 100%)</span>}
          </div>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-white rounded-lg text-xs font-semibold transition-all"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Sliders */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {WEIGHT_META.map(({ key, label, icon: Icon, color, barColor, desc }) => {
          const pct = Math.round(weights[key] * 100);
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                  <span className="text-white text-xs font-semibold">{label}</span>
                </div>
                <span className={`text-xs font-bold font-mono ${color}`}>{pct}%</span>
              </div>
              {/* Slider */}
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={pct}
                onChange={e => handleSlider(key, Number(e.target.value))}
                className="w-full h-1.5 appearance-none rounded-full cursor-pointer"
                style={{
                  background: `linear-gradient(to right, var(--tw-gradient-from, currentColor) ${pct * 2}%, rgb(30 41 59) ${pct * 2}%)`,
                }}
              />
              <p className="text-slate-600 text-[10px] leading-tight">{desc}</p>
            </div>
          );
        })}
      </div>

      {/* Visual weight distribution bar */}
      <div className="px-4 pb-4">
        <div className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider mb-2">Weight Distribution</div>
        <div className="flex h-2 rounded-full overflow-hidden gap-px">
          {WEIGHT_META.map(({ key, barColor }) => (
            <div
              key={key}
              className={`${barColor} transition-all duration-200`}
              style={{ flex: weights[key] }}
              title={`${key}: ${Math.round(weights[key] * 100)}%`}
            />
          ))}
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {WEIGHT_META.map(({ key, label, color, barColor }) => (
            <div key={key} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-sm ${barColor}`} />
              <span className="text-slate-600 text-[9px]">{label} ({Math.round(weights[key] * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>

      {/* Info note */}
      <div className="border-t border-slate-800/40 px-4 py-3 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-slate-600 mt-0.5 flex-shrink-0" />
        <p className="text-slate-600 text-[10px] leading-relaxed">
          Weights are saved locally and applied to every scheduling decision. Changes take effect immediately on the next job run.
          Weights do not need to sum to exactly 100% — the engine normalises them automatically.
        </p>
      </div>
    </motion.div>
  );
}
