import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import { cn } from '../lib/utils';
import { AppTab } from '../types';
import { Home, Calendar, Scan, Info, Menu, X, Bell, Moon, Star, ExternalLink } from 'lucide-react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useSchedule } from '../hooks/useSchedule';
import { addDays, format, isAfter } from 'date-fns';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, activeTab, onTabChange }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('isDarkMode') === 'true');
  const [isNotificationsEnabled, setIsNotificationsEnabled] = useState(() => localStorage.getItem('isNotificationsEnabled') !== 'false');
  const { schedule } = useSchedule(new Date());

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('isDarkMode', isDarkMode.toString());
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('isNotificationsEnabled', isNotificationsEnabled.toString());
  }, [isNotificationsEnabled]);

  const handleNotificationToggle = async () => {
    const newState = !isNotificationsEnabled;
    setIsNotificationsEnabled(newState);
    if (newState) {
      try {
        const status = await LocalNotifications.checkPermissions();
        if (status.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }
      } catch (error) {
        console.error('Error requesting notification permission:', error);
      }
    }
  };

  useEffect(() => {
    const scheduleAllPrayers = async () => {
      if (!isNotificationsEnabled || !schedule) {
        try { await LocalNotifications.cancel({ notifications: (await LocalNotifications.getPending()).notifications }); } catch (e) {}
        return;
      }

      try {
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length > 0) {
          await LocalNotifications.cancel({ notifications: pending.notifications });
        }

        const now = new Date();
        const notificationsToSchedule = [];

        // Schedule for the next 7 days safely
        for (let i = 0; i < 7; i++) {
          const targetDate = addDays(now, i);
          const dateKey = format(targetDate, 'yyyy-MM-dd');
          
          const daySchedule = schedule.days.find(d => d.dateStr.startsWith(dateKey));

          if (daySchedule) {
            daySchedule.prayers.forEach(prayer => {
              const createNotification = (time: string, type: 'Athan' | 'Iqama') => {
                if (!time || time === '-') return;
                const [hours, minutes] = time.split(':').map(Number);
                if (isNaN(hours) || isNaN(minutes)) return;

                const scheduleDate = new Date(targetDate);
                // Fire exactly 20 seconds before the prayer time
                scheduleDate.setHours(hours, minutes, -20, 0);

                if (isAfter(scheduleDate, now)) {
                  const displayName = (prayer.name === 'Dhuhr' && targetDate.getDay() === 5) ? 'Jumu\'ah' : prayer.name;
                  notificationsToSchedule.push({
                    title: type === 'Athan' ? `${displayName} Athan` : `${displayName} Iqama`,
                    body: `The ${type} for ${displayName} is at ${time}.`,
                    id: Math.floor(Math.random() * 1000000) + scheduleDate.getTime() % 10000,
                    schedule: { at: scheduleDate },
                    sound: 'beep.wav',
                    smallIcon: 'ic_stat_name'
                  });
                }
              };

              createNotification(prayer.athan, 'Athan');
              
              if (prayer.iqama) {
                const iqamas = prayer.iqama.split('/').map(t => t.trim());
                iqamas.forEach(t => createNotification(t, 'Iqama'));
              }
            });
          }
        }

        if (notificationsToSchedule.length > 0) {
          for (let i = 0; i < notificationsToSchedule.length; i += 50) {
            await LocalNotifications.schedule({
              notifications: notificationsToSchedule.slice(i, i + 50)
            });
          }
          console.log(`Scheduled ${notificationsToSchedule.length} prayer notifications.`);
        }
      } catch (error) {
        console.error('Error in batch scheduling notifications:', error);
      }
    };

    scheduleAllPrayers();
  }, [isNotificationsEnabled, schedule]);

  return (
    <div className="min-h-screen pb-24">
      <header className="fixed top-0 w-full z-50 glass-effect border-b border-outline-variant/10">
        <div className="flex items-center justify-between px-6 h-16 max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <Menu className="w-6 h-6 text-primary cursor-pointer hover:opacity-80" onClick={() => setIsSidebarOpen(true)} />
            <span className="font-headline font-extrabold text-xl text-primary">ISOC Prayer Room</span>
          </div>
          <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center overflow-hidden border-2 border-primary/10">
            <img 
              alt="ISOC Logo" 
              className="w-full h-full object-cover"
              src="/images/ISOC.png"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      </header>

      <main className="pt-20 px-6 max-w-2xl mx-auto">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-safe pt-2 h-20 glass-effect z-50 rounded-t-2xl shadow-[0_-4px_24px_rgba(27,28,26,0.06)]">
        <NavItem 
          icon={<Home className="w-6 h-6" />} 
          label="Home" 
          active={activeTab === 'home'} 
          onClick={() => onTabChange('home')} 
        />
        <NavItem 
          icon={<Calendar className="w-6 h-6" />} 
          label="Schedule" 
          active={activeTab === 'schedule'} 
          onClick={() => onTabChange('schedule')} 
        />
        <NavItem 
          icon={<Scan className="w-6 h-6" />} 
          label="Scan" 
          active={activeTab === 'scan'} 
          onClick={() => onTabChange('scan')} 
        />
        <NavItem 
          icon={<Info className="w-6 h-6" />} 
          label="Info" 
          active={activeTab === 'info'} 
          onClick={() => onTabChange('info')} 
        />
      </nav>

      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/50 z-[60] backdrop-blur-sm"
            />
            
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 h-full w-3/4 max-w-sm bg-surface-container-lowest z-[70] shadow-2xl overflow-y-auto"
            >
              <div className="p-6 space-y-8 pb-24">
                <div className="flex items-center justify-between">
                  <h2 className="font-headline font-bold text-2xl text-primary">App Settings</h2>
                  <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-surface-container rounded-full transition-colors">
                    <X className="w-6 h-6 text-on-surface" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="space-y-3">
                    <h3 className="font-headline font-semibold text-xs text-on-surface-variant uppercase tracking-wider">Preferences</h3>
                    <SidebarItem 
                      icon={<Moon />} 
                      label="Dark Mode" 
                      onClick={() => setIsDarkMode(!isDarkMode)}
                      trailing={<Toggle isOn={isDarkMode} />}
                    />
                    <SidebarItem 
                      icon={<Bell />} 
                      label="Notifications" 
                      onClick={handleNotificationToggle}
                      trailing={<Toggle isOn={isNotificationsEnabled} />}
                    />
                  </div>

                  <div className="space-y-3">
                    <h3 className="font-headline font-semibold text-xs text-on-surface-variant uppercase tracking-wider">About</h3>
                    <a 
                      href={Capacitor.getPlatform() === 'ios'
                        ? 'https://apps.apple.com/app/isoc-prayer-room/id{YOUR_APP_ID}'
                        : 'https://play.google.com/store/apps/details?id=com.surreyisoc.app'
                      } 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="block"
                    >
                      <SidebarItem 
                        icon={<Star />} 
                        label="Rate 5 Stars & Feedback" 
                        trailing={<ExternalLink className="w-4 h-4 text-on-surface-variant/50" />}
                      />
                    </a>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

const Toggle = ({ isOn }: { isOn: boolean }) => (
  <div className={cn(
    "w-10 h-6 rounded-full flex items-center p-1 transition-colors duration-300", 
    isOn ? "bg-primary" : "bg-outline-variant/30"
  )}>
    <div className={cn(
      "w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300", 
      isOn ? "translate-x-4" : "translate-x-0"
    )} />
  </div>
);

const SidebarItem = ({ icon, label, trailing, onClick }: { icon: React.ReactNode, label: string, trailing?: React.ReactNode, onClick?: () => void }) => (
  <button 
    onClick={onClick}
    className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-surface-container transition-colors text-on-surface"
  >
    <div className="flex items-center gap-4">
      <div className="text-primary w-5 h-5 flex items-center justify-center">
        {React.cloneElement(icon as React.ReactElement, { className: "w-5 h-5" })}
      </div>
      <span className="font-body font-medium text-sm">{label}</span>
    </div>
    {trailing && <div>{trailing}</div>}
  </button>
);

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick }) => {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center px-4 py-1.5 transition-all duration-200 active:scale-90",
        active 
          ? "bg-secondary-container text-primary rounded-full" 
          : "text-on-surface/50 hover:text-primary"
      )}
    >
      {icon}
      <span className="font-body font-medium text-[10px] uppercase tracking-widest mt-0.5">{label}</span>
    </button>
  );
};
