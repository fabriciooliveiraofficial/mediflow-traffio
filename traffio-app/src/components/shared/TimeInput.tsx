import React from 'react';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';

interface TimeInputProps {
    value: string; // "HH:mm"
    onChange: (e: { target: { value: string } }) => void;
    disabled?: boolean;
    className?: string;
}

export const TimeInput: React.FC<TimeInputProps> = ({ value, onChange, disabled, className }) => {
    const { hour12 } = useLocaleFormat();

    const [hStr, mStr] = (value || '00:00').split(':');
    const h24 = parseInt(hStr || '0', 10);
    const m = mStr || '00';

    const handleHourChange = (newH24: number) => {
        onChange({ target: { value: `${newH24.toString().padStart(2, '0')}:${m}` } });
    };

    const handleMinuteChange = (newM: string) => {
        onChange({ target: { value: `${h24.toString().padStart(2, '0')}:${newM}` } });
    };

    const handleAmPmChange = (isPM: boolean) => {
        let newH24 = h24;
        if (isPM && h24 < 12) newH24 += 12;
        if (!isPM && h24 >= 12) newH24 -= 12;
        onChange({ target: { value: `${newH24.toString().padStart(2, '0')}:${m}` } });
    };

    if (hour12) {
        const isPM = h24 >= 12;
        const h12 = h24 % 12 || 12;
        
        return (
            <div className={`flex items-center gap-0.5 ${className}`}>
                <select 
                    disabled={disabled}
                    value={h12}
                    onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        handleHourChange(isPM ? (val === 12 ? 12 : val + 12) : (val === 12 ? 0 : val));
                    }}
                    className="bg-transparent appearance-none text-center outline-none cursor-pointer disabled:cursor-not-allowed"
                >
                    {Array.from({length: 12}, (_, i) => i + 1).map(h => (
                        <option key={h} value={h}>{h.toString().padStart(2, '0')}</option>
                    ))}
                </select>
                <span>:</span>
                <select 
                    disabled={disabled}
                    value={m}
                    onChange={(e) => handleMinuteChange(e.target.value)}
                    className="bg-transparent appearance-none text-center outline-none cursor-pointer disabled:cursor-not-allowed"
                >
                    {Array.from({length: 60}, (_, i) => i.toString().padStart(2, '0')).map(m => (
                        <option key={m} value={m}>{m}</option>
                    ))}
                </select>
                <select 
                    disabled={disabled}
                    value={isPM ? 'PM' : 'AM'}
                    onChange={(e) => handleAmPmChange(e.target.value === 'PM')}
                    className="bg-transparent appearance-none outline-none cursor-pointer text-[10px] font-bold ml-0.5 disabled:cursor-not-allowed"
                >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                </select>
            </div>
        );
    }

    return (
        <div className={`flex items-center gap-0.5 ${className}`}>
            <select 
                disabled={disabled}
                value={h24}
                onChange={(e) => handleHourChange(parseInt(e.target.value, 10))}
                className="bg-transparent appearance-none text-center outline-none cursor-pointer disabled:cursor-not-allowed"
            >
                {Array.from({length: 24}, (_, i) => i).map(h => (
                    <option key={h} value={h}>{h.toString().padStart(2, '0')}</option>
                ))}
            </select>
            <span>:</span>
            <select 
                disabled={disabled}
                value={m}
                onChange={(e) => handleMinuteChange(e.target.value)}
                className="bg-transparent appearance-none text-center outline-none cursor-pointer disabled:cursor-not-allowed"
            >
                {Array.from({length: 60}, (_, i) => i.toString().padStart(2, '0')).map(m => (
                    <option key={m} value={m}>{m}</option>
                ))}
            </select>
        </div>
    );
};
