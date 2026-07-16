'use client';

import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <Loader2 className="w-6 h-6 text-green-400 animate-spin mx-auto mb-2" />
        <p className="text-slate-500 text-xs">Loading...</p>
      </div>
    </div>
  );
}
