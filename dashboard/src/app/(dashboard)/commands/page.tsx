'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { issueCommand } from '@/lib/db';
import { dispatchCommandToDevice } from '@/lib/rtdb';
import {
  Terminal, Power, RefreshCw, Moon, Lock, Skull, Play,
  FileCode, Code, Command, CheckCircle, XCircle, Clock,
  Loader2, ChevronDown, Monitor
} from 'lucide-react';
import { format } from 'date-fns';

const COMMAND_TYPES = [
  { value: 'shutdown', label: 'Shutdown', icon: Power, color: 'text-red-400', description: 'Power off the device' },
  { value: 'restart', label: 'Restart', icon: RefreshCw, color: 'text-orange-400', description: 'Reboot the device' },
  { value: 'sleep', label: 'Sleep', icon: Moon, color: 'text-blue-400', description: 'Put device to sleep' },
  { value: 'lock', label: 'Lock', icon: Lock, color: 'text-purple-400', description: 'Lock the workstation' },
  { value: 'run_cmd', label: 'Run CMD', icon: Terminal, color: 'text-green-400', description: 'Execute a command' },
  { value: 'run_script', label: 'Run Script', icon: FileCode, color: 'text-cyan-400', description: 'Run Python script' },
  { value: 'run_exe', label: 'Run EXE', icon: Play, color: 'text-yellow-400', description: 'Launch executable' },
];

export default function CommandsPage() {
  const { devices, metricsMap, commands, user } = useAppStore();
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedType, setSelectedType] = useState('run_cmd');
  const [payload, setPayload] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const onlineDevices = devices.filter(d => metricsMap[d.deviceId]?.status === 'online');

  const handleSend = async () => {
    if (!selectedDevice || !user) return;

    setLoading(true);
    setResult(null);

    try {
      const device = devices.find(d => d.deviceId === selectedDevice);
      const cmdPayload: Record<string, unknown> = {};

      if (selectedType === 'run_cmd') cmdPayload.command = payload;
      else if (selectedType === 'run_script') cmdPayload.script = payload;
      else if (selectedType === 'run_exe') cmdPayload.path = payload;

      const commandId = await issueCommand(
        selectedDevice,
        device?.name || device?.machineName || selectedDevice,
        selectedType as any,
        cmdPayload,
        user.uid
      );
      await dispatchCommandToDevice(selectedDevice, commandId, selectedType, cmdPayload);

      setResult({ ok: true, msg: `Command dispatched (ID: ${commandId})` });
      setPayload('');
    } catch (err: unknown) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Failed to send command' });
    } finally {
      setLoading(false);
    }
  };

  const needsInput = ['run_cmd', 'run_script', 'run_exe'].includes(selectedType);
  const selectedTypeInfo = COMMAND_TYPES.find(t => t.value === selectedType);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Command Center</h1>
        <p className="text-slate-400 text-sm mt-0.5">Issue remote commands to any connected device</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Command builder */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-5">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-green-400" />
              Issue Command
            </h2>

            {/* Device selector */}
            <div className="mb-4">
              <label className="block text-xs text-slate-400 mb-1.5">Target Device</label>
              <select
                value={selectedDevice}
                onChange={e => setSelectedDevice(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-green-500/40 appearance-none"
              >
                <option value="">Select device...</option>
                {onlineDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.name || d.machineName} ({d.deviceId})
                  </option>
                ))}
              </select>
            </div>

            {/* Command type */}
            <div className="mb-4">
              <label className="block text-xs text-slate-400 mb-1.5">Command Type</label>
              <div className="grid grid-cols-2 gap-2">
                {COMMAND_TYPES.map(type => (
                  <button
                    key={type.value}
                    onClick={() => setSelectedType(type.value)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                      selectedType === type.value
                        ? 'border-green-500/30 bg-green-500/10 text-white'
                        : 'border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <type.icon className={`w-3.5 h-3.5 ${selectedType === type.value ? type.color : ''}`} />
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Payload input */}
            {needsInput && (
              <div className="mb-4">
                <label className="block text-xs text-slate-400 mb-1.5">
                  {selectedType === 'run_cmd' ? 'Command String' :
                   selectedType === 'run_script' ? 'Python Script' : 'EXE Path'}
                </label>
                <textarea
                  value={payload}
                  onChange={e => setPayload(e.target.value)}
                  placeholder={
                    selectedType === 'run_cmd' ? 'e.g. ipconfig /all' :
                    selectedType === 'run_script' ? 'print("Hello from ClusterOS!")' :
                    'C:\\Program Files\\App\\app.exe'
                  }
                  rows={selectedType === 'run_script' ? 4 : 2}
                  className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-green-500/40 resize-none"
                />
              </div>
            )}

            {/* Result */}
            {result && (
              <div className={`mb-4 flex items-start gap-2 p-3 rounded-lg ${
                result.ok
                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                  : 'bg-red-500/10 border border-red-500/20 text-red-400'
              }`}>
                {result.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                <span className="text-xs">{result.msg}</span>
              </div>
            )}

            <button
              onClick={handleSend}
              disabled={loading || !selectedDevice || (needsInput && !payload)}
              className="w-full py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Terminal className="w-4 h-4" />}
              {loading ? 'Sending...' : 'Send Command'}
            </button>
          </div>
        </div>

        {/* Command history */}
        <div className="lg:col-span-3">
          <div className="glass-card p-5">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-green-400" />
              Command History
              <span className="ml-auto text-xs text-slate-500">{commands.length} total</span>
            </h2>

            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {commands.length === 0 ? (
                <div className="text-center py-10 text-slate-500">
                  <Terminal className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No commands issued yet</p>
                </div>
              ) : (
                commands.map(cmd => {
                  const statusIcon = cmd.status === 'success' ? CheckCircle :
                    cmd.status === 'failed' ? XCircle : Clock;
                  const statusColor = cmd.status === 'success' ? 'text-green-400' :
                    cmd.status === 'failed' ? 'text-red-400' : 'text-amber-400';
                  const statusBg = cmd.status === 'success' ? 'bg-green-500/10' :
                    cmd.status === 'failed' ? 'bg-red-500/10' : 'bg-amber-500/10';

                  const cmdType = COMMAND_TYPES.find(t => t.value === cmd.type);

                  return (
                    <div key={cmd.id} className="flex items-start gap-3 p-3 bg-slate-900/40 rounded-lg border border-slate-800/60">
                      <div className={`w-7 h-7 rounded-lg ${statusBg} flex items-center justify-center flex-shrink-0`}>
                        {cmdType && <cmdType.icon className={`w-3.5 h-3.5 ${cmdType.color}`} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{cmdType?.label || cmd.type}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${statusBg} ${statusColor}`}>
                            {cmd.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                          <Monitor className="w-3 h-3" />
                          <span>{cmd.deviceName || cmd.deviceId}</span>
                          <span>·</span>
                          <span>{format(new Date(cmd.issuedAt), 'MMM d HH:mm:ss')}</span>
                        </div>
                        {cmd.output && (
                          <div className="mt-1.5 text-xs font-mono text-slate-400 bg-slate-950 px-2 py-1.5 rounded truncate">
                            {cmd.output}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
