'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { updatePassword, updateProfile } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  Settings, User, Shield, Bell, Monitor, Save, Eye, EyeOff,
  CheckCircle, Loader2, Palette
} from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAppStore();
  const [activeTab, setActiveTab] = useState('profile');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSaveProfile = async () => {
    if (!auth.currentUser) return;
    setSaving(true);
    setError('');

    try {
      await updateProfile(auth.currentUser, { displayName });

      if (newPassword) {
        if (newPassword !== confirmPassword) {
          setError('Passwords do not match');
          setSaving(false);
          return;
        }
        await updatePassword(auth.currentUser, newPassword);
        setNewPassword('');
        setConfirmPassword('');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'appearance', label: 'Appearance', icon: Palette },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-400 text-sm mt-0.5">Manage your ClusterOS account and preferences</p>
      </div>

      <div className="flex gap-1 border-b border-slate-800">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
              activeTab === tab.id
                ? 'border-green-400 text-green-400'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6 space-y-5"
        >
          <h2 className="font-semibold text-white">Account Information</h2>

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <User className="w-8 h-8 text-green-400" />
            </div>
            <div>
              <div className="font-medium text-white">{user?.displayName || user?.email?.split('@')[0] || 'User'}</div>
              <div className="text-sm text-slate-400">{user?.email}</div>
              <div className="text-xs text-slate-500 mt-0.5 capitalize">Role: {user?.role}</div>
            </div>
          </div>

          {/* Display name */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500/40"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-3 py-2.5 bg-slate-900/20 border border-slate-800 rounded-lg text-sm text-slate-400 cursor-not-allowed"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-all"
          >
            {saved ? <CheckCircle className="w-4 h-4" /> : saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
          </button>
        </motion.div>
      )}

      {activeTab === 'security' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6 space-y-5"
        >
          <h2 className="font-semibold text-white">Password & Security</h2>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">New Password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pr-10 px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500/40"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500/40"
            />
          </div>

          <button
            onClick={handleSaveProfile}
            disabled={saving || !newPassword || newPassword !== confirmPassword}
            className="flex items-center gap-2 px-4 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold rounded-lg text-sm transition-all"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            Update Password
          </button>
        </motion.div>
      )}

      {activeTab === 'notifications' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6 space-y-5"
        >
          <h2 className="font-semibold text-white">Notification Preferences</h2>

          {[
            { label: 'Device goes offline', desc: 'Alert when a device disconnects', enabled: true },
            { label: 'High CPU load (>85%)', desc: 'Alert when CPU exceeds threshold', enabled: true },
            { label: 'High RAM usage (>90%)', desc: 'Alert when RAM exceeds threshold', enabled: true },
            { label: 'Job failed', desc: 'Alert when a scheduled job fails', enabled: true },
            { label: 'Job completed', desc: 'Notify when a job finishes successfully', enabled: false },
            { label: 'New device paired', desc: 'Alert when a new device is connected', enabled: true },
          ].map((item, i) => (
            <div key={i} className="flex items-center justify-between py-3 border-b border-slate-800 last:border-0">
              <div>
                <div className="text-sm text-white">{item.label}</div>
                <div className="text-xs text-slate-500">{item.desc}</div>
              </div>
              <div className={`w-10 h-5 rounded-full relative cursor-pointer transition-all ${item.enabled ? 'bg-green-500' : 'bg-slate-700'}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${item.enabled ? 'right-0.5' : 'left-0.5'}`} />
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {activeTab === 'appearance' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6 space-y-5"
        >
          <h2 className="font-semibold text-white">Appearance</h2>
          <p className="text-slate-400 text-sm">ClusterOS uses OLED Dark Mode optimized for monitoring.</p>

          <div className="flex items-center gap-3 p-4 bg-slate-900/60 rounded-lg border border-slate-800">
            <div className="w-12 h-8 rounded-lg bg-[#020617] border border-slate-700 flex items-center justify-center">
              <div className="w-3 h-3 rounded-sm bg-green-400" />
            </div>
            <div>
              <div className="text-sm font-medium text-white">OLED Dark</div>
              <div className="text-xs text-slate-500">Deep black — optimal for OLED displays & monitoring</div>
            </div>
            <div className="ml-auto">
              <CheckCircle className="w-4 h-4 text-green-400" />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
