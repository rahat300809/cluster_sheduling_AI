'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { 
  createRentalSessionFirestore, 
  updateRentalSessionFirestore, 
  subscribeUserRentals, 
  getUserBalance, 
  addHostBalance, 
  RentalSessionData 
} from '@/lib/db';
import { 
  startActiveRentalSessionRTDB, 
  subscribeActiveRentalSessionRTDB, 
  stopActiveRentalSessionRTDB,
  subscribeGlobalRentalSessionRTDB,
  ActiveRentalSessionRTDB 
} from '@/lib/rtdb';
import { pairDevice } from '@/lib/db';
import { consumePairCode } from '@/lib/rtdb';
import { db, rtdb } from '@/lib/firebase';
import { ref, onValue, off, set } from 'firebase/database';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { 
  Download, Wallet, Cpu, Plus, CheckCircle, AlertTriangle, Play, Square, 
  History, Clock, Info, ShieldAlert, Sparkles, Server, ArrowUpRight, Loader2,
  Smartphone, Trash2
} from 'lucide-react';

const fadeUp = {
  initial: { opacity: 0, y: 15 },
  animate: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.3 } }),
};

export default function RentalsPage() {
  const { user, devices, metricsMap } = useAppStore();
  const [activeTab, setActiveTab] = useState<'host' | 'renter'>('host');
  const [portalRole, setPortalRole] = useState<'developer' | 'host'>('developer');

  useEffect(() => {
    const role = localStorage.getItem('portal_role');
    if (role === 'host') {
      setPortalRole('host');
      setActiveTab('host');
    } else {
      setPortalRole('developer');
      setActiveTab('renter');
    }
  }, []);

  // Host states
  const [hostBalance, setHostBalance] = useState<number>(0);
  const [hostRentals, setHostRentals] = useState<RentalSessionData[]>([]);
  const [hostingType, setHostingType] = useState<'pc' | 'mobile'>('pc');
  const [showPairDialog, setShowPairDialog] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState('');
  const [pairSuccess, setPairSuccess] = useState(false);

  // Renter states
  const [renterRentals, setRenterRentals] = useState<RentalSessionData[]>([]);
  const [targetDeviceCode, setTargetDeviceCode] = useState('');
  const [hourlyRate, setHourlyRate] = useState<number>(100);
  const [duration, setDuration] = useState<number>(30); // minutes, or -1 for pay-as-you-go
  const [rentLoading, setRentLoading] = useState(false);
  const [rentError, setRentError] = useState('');
  const [rentSuccess, setRentSuccess] = useState(false);

  // Live trackers for active sessions
  const [liveSessions, setLiveSessions] = useState<Record<string, ActiveRentalSessionRTDB>>({});

  // Rented devices live metrics (since renters don't own the device, they don't have it in metricsMap)
  const [rentedDevicesMetrics, setRentedDevicesMetrics] = useState<Record<string, any>>({});

  // Preview target device specs
  const [previewMetrics, setPreviewMetrics] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Effect to preview target hardware specs when code is entered
  useEffect(() => {
    const code = targetDeviceCode.trim().toUpperCase();
    if (code.length < 6) {
      setPreviewMetrics(null);
      return;
    }

    setPreviewLoading(true);
    const metricsRef = ref(rtdb, `devices/${code}/metrics`);
    const unsub = onValue(metricsRef, (snap) => {
      setPreviewLoading(false);
      if (snap.exists()) {
        setPreviewMetrics(snap.val());
      } else {
        setPreviewMetrics(null);
      }
    }, (err) => {
      setPreviewLoading(false);
      setPreviewMetrics(null);
    });

    return () => {
      off(metricsRef);
    };
  }, [targetDeviceCode]);

  // ── Load Host Data ──
  useEffect(() => {
    if (!user) return;
    
    // Fetch host balance
    getUserBalance(user.uid).then(bal => setHostBalance(bal));

    // Subscribe to host's rentals (where they are the owner)
    const unsubHost = subscribeUserRentals(user.uid, 'owner', (sessions) => {
      setHostRentals(sessions);
    });

    // Subscribe to renter's rentals (where they are using a PC)
    const unsubRenter = subscribeUserRentals(user.uid, 'renter', (sessions) => {
      setRenterRentals(sessions);
    });

    return () => {
      unsubHost();
      unsubRenter();
    };
  }, [user]);

  // ── Real-time Active Sessions Listener ──
  useEffect(() => {
    const activeRented = renterRentals.filter(s => s.status === 'running');
    const activeHosted = hostRentals.filter(s => s.status === 'running');
    const allActive = [...activeRented, ...activeHosted];

    const unsubs: (() => void)[] = [];

    allActive.forEach(session => {
      const unsub = subscribeGlobalRentalSessionRTDB(session.id!, (rtdbData) => {
        if (rtdbData) {
          setLiveSessions(prev => ({
            ...prev,
            [session.id!]: rtdbData
          }));
          
          // Auto checkout fixed timer completion detection on frontend (as secondary safeguard)
          if (
            rtdbData.status === 'completed' && 
            session.status === 'running'
          ) {
            handleCompleteSession(session.id!, session.deviceId, session.ownerUserId, rtdbData.earnedBalance);
          }
        }
      });
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach(fn => fn());
    };
  }, [renterRentals, hostRentals]);

  // ── Rented Devices Live Metrics Listener (for Renters) ──
  useEffect(() => {
    const activeRented = renterRentals.filter(s => s.status === 'running');
    if (activeRented.length === 0) {
      setRentedDevicesMetrics({});
      return;
    }

    const unsubs = activeRented.map(session => {
      const metricsRef = ref(rtdb, `devices/${session.deviceId}/metrics`);
      return onValue(metricsRef, (snap) => {
        if (snap.exists()) {
          setRentedDevicesMetrics(prev => ({
            ...prev,
            [session.deviceId]: snap.val()
          }));
        }
      });
    });

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [renterRentals]);

  // ── Host: Pair Rental Device ──
  const handlePairRental = async () => {
    if (!pairCode || !user) return;
    setPairLoading(true);
    setPairError('');

    try {
      const rtdbDevice = await consumePairCode(pairCode.toUpperCase());
      const finalName = deviceName || (rtdbDevice ? rtdbDevice.machineName : `Rental PC ${pairCode.toUpperCase()}`);
      const finalId = rtdbDevice ? rtdbDevice.deviceId : `PC-RNT-${pairCode.toUpperCase()}`;

      // Write device to Firestore
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'devices', finalId), {
        deviceId: finalId,
        pairCode: pairCode.toUpperCase(),
        name: finalName,
        machineName: rtdbDevice ? rtdbDevice.machineName : 'Unknown Machine',
        ownerId: user.uid,
        paired: true,
        type: 'rental',
        rentalStatus: 'idle',
        rentalSessionId: null,
        createdAt: Date.now(),
        lastSeen: Date.now(),
      });

      // Set paired status in RTDB so host agent knows it is paired!
      await set(ref(rtdb, `devices/${finalId}/paired`), true);

      setPairSuccess(true);
      setTimeout(() => {
        setShowPairDialog(false);
        setPairCode('');
        setDeviceName('');
        setPairSuccess(false);
      }, 1500);
    } catch (err: any) {
      setPairError(err.message || 'Failed to pair rental agent');
    } finally {
      setPairLoading(false);
    }
  };

  const handleRemoveDevice = async (deviceId: string) => {
    if (!confirm('Are you sure you want to remove/unpair this device? It will be disconnected from your account.')) return;
    try {
      // 1. Revert/unpair in Firestore
      const deviceRef = doc(db, 'devices', deviceId);
      await updateDoc(deviceRef, {
        paired: false,
        ownerId: '',
        type: 'standard',
        rentalStatus: 'idle',
        rentalSessionId: null
      });

      // 2. Set paired status in RTDB to false
      await set(ref(rtdb, `devices/${deviceId}/paired`), false);

      alert('Device removed successfully!');
    } catch (err: any) {
      alert('Failed to remove device: ' + err.message);
    }
  };

  // ── Renter: Start Session ──
  const handleStartRental = async () => {
    if (!targetDeviceCode || !user) return;
    setRentLoading(true);
    setRentError('');

    try {
      // Lookup target device in Firestore
      const deviceRef = doc(db, 'devices', targetDeviceCode.trim().toUpperCase());
      const deviceSnap = await getDoc(deviceRef);

      if (!deviceSnap.exists()) {
        throw new Error('Device not found! Please check the device code.');
      }

      const deviceData = deviceSnap.data();
      if (deviceData.ownerId === user.uid) {
        throw new Error('You cannot rent your own device!');
      }

      if (deviceData.rentalStatus === 'rented') {
        throw new Error('This device is currently rented by someone else!');
      }

      // Check if device is online
      const isOnline = previewMetrics?.status === 'online' && (Date.now() - (previewMetrics.timestamp ?? 0)) < 15000;
      if (!isOnline) {
        throw new Error('This device is currently offline. Host must open the Rental Agent.');
      }

      // Setup session
      const sessionId = `rent_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const newSession: RentalSessionData = {
        deviceId: deviceData.deviceId,
        deviceName: deviceData.name || deviceData.machineName,
        renterUserId: user.uid,
        renterEmail: user.email || 'anonymous@clusteros.com',
        ownerUserId: deviceData.ownerId,
        hourlyRate: hourlyRate,
        durationHours: duration / 60,
        durationMinutes: duration,
        status: 'running',
        mode: duration === -1 ? 'pay_as_you_go' : 'fixed',
        startTime: Date.now(),
        endTime: duration === -1 ? 0 : Date.now() + duration * 60 * 1000,
        elapsedSeconds: 0,
        earnedBalance: 0,
        isViolated: false,
        createdAt: Date.now()
      };

      // Write session to Firestore
      await createRentalSessionFirestore({ ...newSession, id: sessionId });

      // Start in RTDB
      const rtdbSession: ActiveRentalSessionRTDB = {
        sessionId,
        status: 'running',
        mode: newSession.mode,
        hourlyRate: newSession.hourlyRate,
        durationHours: newSession.durationHours,
        durationMinutes: newSession.durationMinutes,
        startTime: newSession.startTime,
        elapsedSeconds: 0,
        earnedBalance: 0
      };
      await startActiveRentalSessionRTDB(deviceData.deviceId, rtdbSession);

      // Update Device in Firestore
      await updateDoc(deviceRef, {
        rentalStatus: 'rented',
        rentalSessionId: sessionId,
        renterUserId: user.uid
      });

      setRentSuccess(true);
      setTargetDeviceCode('');
      setTimeout(() => {
        setRentSuccess(false);
      }, 1500);

    } catch (err: any) {
      setRentError(err.message || 'Failed to start rental session');
    } finally {
      setRentLoading(false);
    }
  };

  // ── Settle Completed Session ──
  const handleCompleteSession = async (
    sessionId: string, 
    deviceId: string, 
    ownerUserId: string, 
    finalBalance: number
  ) => {
    try {
      // 1. Stop session in RTDB
      await stopActiveRentalSessionRTDB(deviceId, sessionId, 'completed');

      // 2. Update session in Firestore
      await updateRentalSessionFirestore(sessionId, {
        status: 'completed',
        earnedBalance: finalBalance,
        endTime: Date.now()
      });

      // 3. Update device in Firestore
      await updateDoc(doc(db, 'devices', deviceId), {
        rentalStatus: 'idle',
        rentalSessionId: null,
        renterUserId: null
      });

      // 4. Pay the host
      await addHostBalance(ownerUserId, finalBalance);

      // Refresh balance
      if (user && user.uid === ownerUserId) {
        getUserBalance(user.uid).then(bal => setHostBalance(bal));
      }
    } catch (err) {
      console.error("Failed to complete rental session checkout:", err);
    }
  };

  // ── Renter: Stop / Checkout Session ──
  const handleStopRental = async (session: RentalSessionData) => {
    if (!confirm('Are you sure you want to stop this rental session? You will be billed for the elapsed duration.')) return;
    
    const liveData = liveSessions[session.id!];
    const finalBalance = liveData ? liveData.earnedBalance : 0;

    try {
      // 1. Stop session in RTDB
      await stopActiveRentalSessionRTDB(session.deviceId, session.id!, 'completed');

      // 2. Update session in Firestore
      await updateRentalSessionFirestore(session.id!, {
        status: 'completed',
        earnedBalance: finalBalance,
        endTime: Date.now(),
        elapsedSeconds: liveData ? liveData.elapsedSeconds : 0
      });

      // 3. Update device in Firestore
      await updateDoc(doc(db, 'devices', session.deviceId), {
        rentalStatus: 'idle',
        rentalSessionId: null,
        renterUserId: null
      });

      // 4. Pay the host
      await addHostBalance(session.ownerUserId, finalBalance);

      alert(`Session stopped successfully! Charged: ৳ ${finalBalance.toFixed(2)} Tk.`);
    } catch (err: any) {
      alert('Checkout failed: ' + err.message);
    }
  };

  // ── Host: Stop / Exit Session ──
  const handleHostStopRental = async (session: RentalSessionData) => {
    if (!confirm('Are you sure you want to stop hosting this rental session? The session will end and you will receive the accumulated earnings.')) return;
    
    const liveData = liveSessions[session.id!];
    const finalBalance = liveData ? liveData.earnedBalance : 0;

    try {
      // 1. Stop session in RTDB
      await stopActiveRentalSessionRTDB(session.deviceId, session.id!, 'completed');

      // 2. Update session in Firestore
      await updateRentalSessionFirestore(session.id!, {
        status: 'completed',
        earnedBalance: finalBalance,
        endTime: Date.now(),
        elapsedSeconds: liveData ? liveData.elapsedSeconds : 0
      });

      // 3. Update device in Firestore
      await updateDoc(doc(db, 'devices', session.deviceId), {
        rentalStatus: 'idle',
        rentalSessionId: null,
        renterUserId: null
      });

      // 4. Pay the host
      await addHostBalance(session.ownerUserId, finalBalance);

      // Refresh balance
      if (user) {
        getUserBalance(user.uid).then(bal => setHostBalance(bal));
      }

      alert(`Rental session stopped successfully! You earned: ৳ ${finalBalance.toFixed(2)} Tk.`);
    } catch (err: any) {
      alert('Failed to exit rental: ' + err.message);
    }
  };

  // ── Terminate / Claim Violation (when host PC goes offline) ──
  const handleTerminateViolation = async (session: RentalSessionData) => {
    if (!confirm('Mark session as failed? The host went offline early. No payments will be sent to the host for this session.')) return;
    
    try {
      // 1. Stop in RTDB
      await stopActiveRentalSessionRTDB(session.deviceId, session.id!, 'cancelled');

      // 2. Update Firestore
      await updateRentalSessionFirestore(session.id!, {
        status: 'cancelled',
        earnedBalance: 0,
        isViolated: true,
        endTime: Date.now()
      });

      // 3. Update device in Firestore
      await updateDoc(doc(db, 'devices', session.deviceId), {
        rentalStatus: 'idle',
        rentalSessionId: null,
        renterUserId: null
      });

      alert('Session terminated. Host was penalized for turning off their PC early. Earned balance: ৳ 0 Tk.');
    } catch (err: any) {
      alert('Termination failed: ' + err.message);
    }
  };

  const myRentalDevices = devices.filter(d => d.type === 'rental' && d.ownerId === user?.uid);

  // Live running earnings calculation for the host balance panel
  const hostRunningEarnings = Object.values(liveSessions)
    .filter(session => {
      const matchedRental = hostRentals.find(r => r.id === session.sessionId);
      return session.status === 'running' && matchedRental;
    })
    .reduce((sum, session) => sum + (session.earnedBalance || 0), 0);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-300 font-sans pb-12">
        {/* Header */}
        <div className="border-b border-slate-900 bg-[#070b15]/60 backdrop-blur-md sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <Cpu className="w-6 h-6 text-green-400 animate-pulse" />
              {activeTab === 'host' ? 'Host Console — Rent Out PC' : 'Renter Console — Rent Remote PC'}
            </h1>
            <p className="text-slate-500 text-xs mt-1">
              {activeTab === 'host'
                ? 'Set up and manage your hosting devices, download the agent, and track your cash earnings.'
                : 'Find high-performance remote nodes, enter keys to connect, and run your clusters.'}
            </p>
          </div>

          {/* Toggle buttons removed to respect role segregation */}
        </div>

        {/* Content body */}
        <div className="max-w-[1600px] mx-auto px-6 mt-8">
          <AnimatePresence mode="wait">
            {activeTab === 'host' ? (
              <motion.div
                key="host-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-1 lg:grid-cols-3 gap-8"
              >
              {/* Left: Setup & Balance */}
              <div className="space-y-6 lg:col-span-1">
                {/* Earnings Panel */}
                <div className="relative group overflow-hidden bg-gradient-to-br from-[#0f172a] to-[#070b16] border border-slate-800 rounded-2xl p-6">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/10 rounded-full blur-3xl pointer-events-none" />
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Your Earnings</span>
                    <div className="p-2 bg-green-500/10 border border-green-500/20 rounded-xl">
                      <Wallet className="w-5 h-5 text-green-400" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <h3 className="text-4xl font-extrabold text-white tracking-tight flex items-baseline gap-2">
                      ৳ {hostBalance.toFixed(2)}
                      {hostRunningEarnings > 0 && (
                        <span className="text-xs text-green-400 font-semibold animate-pulse">
                          (+ ৳ {hostRunningEarnings.toFixed(2)} live)
                        </span>
                      )}
                    </h3>
                    <p className="text-slate-500 text-[11px] mt-1 font-medium">Accumulated from completed sessions</p>
                  </div>
                </div>
                <div className="mt-6 flex gap-3">
                  <button className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5">
                    Request Withdraw
                  </button>
                </div>

              {/* Instructions Panel */}
              <div className="bg-[#0a0f1e]/80 border border-slate-800 rounded-2xl p-6 space-y-4 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-bold text-base flex items-center gap-2">
                    <Info className="w-4 h-4 text-green-400" />
                    How to Host
                  </h3>
                  <div className="flex gap-1 p-0.5 bg-slate-950 border border-slate-900 rounded-lg">
                    <button
                      onClick={() => setHostingType('pc')}
                      className={`px-2.5 py-1 text-center text-[10px] font-bold rounded transition-all ${
                        hostingType === 'pc'
                          ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      PC (Win)
                    </button>
                    <button
                      onClick={() => setHostingType('mobile')}
                      className={`px-2.5 py-1 text-center text-[10px] font-bold rounded transition-all ${
                        hostingType === 'mobile'
                          ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      Mobile (Android)
                    </button>
                  </div>
                </div>

                {hostingType === 'pc' ? (
                  <>
                    <ol className="text-slate-400 text-xs space-y-3 list-decimal list-inside">
                      <li>
                        Download the <span className="text-green-400 font-semibold">Rental Agent</span> client on your Windows computer.
                      </li>
                      <li>Extract the ZIP and run <code className="text-slate-300 font-bold px-1 bg-slate-900 rounded">ClusterOSRentalAgent.exe</code>.</li>
                      <li>Click <span className="text-white font-medium">"Pair Device"</span> below and enter the pairing code displayed by your agent.</li>
                      <li>Provide your <span className="text-green-400 font-semibold">Device Code</span> to a renter. Keep the application online!</li>
                      <li>
                        <span className="text-red-400 font-semibold">Violation Rule:</span> If you shut down the agent or turn off your PC during a fixed-time session, you will forfeit earnings.
                      </li>
                    </ol>
                    <div className="pt-2">
                      <a
                        href="/downloads/ClusterOSRentalAgent.zip"
                        download
                        className="w-full py-3 bg-green-500 hover:bg-green-400 text-black font-bold text-xs rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-500/10"
                      >
                        <Download className="w-4 h-4" />
                        Download Windows Agent (.zip)
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <ol className="text-slate-400 text-xs space-y-3 list-decimal list-inside">
                      <li>
                        Download the <span className="text-green-400 font-semibold">Mobile Agent</span> app on your Android smartphone.
                      </li>
                      <li>Install the APK file and run the <span className="text-white font-medium">ClusterOS Mobile</span> application.</li>
                      <li>Click <span className="text-white font-medium">"Pair Device"</span> below and enter the pairing code displayed in the app.</li>
                      <li>Toggle on the <span className="text-green-400 font-semibold">Rental Hosting Console</span> switch inside the mobile app.</li>
                      <li>
                        <span className="text-red-400 font-semibold">Violation Rule:</span> Keep the app running in the foreground/background and connected to Wi-Fi. Exiting terminates active sessions and forfeits earnings.
                      </li>
                    </ol>
                    <div className="pt-2">
                      <a
                        href="/downloads/ClusterOSMobileAgent.zip"
                        download
                        className="w-full py-3 bg-blue-500 hover:bg-blue-400 text-black font-bold text-xs rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/10"
                      >
                        <Download className="w-4 h-4" />
                        Download Android Agent (.zip)
                      </a>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right: Active devices and history */}
            <div className="lg:col-span-2 space-y-6">
              {/* Linked Rental Devices */}
              <div className="bg-[#0a0f1e]/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-white font-bold text-base">Your Host Devices</h3>
                    <p className="text-slate-500 text-xs mt-0.5">Paired PCs and mobile phones hosting the rental agent</p>
                  </div>
                  <button 
                    onClick={() => setShowPairDialog(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-bold transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Pair Rental Agent
                  </button>
                </div>

                {myRentalDevices.length === 0 ? (
                  <div className="border border-dashed border-slate-800 rounded-xl py-10 px-4 text-center">
                    <Cpu className="w-10 h-10 text-slate-700 mx-auto mb-2" />
                    <p className="text-slate-500 text-xs">No rental agents paired yet.</p>
                    <p className="text-slate-600 text-[10px] mt-1">Download the client and click Pair above to begin.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {myRentalDevices.map(device => {
                      const m = metricsMap[device.deviceId];
                      const isOnline = m?.status === 'online' && (Date.now() - (m.timestamp ?? 0)) < 15000;
                      const isRented = device.rentalStatus === 'rented';
                      const metrics = m;

                      const session = hostRentals.find(s => s.id === device.rentalSessionId);
                      const liveData = device.rentalSessionId ? liveSessions[device.rentalSessionId] : null;
                      const elapsed = liveData ? liveData.elapsedSeconds : (session ? session.elapsedSeconds : 0);
                      const earned = liveData ? liveData.earnedBalance : (session ? session.earnedBalance : 0);

                      // Timer Calculation
                      let timerString = '00:00:00';
                      if (session) {
                        if (session.mode === 'fixed') {
                          const total = (session.durationMinutes || (session.durationHours * 60)) * 60;
                          const rem = Math.max(0, total - elapsed);
                          const t = TimeSpan.FromSeconds(rem);
                          timerString = `${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')}:${String(t.seconds).padStart(2, '0')}`;
                        } else {
                          const t = TimeSpan.FromSeconds(elapsed);
                          timerString = `${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')}:${String(t.seconds).padStart(2, '0')} (PAYG)`;
                        }
                      }

                      const isMobile = device.deviceId.startsWith('MOB');
                      const DeviceIcon = isMobile ? Smartphone : Cpu;

                      return (
                        <div key={device.deviceId} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <DeviceIcon className={`w-4 h-4 ${isMobile ? 'text-blue-400' : 'text-green-400'}`} />
                                <span className="text-white font-bold text-sm tracking-wide">{device.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
                                <span className="text-[10px] text-slate-500 font-semibold uppercase">{isOnline ? 'Online' : 'Offline'}</span>
                              </div>
                            </div>

                            <div className="mt-3 flex items-center justify-between text-xs border-b border-slate-950 pb-2 mb-2">
                              <span className="text-slate-500 font-medium">Device Key:</span>
                              <code className="text-green-400 font-bold font-mono">{device.deviceId}</code>
                            </div>

                            {/* Hardware Configuration Specs */}
                            {isOnline && metrics && (
                              <div className="mt-2.5 mb-2.5 p-2 bg-slate-950/60 rounded border border-slate-800/80 text-[10px] text-slate-400 space-y-1">
                                <div className="flex items-center gap-1"><DeviceIcon className="w-3 h-3 text-slate-500" /> <span className="font-mono text-slate-300 truncate max-w-[200px]">{metrics.cpu?.name || (isMobile ? 'Mobile Processor' : 'Processor')}</span></div>
                                {metrics.gpu?.name && <div className="flex items-center gap-1"><Server className="w-3 h-3 text-slate-500" /> <span className="font-mono text-slate-300 truncate max-w-[200px]">{metrics.gpu.name}</span></div>}
                                <div className="flex justify-between pt-0.5 border-t border-slate-900/60 text-[9px] text-slate-500">
                                  <span>RAM: <strong className="font-mono text-slate-300">{metrics.ram?.total?.toFixed(0) || '--'} GB</strong></span>
                                  <span>Disk: <strong className="font-mono text-slate-300">{metrics.disk?.total?.toFixed(0) || '--'} GB</strong></span>
                                </div>
                              </div>
                            )}

                            {/* Metrics if online */}
                            {isOnline && metrics && (
                              <div className="grid grid-cols-3 gap-2 py-1 text-[10px]">
                                <div>
                                  <span className="text-slate-500 block">CPU</span>
                                  <span className="text-slate-300 font-semibold">{metrics.cpu.total.toFixed(0)}%</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">RAM</span>
                                  <span className="text-slate-300 font-semibold">{metrics.ram.usedPercent.toFixed(0)}%</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Temp</span>
                                  <span className="text-slate-300 font-semibold">{metrics.temperatures.cpu}°C</span>
                                </div>
                              </div>
                            )}

                            {/* Active Session Info if Rented */}
                            {isRented && session && (
                              <div className="mt-2.5 p-2 bg-amber-500/5 border border-amber-500/10 rounded-lg text-[10px] space-y-1">
                                <div className="flex justify-between text-slate-500">
                                  <span>Time Remaining:</span>
                                  <span className="font-mono text-amber-400 font-bold">{timerString}</span>
                                </div>
                                <div className="flex justify-between text-slate-500">
                                  <span>Session Earnings:</span>
                                  <span className="font-mono text-green-400 font-bold">৳ {earned.toFixed(2)} Tk</span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="mt-4 pt-3 border-t border-slate-950 flex items-center justify-between gap-4">
                             <div className="flex items-center gap-2">
                               <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500">Status:</span>
                               {isRented ? (
                                 <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400 text-[10px] font-bold">
                                   <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                   RENTED
                                 </div>
                               ) : (
                                 <div className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-400 text-[10px] font-bold">
                                   IDLE
                                 </div>
                               )}
                             </div>

                             {isRented && (
                               <button
                                 onClick={() => {
                                   const activeSession = session || {
                                     id: device.rentalSessionId!,
                                     deviceId: device.deviceId,
                                     ownerUserId: user?.uid || '',
                                   } as RentalSessionData;
                                   handleHostStopRental(activeSession);
                                 }}
                                 className="px-2.5 py-1 bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-black border border-red-500/20 hover:border-red-500 text-[10px] font-bold rounded transition-all flex items-center gap-1.5"
                                 title="Stop hosting this session and return PC to IDLE"
                               >
                                 <Square className="w-3 h-3 fill-current" />
                                 Exit Rental
                               </button>
                             )}

                             {!isRented && (
                               <button
                                 onClick={() => handleRemoveDevice(device.deviceId)}
                                 className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 hover:text-red-300 text-[10px] font-bold rounded transition-all flex items-center gap-1.5"
                                 title="Unpair and remove this device from hosting pool"
                               >
                                 <Trash2 className="w-3 h-3" />
                                 {isMobile ? 'Remove Phone' : 'Remove PC'}
                               </button>
                             )}
                           </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Hosting History */}
              <div className="bg-[#0a0f1e]/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl">
                <h3 className="text-white font-bold text-base mb-4 flex items-center gap-2">
                  <History className="w-4 h-4 text-green-400" />
                  Host Rentals History
                </h3>

                {hostRentals.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 text-xs">
                    No hosting history recorded yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-500 font-semibold">
                          <th className="py-2 pb-3">Device</th>
                          <th className="py-2 pb-3">Renter</th>
                          <th className="py-2 pb-3">Duration</th>
                          <th className="py-2 pb-3">Rate</th>
                          <th className="py-2 pb-3 text-right">Earned</th>
                          <th className="py-2 pb-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40">
                        {hostRentals.map(session => {
                          const elapsed = session.status === 'running' && liveSessions[session.id!] 
                            ? liveSessions[session.id!].elapsedSeconds 
                            : session.elapsedSeconds;
                          
                          const t = TimeSpan.FromSeconds(elapsed);
                          const durationText = `${t.hours}h ${t.minutes}m`;

                          const earned = session.status === 'running' && liveSessions[session.id!]
                            ? liveSessions[session.id!].earnedBalance
                            : session.earnedBalance;

                          return (
                            <tr key={session.id} className="text-slate-300 hover:bg-slate-900/20">
                              <td className="py-3 font-semibold">{session.deviceName}</td>
                              <td className="py-3 text-slate-500">{session.renterEmail}</td>
                              <td className="py-3">{durationText}</td>
                              <td className="py-3">৳{session.hourlyRate}/hr</td>
                              <td className="py-3 text-right text-green-400 font-bold">৳{earned.toFixed(2)}</td>
                              <td className="py-3 text-right">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase ${
                                  session.status === 'completed' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                                  session.status === 'running' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse' :
                                  'bg-red-500/10 text-red-400 border border-red-500/20'
                                }`}>
                                  {session.status === 'cancelled' && session.isViolated ? 'VIOLATED' : session.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="renter-tab"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            {/* Left: Rent PC Form */}
            <div className="bg-[#0a0f1e]/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl lg:col-span-1 h-fit space-y-5">
              <div>
                <h3 className="text-white font-bold text-base flex items-center gap-1.5">
                  <Play className="w-4 h-4 text-green-400" />
                  Rent a Remote PC
                </h3>
                <p className="text-slate-500 text-xs mt-1">Enter host device key to establish connection</p>
              </div>

              {/* Form Input fields */}
              <div className="space-y-4">
                <div>
                  <label className="text-slate-400 text-xs font-bold uppercase tracking-wider block mb-1.5">Device Code / Key</label>
                  <input
                    type="text"
                    value={targetDeviceCode}
                    onChange={e => setTargetDeviceCode(e.target.value)}
                    placeholder="E.g. PC-RNT-A1B2C3"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-green-500/40 font-mono transition-colors"
                  />
                </div>

                <div>
                  <label className="text-slate-400 text-xs font-bold uppercase tracking-wider block mb-1.5">Hourly Rate (৳ Tk)</label>
                  <input
                    type="number"
                    value={hourlyRate}
                    onChange={e => setHourlyRate(parseInt(e.target.value) || 100)}
                    placeholder="100"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-green-500/40 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-slate-400 text-xs font-bold uppercase tracking-wider block mb-1.5">Rental Duration</label>
                  <select
                    value={duration}
                    onChange={e => setDuration(parseInt(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-green-500/40 transition-colors"
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes</option>
                    <option value={45}>45 Minutes</option>
                    <option value={60}>1 Hour (60 Min)</option>
                    <option value={120}>2 Hours (120 Min)</option>
                    <option value={-1}>Pay As You Go (No Timer)</option>
                  </select>
                </div>

                {/* Hardware Spec Preview Card */}
                {previewLoading && (
                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg flex items-center justify-center gap-2">
                    <Loader2 className="w-4.5 h-4.5 animate-spin text-green-400" />
                    <span className="text-slate-400 text-[11px] font-medium">Fetching specifications...</span>
                  </div>
                )}

                {!previewLoading && previewMetrics && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2.5 shadow-xl relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 w-16 h-16 bg-green-500/5 rounded-full blur-xl pointer-events-none" />
                    <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-1">
                      <span className="text-white font-extrabold text-[10px] tracking-wider flex items-center gap-1.5">
                        <Server className="w-3.5 h-3.5 text-green-400" />
                        HOST CONFIGURATION
                      </span>
                      <span className="px-2 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 text-[9px] font-bold rounded animate-pulse">
                        ONLINE
                      </span>
                    </div>

                    <div className="space-y-2 text-xs text-slate-400">
                      <div>
                        <span className="text-slate-500 block text-[9px] font-bold uppercase tracking-wider">Processor (CPU)</span>
                        <span className="text-slate-200 font-semibold font-mono">{previewMetrics.cpu?.name || 'Standard Processor'}</span>
                      </div>
                      {previewMetrics.gpu?.name && (
                        <div>
                          <span className="text-slate-500 block text-[9px] font-bold uppercase tracking-wider">Graphics Card (GPU)</span>
                          <span className="text-slate-200 font-semibold font-mono">{previewMetrics.gpu.name}</span>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4 pt-1">
                        <div>
                          <span className="text-slate-500 block text-[9px] font-bold uppercase tracking-wider">Total Memory (RAM)</span>
                          <span className="text-slate-200 font-semibold font-mono">{previewMetrics.ram?.total ? `${previewMetrics.ram.total.toFixed(0)} GB` : '-- GB'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] font-bold uppercase tracking-wider">Storage Capacity</span>
                          <span className="text-slate-200 font-semibold font-mono">{previewMetrics.disk?.total ? `${previewMetrics.disk.total.toFixed(0)} GB SSD` : '-- GB'}</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {!previewLoading && targetDeviceCode.trim().length >= 6 && !previewMetrics && (
                  <div className="p-3 bg-red-500/5 border border-red-500/10 text-red-400 rounded-lg text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-500 animate-pulse flex-shrink-0" />
                    <span>Machine is offline. Renting requires host agent to be online.</span>
                  </div>
                )}

                {rentError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs font-medium flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{rentError}</span>
                  </div>
                )}

                {rentSuccess && (
                  <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg text-xs font-medium flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    <span>Session initiated successfully!</span>
                  </div>
                )}

                <button
                  onClick={handleStartRental}
                  disabled={rentLoading || !targetDeviceCode}
                  className="w-full py-3 bg-green-500 hover:bg-green-400 disabled:bg-slate-800 disabled:text-slate-600 text-black font-extrabold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-green-500/10"
                >
                  {rentLoading ? 'Connecting...' : 'Initiate Rental Session'}
                </button>
              </div>
            </div>

            {/* Right: Active Sessions & History */}
            <div className="lg:col-span-2 space-y-6">
              {/* Active Rented Machines */}
              <div className="bg-[#0a0f1e]/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl">
                <h3 className="text-white font-bold text-base mb-4 flex items-center gap-2">
                  <Play className="w-4 h-4 text-green-400 animate-pulse" />
                  Your Active Rented Machines
                </h3>

                {renterRentals.filter(s => s.status === 'running').length === 0 ? (
                  <div className="border border-dashed border-slate-800 rounded-xl py-12 px-4 text-center">
                    <Clock className="w-10 h-10 text-slate-700 mx-auto mb-2" />
                    <p className="text-slate-500 text-xs">No active rented machines right now.</p>
                    <p className="text-slate-600 text-[10px] mt-1">Submit the rental form to connect to a host machine.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {renterRentals.filter(s => s.status === 'running').map(session => {
                      const liveData = liveSessions[session.id!];
                      const elapsed = liveData ? liveData.elapsedSeconds : session.elapsedSeconds;
                      const earned = liveData ? liveData.earnedBalance : session.earnedBalance;

                      // Connection indicator
                      const m = rentedDevicesMetrics[session.deviceId];
                      const isOnline = m?.status === 'online' && (Date.now() - (m.timestamp ?? 0)) < 15000;

                      // Timer Calculation
                      let timerString = '00:00:00';
                      if (session.mode === 'fixed') {
                        const total = (session.durationMinutes || (session.durationHours * 60)) * 60;
                        const rem = Math.max(0, total - elapsed);
                        const t = TimeSpan.FromSeconds(rem);
                        timerString = `${t.hours.toString().padStart(2, '0')}:${t.minutes.toString().padStart(2, '0')}:${t.seconds.toString().padStart(2, '0')}`;
                      } else {
                        const t = TimeSpan.FromSeconds(elapsed);
                        timerString = `${t.hours.toString().padStart(2, '0')}:${t.minutes.toString().padStart(2, '0')}:${t.seconds.toString().padStart(2, '0')}`;
                      }

                      return (
                        <div key={session.id} className="relative overflow-hidden bg-slate-900/60 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-6">
                          <div className="space-y-2 flex-1 w-full">
                            <div className="flex items-center justify-between">
                              <h4 className="text-white font-extrabold text-base tracking-wide flex items-center gap-2">
                                {session.deviceName}
                                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-red-500 animate-ping'}`} />
                              </h4>
                              <code className="text-slate-500 text-xs font-mono">{session.deviceId}</code>
                            </div>

                            <div className="flex items-center gap-4 text-xs">
                              <div>
                                <span className="text-slate-500 block">Rate:</span>
                                <span className="text-slate-300 font-semibold">৳ {session.hourlyRate}/hr</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block">Mode:</span>
                                <span className="text-slate-300 font-semibold uppercase">{session.mode.replace(/_/g, ' ')}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block">Host Link Status:</span>
                                <span className={isOnline ? 'text-green-400 font-semibold' : 'text-red-400 font-bold animate-pulse'}>
                                  {isOnline ? 'CONNECTED' : 'DISCONNECTED'}
                                </span>
                              </div>
                            </div>

                            {/* Warning if host is disconnected */}
                            {!isOnline && (
                              <div className="mt-3 p-2 bg-red-950/20 border border-red-900/20 text-red-400 rounded text-[10px] font-medium flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>Host is offline! Terminate the session if they don't reconnect to penalize them.</span>
                              </div>
                            )}
                          </div>

                          {/* Clock & Balance Counter */}
                          <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 border-slate-800/60 pt-4 md:pt-0">
                            <div className="text-right">
                              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                                {session.mode === 'fixed' ? 'REMAINING' : 'ELAPSED'}
                              </span>
                              <span className={`font-mono text-xl font-bold ${session.mode === 'fixed' ? 'text-amber-400' : 'text-green-400'}`}>
                                {timerString}
                              </span>
                            </div>

                            <div className="text-right">
                              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">COST</span>
                              <span className="text-green-400 text-xl font-extrabold block">
                                ৳ {earned.toFixed(2)}
                              </span>
                            </div>

                            {isOnline ? (
                              <button
                                onClick={() => handleStopRental(session)}
                                className="p-3 bg-red-500 hover:bg-red-400 text-black font-bold rounded-lg transition-colors flex items-center justify-center"
                                title="Stop Session & Checkout"
                              >
                                <Square className="w-4 h-4 fill-current" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleTerminateViolation(session)}
                                className="p-3 bg-slate-900 hover:bg-slate-800 border border-red-500/20 hover:border-red-500 text-red-400 font-bold rounded-lg transition-all flex items-center justify-center"
                                title="Terminate (Host Offline Penalty)"
                              >
                                <ShieldAlert className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Rented PCs History */}
              <div className="bg-[#0a0f1e]/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl">
                <h3 className="text-white font-bold text-base mb-4 flex items-center gap-2">
                  <History className="w-4 h-4 text-green-400" />
                  Your Rent History
                </h3>

                {renterRentals.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 text-xs">
                    No rental history recorded yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-500 font-semibold">
                          <th className="py-2 pb-3">Device Key</th>
                          <th className="py-2 pb-3">Name</th>
                          <th className="py-2 pb-3">Duration</th>
                          <th className="py-2 pb-3">Rate</th>
                          <th className="py-2 pb-3 text-right">Cost</th>
                          <th className="py-2 pb-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40">
                        {renterRentals.map(session => {
                          const elapsed = session.status === 'running' && liveSessions[session.id!]
                            ? liveSessions[session.id!].elapsedSeconds
                            : session.elapsedSeconds;
                          
                          const t = TimeSpan.FromSeconds(elapsed);
                          const durationText = `${t.hours}h ${t.minutes}m`;

                          const cost = session.status === 'running' && liveSessions[session.id!]
                            ? liveSessions[session.id!].earnedBalance
                            : session.earnedBalance;

                          return (
                            <tr key={session.id} className="text-slate-300 hover:bg-slate-900/20">
                              <td className="py-3 font-mono font-semibold text-slate-500">{session.deviceId}</td>
                              <td className="py-3 font-semibold">{session.deviceName}</td>
                              <td className="py-3">{durationText}</td>
                              <td className="py-3">৳{session.hourlyRate}/hr</td>
                              <td className="py-3 text-right font-bold text-white">৳{cost.toFixed(2)}</td>
                              <td className="py-3 text-right">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase ${
                                  session.status === 'completed' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                                  session.status === 'running' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse' :
                                  'bg-red-500/10 text-red-400 border border-red-500/20'
                                }`}>
                                  {session.status === 'cancelled' && session.isViolated ? 'VIOLATED' : session.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dialog for Pairing Agent */}
      <AnimatePresence>
        {showPairDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0a0f1e] border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl relative"
            >
              <h3 className="text-white font-bold text-lg mb-2">Pair Rental Agent</h3>
              <p className="text-slate-500 text-xs mb-4">
                Enter the pair code displayed on the Rental Agent GUI to link it to your hosting dashboard.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block mb-1">Agent Pair Code</label>
                  <input
                    type="text"
                    value={pairCode}
                    onChange={e => setPairCode(e.target.value)}
                    placeholder="E.g. XK7M9P"
                    maxLength={6}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-green-400 placeholder-slate-700 font-mono font-bold tracking-wider focus:outline-none focus:border-green-500/40 uppercase transition-colors"
                  />
                </div>

                <div>
                  <label className="text-slate-400 text-[10px] font-bold tracking-wider uppercase block mb-1">Friendly Display Name (Optional)</label>
                  <input
                    type="text"
                    value={deviceName}
                    onChange={e => setDeviceName(e.target.value)}
                    placeholder="E.g. Home Server PC"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-green-500/40 transition-colors"
                  />
                </div>

                {pairError && (
                  <div className="text-red-400 text-xs font-semibold p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                    {pairError}
                  </div>
                )}

                {pairSuccess && (
                  <div className="text-green-400 text-xs font-semibold p-2.5 bg-green-500/10 border border-green-500/20 rounded-lg">
                    ✓ Rental agent paired successfully!
                  </div>
                )}

                <div className="flex gap-3 justify-end pt-2">
                  <button
                    onClick={() => {
                      setShowPairDialog(false);
                      setPairError('');
                      setPairCode('');
                      setDeviceName('');
                    }}
                    className="px-4 py-2 border border-slate-800 hover:bg-slate-900 text-slate-400 hover:text-white rounded-lg text-xs font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePairRental}
                    disabled={pairLoading || pairCode.length < 6}
                    className="px-4 py-2 bg-green-500 hover:bg-green-400 disabled:bg-slate-800 disabled:text-slate-600 text-black font-bold rounded-lg text-xs transition-colors"
                  >
                    {pairLoading ? 'Pairing...' : 'Pair Agent'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
        </div>
      </div>
  );
}

// ── TimeSpan Helper Class ──
class TimeSpan {
  constructor(
    public hours: number,
    public minutes: number,
    public seconds: number
  ) {}

  static FromSeconds(totalSeconds: number) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return new TimeSpan(hours, minutes, seconds);
  }
}
