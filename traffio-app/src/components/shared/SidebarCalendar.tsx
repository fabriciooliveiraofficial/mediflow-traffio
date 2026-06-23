import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  isSameMonth, 
  isSameDay, 
  addDays, 
  isBefore, 
  startOfDay 
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { getTenantTodayString } from '../../lib/timezoneUtils';

interface SidebarCalendarProps {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  availableDates: string[]; // ['2026-04-08', '2026-04-09', ...]
  currentMonth: Date;
  onMonthChange: (month: Date) => void;
  timezone?: string;
}

export const SidebarCalendar: React.FC<SidebarCalendarProps> = ({
  selectedDate,
  onDateSelect,
  availableDates,
  currentMonth,
  onMonthChange,
  timezone,
}) => {
  const { t } = useTranslation('common');
  const handlePrevMonth = () => onMonthChange(subMonths(currentMonth, 1));
  const handleNextMonth = () => onMonthChange(addMonths(currentMonth, 1));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const calendarRows = [];
  let days = [];
  let day = startDate;
  const tz = timezone || 'America/Sao_Paulo';
  const todayStr = getTenantTodayString(tz);
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const today = new Date(ty, tm - 1, td);

  while (day <= endDate) {
    for (let i = 0; i < 7; i++) {
      const formattedDate = format(day, 'yyyy-MM-dd');
      const isSelected = selectedDate === formattedDate;
      const isAvailable = availableDates.includes(formattedDate);
      const isPast = isBefore(day, today) && !isSameDay(day, today);
      const currentDay = day;

      days.push(
        <button
          key={formattedDate}
          onClick={() => !isPast && onDateSelect(formattedDate)}
          disabled={isPast}
          className={clsx(
            "relative h-10 w-full flex items-center justify-center rounded-xl text-xs font-bold transition-all cursor-pointer",
            !isSameMonth(day, monthStart) && "text-gray-200",
            isPast && "text-gray-200 cursor-not-allowed",
            isSelected ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20 scale-110 z-10" : "text-gray-700 hover:bg-gray-50 bg-transparent",
            isSameDay(day, today) && !isSelected && "text-blue-600 border border-blue-100"
          )}
        >
          <span>{format(day, 'd')}</span>
          {isAvailable && !isSelected && !isPast && (
            <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
          )}
        </button>
      );
      day = addDays(day, 1);
    }
    calendarRows.push(
      <div key={day.toString()} className="grid grid-cols-7 gap-1">
        {days}
      </div>
    );
    days = [];
  }

  const weekDays = t('calendar.weekdaysShort', { returnObjects: true }) as string[];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-black text-gray-900 capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
        </h4>
        <div className="flex gap-1">
          <button 
            onClick={handlePrevMonth}
            className="p-1.5 rounded-lg hover:bg-gray-50 text-gray-400 border-none bg-transparent cursor-pointer transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button 
            onClick={handleNextMonth}
            className="p-1.5 rounded-lg hover:bg-gray-50 text-gray-400 border-none bg-transparent cursor-pointer transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Week days */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map((wd, i) => (
          <div key={i} className="h-8 flex items-center justify-center text-[10px] font-black text-gray-400 uppercase tracking-widest">
            {wd}
          </div>
        ))}
      </div>

      {/* Calendar body */}
      <div className="space-y-1">
        {calendarRows}
      </div>
    </div>
  );
};
