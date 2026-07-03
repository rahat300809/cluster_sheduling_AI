'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAppStore } from '@/store/appStore';
import {
  LayoutDashboard, Monitor, Activity, Terminal, Network,
  Briefcase, BarChart3, Settings, LogOut, ChevronLeft,
  ChevronRight, Zap, Bell, Search, Menu, X, Download,
  Globe, MapPin, Banknote, Smartphone
} from 'lucide-react';

type NavItem = { href: string; icon: React.ElementType; label: string; exact?: boolean };

const navItems: NavItem[] = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { href: '/devices', icon: Monitor, label: 'Devices' },
  { href: '/processes', icon: Activity, label: 'Processes' },
  { href: '/commands', icon: Terminal, label: 'Commands' },
  { href: '/clusters', icon: Network, label: 'Clusters' },
  { href: '/jobs', icon: Briefcase, label: 'Jobs' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/rentals', icon: Banknote, label: 'Rentals' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebar, devices, metricsMap } = useAppStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [portalRole, setPortalRole] = useState<'developer' | 'host'>('developer');

  useEffect(() => {
    const role = localStorage.getItem('portal_role');
    if (role === 'host') {
      setPortalRole('host');
      // Redirect hosts to /rentals if they are on any other page
      if (!pathname.startsWith('/rentals') && !pathname.startsWith('/settings')) {
        router.replace('/rentals');
      }
    } else {
      setPortalRole('developer');
    }
  }, [pathname, router]);

  const onlineCount = devices.filter(d => metricsMap[d.deviceId]?.status === 'online').length;

  const isActive = (item: NavItem) => {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  };

  const filteredNavItems = navItems.filter(item => {
    if (portalRole === 'host') {
      return item.href === '/rentals' || item.href === '/settings';
    }
    return true;
  });

  return (
    <div className="flex h-screen bg-[#020617] overflow-hidden">
      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        animate={{ width: sidebarCollapsed ? 72 : 240 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className={`
          hidden lg:flex flex-col border-r border-slate-800 bg-[#0a0f1e]/90 backdrop-blur-xl
          flex-shrink-0 relative z-10
        `}
      >
        <SidebarContent
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          navItems={filteredNavItems}
          isActive={isActive}
          onlineCount={onlineCount}
        />
      </motion.aside>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.aside
            initial={{ x: -240 }}
            animate={{ x: 0 }}
            exit={{ x: -240 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }} 
            className="fixed left-0 top-0 h-full w-60 border-r border-slate-800 bg-[#0a0f1e] z-50 lg:hidden flex flex-col"
          >
            <SidebarContent
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
              navItems={filteredNavItems}
              isActive={isActive}
              onlineCount={onlineCount}
              isMobile
            />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-14 border-b border-slate-800 flex items-center gap-4 px-4 bg-[#020617]/80 backdrop-blur-xl flex-shrink-0">
          {/* Mobile menu */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden text-slate-400 hover:text-white p-1"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {/* Search */}
          <div className="flex-1 max-w-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search devices, jobs..."
                className="w-full pl-9 pr-4 py-1.5 bg-slate-900/60 border border-slate-800 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-green-500/40 transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Online badge */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-medium text-green-400">{onlineCount} Online</span>
            </div>

            {/* Notifications */}
            <button className="relative p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-green-400 rounded-full" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto flex flex-col justify-between">
          <div className="flex-grow">
            <motion.div
              key={pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.08, ease: 'easeOut' }}
              className="p-6"
            >
              {children}
            </motion.div>
          </div>

          {/* Elegant Developer Footer */}
          <footer className="mt-auto border-t border-slate-900 bg-[#070b16] py-6 px-6 sm:px-8 flex flex-col md:flex-row items-center justify-between gap-6 flex-shrink-0">
            <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-green-500 to-blue-500 rounded-xl blur opacity-30 group-hover:opacity-60 transition duration-300"></div>
                <img
                  src="/rahat.jpg"
                  alt="Rahat Mahamud"
                  className="relative w-14 h-14 rounded-xl object-cover border border-slate-800 shadow-md"
                />
              </div>
              <div>
                <h4 className="text-white font-bold text-sm tracking-wide">Rahat Mahamud</h4>
                <p className="text-slate-400 text-xs font-medium">CSE Undergraduate Student & Software Developer</p>
                <div className="flex items-center justify-center sm:justify-start gap-3 mt-1 text-slate-500 text-[10px] font-medium">
                  <span>Computer Science & Engineering</span>
                  <span>•</span>
                  <span>Daffodil International University</span>
                </div>
                <div className="flex items-center justify-center sm:justify-start gap-1 text-[10px] text-slate-500 mt-0.5">
                  <MapPin className="w-3 h-3 text-slate-600" />
                  <span>Bangladesh</span>
                </div>
              </div>
            </div>

            {/* Social Icons & Portfolio */}
            <div className="flex flex-col items-center md:items-end gap-2.5">
              <div className="flex items-center gap-2">
                <a
                  href="https://protfolio3.web.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/60 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white rounded-lg text-[10px] font-bold transition-all"
                >
                  <Globe className="w-3 h-3 text-green-400" />
                  Portfolio Website
                </a>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href="https://github.com/rahat300809"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all"
                  title="GitHub"
                >
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                </a>
                <a
                  href="https://www.linkedin.com/in/rahat300809"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-blue-400 flex items-center justify-center transition-all"
                  title="LinkedIn"
                >
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.779-1.75-1.75s.784-1.75 1.75-1.75 1.75.779 1.75 1.75-.784 1.75-1.75 1.75zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                  </svg>
                </a>
                <a
                  href="https://facebook.com/yourusername"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-blue-600 flex items-center justify-center transition-all"
                  title="Facebook"
                >
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/>
                  </svg>
                </a>
                <a
                  href="https://wa.me/8801XXXXXXXXX"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-green-500 flex items-center justify-center transition-all"
                  title="WhatsApp"
                >
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.513 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.37 9.864-9.799.002-2.63-1.023-5.101-2.885-6.965C16.528 1.977 14.07 .953 11.5.953c-5.44 0-9.866 4.372-9.87 9.802 0 1.714.453 3.39 1.31 4.88l-.994 3.634 3.732-.966zm11.367-7.46c-.08-.13-.292-.21-.615-.372-.323-.162-1.913-.944-2.21-1.053-.298-.11-.514-.162-.73.162-.215.324-.834 1.053-1.022 1.269-.188.215-.376.242-.699.08-1.588-.79-2.735-1.378-3.812-3.228-.286-.49-.1-.763.097-.959.178-.178.324-.376.486-.565.162-.188.215-.323.323-.539.108-.215.054-.404-.027-.565-.08-.162-.73-1.758-1.002-2.414-.265-.637-.534-.551-.73-.561-.188-.01-.403-.01-.617-.01-.215 0-.565.081-.861.404-.296.324-1.13 1.104-1.13 2.693 0 1.589 1.157 3.125 1.319 3.34 1.62 2.146 3.648 3.564 6.729 4.748.733.281 1.305.449 1.75.59.736.233 1.406.2 1.936.12.59-.09 1.81-.741 2.064-1.455.253-.715.253-1.328.178-1.455z"/>
                  </svg>
                </a>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  collapsed,
  onToggle,
  navItems,
  isActive,
  onlineCount,
  isMobile = false,
}: {
  collapsed: boolean;
  onToggle: () => void;
  navItems: NavItem[];
  isActive: (item: NavItem) => boolean;
  onlineCount: number;
  isMobile?: boolean;
}) {
  return (
    <>
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 h-14 border-b border-slate-800 flex-shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center flex-shrink-0">
          <Network className="w-4 h-4 text-green-400" />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
            >
              <span className="font-bold text-white text-sm">ClusterOS</span>
              <div className="text-[10px] text-slate-500">v1.0.0</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapse toggle - desktop only */}
        {!isMobile && (
          <button
            onClick={onToggle}
            className="ml-auto text-slate-600 hover:text-slate-400 transition-colors flex-shrink-0"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {navItems.map(item => {
          const active = isActive(item);
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group
                  ${active
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }
                  ${collapsed ? 'justify-center' : ''}
                `}
              >
                <item.icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-green-400' : ''}`} />
                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-sm font-medium whitespace-nowrap"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
                {active && !collapsed && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400" />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`p-3 border-t border-slate-800 flex flex-col gap-1.5 ${collapsed ? 'items-center' : ''}`}>
        {collapsed ? (
          <>
            <a
              href="/downloads/ClusterOSAgent.zip"
              download
              title="Download Windows PC Agent (.zip)"
              className="flex items-center justify-center w-10 h-10 rounded-lg text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-all duration-200"
            >
              <Download className="w-4 h-4 flex-shrink-0" />
            </a>
            <a
              href="/downloads/ClusterOSMobileAgent.zip"
              download
              title="Download Android Mobile Agent (.zip)"
              className="flex items-center justify-center w-10 h-10 rounded-lg text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-all duration-200"
            >
              <Smartphone className="w-4 h-4 flex-shrink-0" />
            </a>
          </>
        ) : (
          <>
            <a
              href="/downloads/ClusterOSAgent.zip"
              download
              title="Download Windows PC Agent (.zip)"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-all duration-200 w-full"
            >
              <Download className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs font-semibold whitespace-nowrap">Download Agent (PC)</span>
            </a>
            <a
              href="/downloads/ClusterOSMobileAgent.zip"
              download
              title="Download Android Mobile Agent (.zip)"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-all duration-200 w-full"
            >
              <Smartphone className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs font-semibold whitespace-nowrap">Download Agent (Mobile)</span>
            </a>
          </>
        )}

        <button
          onClick={() => signOut(auth)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 w-full ${collapsed ? 'justify-center' : ''}`}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm font-medium"
              >
                Sign Out
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </>
  );
}
