import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { format, addDays, isSameDay } from 'date-fns';
import { MOCK_PRAYERS } from '../constants';
import { Bell, Sun, CloudSun, Moon, CloudMoon, Info, Heart, Loader2, Building2, Users, Navigation } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSchedule } from '../hooks/useSchedule';
import { useTodayPrayers } from '../hooks/useTodayPrayers';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

interface HomeScreenProps {
  onViewCalendar: () => void;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onViewCalendar, selectedDate, onDateChange }) => {
  const { schedule, loading, error } = useSchedule(selectedDate);
  const { data: livePrayers, loading: liveLoading } = useTodayPrayers();

  // For today: prefer live data from masjidbox.com
  // For other dates: fall back to the uploaded monthly schedule or mock data
  const isViewingToday = isSameDay(selectedDate, new Date());
  const todaySchedule = (isViewingToday && livePrayers)
    ? livePrayers
    : schedule?.days.find(p => p.dateStr === format(selectedDate, 'yyyy-MM-dd'))
      || MOCK_PRAYERS.find(p => isSameDay(p.date, selectedDate))
      || MOCK_PRAYERS[1];
  
  const [currentTime, setCurrentTime] = useState(new Date());
  const [jumuahConfig, setJumuahConfig] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const fetchConfig = async () => {
      try {
        const docRef = doc(db, 'configs', 'jumuah');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) setJumuahConfig(docSnap.data().locationId);
      } catch (e) {
        console.error("Config error:", e);
      }
    };
    fetchConfig();
    return () => clearInterval(timer);
  }, []);

  const parseMinutes = (value: string | undefined) => {
    if (!value || !value.includes(':')) return null;
    const [h, m] = value.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };

  const parseIqamaMinutes = (value: string | undefined) => {
    if (!value) return null;
    const candidates = value.split('/').map((part) => parseMinutes(part.trim())).filter((n): n is number => n !== null);
    return candidates.length > 0 ? candidates[0] : null;
  };

  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const prayerEvents = (todaySchedule?.prayers || []).map((prayer) => ({
    prayer,
    athanMinutes: parseMinutes(prayer.athan),
    iqamaMinutes: parseIqamaMinutes(prayer.iqama),
  }));

  const startedPrayerEvents = prayerEvents.filter(
    (event) => event.athanMinutes !== null && event.athanMinutes <= currentMinutes
  );
  const lastStartedPrayer = startedPrayerEvents.length > 0 ? startedPrayerEvents[startedPrayerEvents.length - 1] : null;

  let currentPrayer: typeof todaySchedule.prayers[number] | null = lastStartedPrayer?.prayer || null;
  let targetPrayer: typeof todaySchedule.prayers[number] | null = null;
  let countdownTarget: Date | null = null;
  let countdownLabel = 'Athan In';
  let heroSubLabel = 'Next';

  const firstPrayer = prayerEvents.find((event) => event.athanMinutes !== null);
  const firstPrayerAthan = firstPrayer?.athanMinutes ?? null;

  for (let i = 0; i < prayerEvents.length; i++) {
    const event = prayerEvents[i];
    if (event.athanMinutes === null) continue;

    // Before the next Athan: count down to Athan.
    if (currentMinutes < event.athanMinutes) {
      targetPrayer = event.prayer;
      countdownLabel = 'Athan In';
      heroSubLabel = 'Next';
      countdownTarget = new Date(currentTime);
      countdownTarget.setHours(Math.floor(event.athanMinutes / 60), event.athanMinutes % 60, 0, 0);
      break;
    }

    // After Athan and before Iqama: count down to Iqama for the same prayer.
    if (event.iqamaMinutes !== null && currentMinutes >= event.athanMinutes && currentMinutes < event.iqamaMinutes) {
      currentPrayer = event.prayer;
      targetPrayer = event.prayer;
      countdownLabel = 'Iqama In';
      heroSubLabel = 'Current';
      countdownTarget = new Date(currentTime);
      countdownTarget.setHours(Math.floor(event.iqamaMinutes / 60), event.iqamaMinutes % 60, 0, 0);
      break;
    }
  }

  // If after all prayer windows, count down to tomorrow's first Athan.
  if (!countdownTarget && firstPrayerAthan !== null && firstPrayer?.prayer) {
    targetPrayer = firstPrayer.prayer;
    countdownLabel = 'Athan In';
    heroSubLabel = 'Next';
    countdownTarget = addDays(new Date(currentTime), 1);
    countdownTarget.setHours(Math.floor(firstPrayerAthan / 60), firstPrayerAthan % 60, 0, 0);
  }

  const nextPrayer = targetPrayer;
  let timeLeftStr = '--:--:--';
  if (countdownTarget) {
    const diffMs = countdownTarget.getTime() - currentTime.getTime();
    if (diffMs > 0) {
      const h = Math.floor(diffMs / (1000 * 60 * 60));
      const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diffMs % (1000 * 60)) / 1000);
      timeLeftStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
  }

  const isFriday = selectedDate.getDay() === 5;
  const fridayDhuhr = todaySchedule?.prayers?.find((prayer) => prayer.name === 'Dhuhr');

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <section>
        <p className="font-headline font-bold text-primary text-sm tracking-widest uppercase mb-1">Surrey Islamic Society</p>
        <h1 className="font-headline font-extrabold text-3xl text-on-surface tracking-tight">Today's Schedule</h1>
        <p className="text-on-surface-variant text-sm mt-1">{todaySchedule.date ? format(todaySchedule.date, 'EEEE, d MMMM') : format(selectedDate, 'EEEE, d MMMM')} • {todaySchedule.hijriDate}</p>
      </section>

      {(loading || (isViewingToday && liveLoading)) && (
        <div className="flex justify-center items-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      )}

      {!loading && !isViewingToday && !schedule && (
        <div className="bg-error-container text-on-error-container p-4 rounded-xl text-sm mb-4">
          No schedule uploaded for this month yet. Showing default mock data.
        </div>
      )}

      {/* Hero Countdown */}
      <motion.section 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="relative overflow-hidden bg-primary text-on-primary p-8 rounded-2xl shadow-lg"
      >
        <div className="absolute right-0 top-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
        <div className="relative z-10">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20">
              <div className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></div>
              <span className="text-[10px] font-bold uppercase tracking-widest">Current: {currentPrayer ? currentPrayer.name : 'None'}</span>
            </div>
            <Bell className="w-5 h-5 opacity-60" />
          </div>
          
          <div className="mb-8">
            <p className="text-white/60 text-[10px] font-bold uppercase tracking-[0.2em] mb-1">{heroSubLabel}: {nextPrayer?.name || 'Loading'} ({countdownLabel})</p>
            <div className="flex items-baseline gap-3">
              <span className="font-headline font-black text-6xl tracking-tighter tabular-nums">{timeLeftStr}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/5 p-3 rounded-xl border border-white/10">
              <p className="text-[9px] text-white/50 uppercase font-bold tracking-wider mb-1">{nextPrayer?.name} Athan</p>
              <p className="text-lg font-bold tabular-nums text-center leading-tight">{nextPrayer?.athan || '--:--'}</p>
            </div>
            <div className="bg-white/5 p-3 rounded-xl border border-white/10">
              <p className="text-[9px] text-white/50 uppercase font-bold tracking-wider mb-1">{nextPrayer?.name} Iqama</p>
              <p className="text-lg font-bold tabular-nums text-center leading-tight">{nextPrayer?.iqama || '--:--'}</p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Weekly Summary */}
      <section>
        <div className="flex justify-between items-end mb-4 px-1">
          <div onClick={onViewCalendar} className="cursor-pointer hover:opacity-80 transition-opacity">
            <h2 className="font-headline font-bold text-xl text-on-surface">Weekly</h2>
            <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">{format(selectedDate, 'MMMM yyyy')}</p>
          </div>
          <button onClick={onViewCalendar} className="text-primary font-bold text-xs hover:underline">View Calendar</button>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-4 hide-scrollbar snap-x">
          {[-3, -2, -1, 0, 1, 2, 3].map((offset) => {
            const date = addDays(selectedDate, offset);
            const isActive = isSameDay(date, selectedDate);
            const isToday = isSameDay(date, new Date());
            return (
              <div 
                key={offset}
                onClick={() => onDateChange(date)}
                className={cn(
                  "snap-center flex-shrink-0 w-20 p-4 rounded-2xl text-center transition-all duration-300 border cursor-pointer relative",
                  isActive 
                    ? "bg-primary text-on-primary border-primary shadow-md scale-105" 
                    : "bg-surface-container-lowest border-outline-variant/10 opacity-70 hover:opacity-100",
                  isToday && !isActive && "border-primary/50"
                )}
              >
                {isToday && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-tertiary"></div>}
                <p className={cn("text-[9px] font-bold uppercase mb-2", isActive ? "text-white/70" : "text-on-surface-variant")}>{format(date, 'EEE')}</p>
                <p className="font-headline font-black text-2xl">{format(date, 'd')}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Prayer Times List */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-4 mb-2">
          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.2em]">Prayer</span>
          <div className="flex gap-12">
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.2em]">Athan</span>
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.2em]">Iqama</span>
          </div>
        </div>
        
        {todaySchedule?.prayers?.map((prayer, idx) => {
          const isCurrent = currentPrayer?.name === prayer.name && isSameDay(selectedDate, new Date());
          return (
            <div 
              key={prayer.name}
              className={cn(
                "flex items-center justify-between p-4 rounded-2xl transition-all",
                isCurrent 
                  ? "bg-secondary-container text-on-secondary-container shadow-sm ring-1 ring-primary/20" 
                  : "bg-surface-container-lowest border border-outline-variant/5"
              )}
            >
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center",
                  isCurrent ? "bg-primary text-on-primary" : "bg-surface-container"
                )}>
                  <PrayerIcon name={prayer.name} active={isCurrent} />
                </div>
                <span className="font-headline font-bold text-base">{prayer.name === 'Dhuhr' && isFriday ? 'Jumu\'ah' : prayer.name}</span>
              </div>
              
              <div className="flex gap-10 items-center pr-2">
                <span className="font-bold text-sm tabular-nums opacity-60">{prayer.athan}</span>
                <span className={cn("font-black text-base tabular-nums", isCurrent ? "text-primary" : "text-on-surface")}>{prayer.iqama}</span>
              </div>
            </div>
          );
        })}
      </section>

      {/* Jumu'ah Reminder (Friday only) */}
      {isFriday && jumuahConfig && fridayDhuhr && (
        <section className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <Users className="w-5 h-5 text-tertiary" />
            <h2 className="font-headline font-bold text-xl text-on-surface">Confirmed Jumu'ah</h2>
          </div>
          
          <div className="grid grid-cols-1 gap-4">
            {jumuahConfig === 'university-hall' ? (
              <div className="p-6 bg-tertiary-fixed/20 rounded-2xl border border-tertiary/10 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform">
                  <Building2 className="w-20 h-20" />
                </div>
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-headline font-bold text-lg text-on-surface">University Hall</h3>
                      <p className="text-xs text-on-surface-variant font-medium">Khutbah: {(fridayDhuhr.iqama || '').split('/')[0]?.trim() || '-'}</p>
                    </div>
                    <div className="bg-tertiary/20 px-3 py-1 rounded-full text-[10px] font-bold text-tertiary uppercase tracking-widest">
                      Confirmed Venue
                    </div>
                  </div>
                  <button 
                    onClick={() => window.open('https://maps.app.goo.gl/wwzUEqFA4hENz5wt5', '_blank')}
                    className="w-full py-3 bg-tertiary text-on-tertiary font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
                  >
                    Get Directions
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 bg-secondary-container/30 rounded-2xl border border-primary/10 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:-rotate-12 transition-transform">
                  <Users className="w-20 h-20" />
                </div>
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-headline font-bold text-lg text-on-surface">Rubix</h3>
                      <p className="text-xs text-on-surface-variant font-medium">Khutbah: {(fridayDhuhr.iqama || '').split('/').length > 1 ? (fridayDhuhr.iqama || '').split('/')[1]?.trim() : (fridayDhuhr.iqama || '').trim() || '-'}</p>
                    </div>
                    <div className="bg-primary/20 px-3 py-1 rounded-full text-[10px] font-bold text-primary uppercase tracking-widest">
                      Confirmed Venue
                    </div>
                  </div>
                  <button 
                    onClick={() => window.open('https://maps.app.goo.gl/ySPYGGyTAASj24y38', '_blank')}
                    className="w-full py-3 bg-primary text-on-primary font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
                  >
                    Get Directions
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Rate App Button */}
      <a 
        href="https://play.google.com/store/apps/details?id=com.surreyisoc.prayerroom"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-24 right-6 w-14 h-14 bg-primary text-on-primary rounded-full shadow-2xl flex items-center justify-center active:scale-95 transition-transform z-40"
        title="Rate us 5 stars!"
      >
        <Heart className="w-6 h-6 fill-white" />
      </a>
    </div>
  );
};

const PrayerIcon = ({ name, active }: { name: string, active?: boolean }) => {
  const props = { className: cn("w-5 h-5", active ? "text-primary" : "text-primary/40") };
  switch (name) {
    case 'Fajr': return <Moon {...props} />;
    case 'Sunrise': return <Sun {...props} className="text-tertiary" />;
    case 'Dhuhr': return <Sun {...props} fill={active ? "currentColor" : "none"} />;
    case 'Asr': return <CloudSun {...props} />;
    case 'Maghrib': return <CloudMoon {...props} />;
    case 'Isha': return <Moon {...props} />;
    default: return <Sun {...props} />;
  }
};
