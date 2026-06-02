import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from './ToastContext';
import { useTenant } from './TenantContext';
import { useAuth } from './AuthContext';

interface NotificationSettings {
    whatsapp_sound: boolean;
    whatsapp_toast: boolean;
    whatsapp_push: boolean;
}

interface NotificationContextType {
    requestPermission: () => Promise<boolean>;
    settings: NotificationSettings | null;
    updateSettings: (settings: Partial<NotificationSettings>) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const VAPID_PUBLIC_KEY = 'BMeLszvt2aCNsvu0wfGLvhsl4M4l83K8igo6GW4dEvecgueHUpne5AgRvkcfhG4uECTwiqkg-8EO42wxDw-8ags';

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { showToast } = useToast();
    const { user } = useAuth();
    const [settings, setSettings] = React.useState<NotificationSettings | null>(null);

    // Initial load of settings
    useEffect(() => {
        if (!user) return;

        const loadSettings = async () => {
            const { data: profile } = await supabase
                .from('profiles')
                .select('notification_settings')
                .eq('id', user.id)
                .single();

            if (profile?.notification_settings) {
                setSettings(profile.notification_settings);
            }
        };
        loadSettings();
    }, [user?.id]);

    const playNotificationSound = useCallback(() => {
        if (settings?.whatsapp_sound === false) return;
        
        try {
            const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            
            console.log("[NotificationContext] AudioContext state:", ctx.state);
            
            const playTone = (freq: number, start: number, dur: number, vol = 0.22) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(vol, start + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
                osc.start(start);
                osc.stop(start + dur);
            };

            const now = ctx.currentTime;
            playTone(1047, now, 0.18);        // C6
            playTone(1319, now + 0.18, 0.18); // E6
            playTone(1568, now + 0.36, 0.28); // G6
            
            setTimeout(() => ctx.close(), 1200);
        } catch (err) {
            console.warn("AudioContext error:", err);
        }
    }, [settings]);

    const { tenant } = useTenant();

    // Setup Realtime Listener
    useEffect(() => {
        const setupListener = async () => {
            if (!user) return;

            const myTenantId = tenant?.id;
            console.log("[NotificationContext] myTenantId for filtering:", myTenantId);

            const channel = supabase.channel('whatsapp_notifications')
                .on('broadcast', { event: 'new_whatsapp_message' }, (payload) => {
                    console.log("[NotificationContext] Raw payload received:", JSON.stringify(payload, null, 2));
                    
                    // In Supabase SDK v2, the payload passed to the callback might be the broadcast object or just the data.
                    // Let's handle both just in case.
                    const message = (payload.payload && typeof payload.payload === 'object') ? payload.payload : payload;
                    console.log("[NotificationContext] Extracted message:", JSON.stringify(message, null, 2));
                    
                    if (!message || !message.tenant_id) {
                        console.warn("[NotificationContext] Message or tenant_id missing in payload");
                        return;
                    }

                    // Filter by tenant_id
                    if (myTenantId && message.tenant_id !== myTenantId) {
                        console.log(`[NotificationContext] Message ignored. My tenant: ${myTenantId}, Message tenant: ${message.tenant_id}`);
                        return;
                    }

                    console.log("[NotificationContext] Message PASSED tenant filter. Triggering alerts...");

                    // 1. Play Sound
                    if (settings?.whatsapp_sound !== false) {
                        playNotificationSound();
                    }

                    // 2. Show Toast
                    if (settings?.whatsapp_toast !== false) {
                        showToast('info', `Nova mensagem de ${message.sender_name || 'Paciente'}`);
                    }
                })
                .subscribe((status) => {
                    console.log("[NotificationContext] Channel status:", status);
                });

            return channel;
        };

        let activeChannel: any = null;
        if (tenant?.id) {
            setupListener().then(ch => { activeChannel = ch; });
        }

        return () => {
            if (activeChannel) {
                supabase.removeChannel(activeChannel);
            }
        };
    }, [settings, showToast, playNotificationSound, tenant?.id, user?.id]);

    // Service Worker & Push Subscription
    const setupPush = useCallback(async () => {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('Push messaging is not supported');
            return;
        }

        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            
            const subscription = await registration.pushManager.getSubscription();
            if (subscription) return; // Already subscribed

            if (!user) return;

            const newSubscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });

            const subJSON = newSubscription.toJSON();
            
            await supabase.from('user_push_subscriptions').upsert({
                user_id: user.id,
                endpoint: subJSON.endpoint,
                p256dh: subJSON.keys?.p256dh,
                auth: subJSON.keys?.auth
            });

        } catch (error) {
            console.error('Failed to setup push notifications:', error);
        }
    }, []);

    const requestPermission = async () => {
        if (!('Notification' in window)) return false;
        
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            await setupPush();
            return true;
        }
        return false;
    };

    const updateSettings = async (newSettings: Partial<NotificationSettings>) => {
        const updated = { ...settings, ...newSettings } as NotificationSettings;
        setSettings(updated);

        if (user) {
            await supabase.from('profiles').update({
                notification_settings: updated
            }).eq('id', user.id);
        }
    };

    return (
        <NotificationContext.Provider value={{ requestPermission, settings, updateSettings }}>
            {children}
        </NotificationContext.Provider>
    );
};

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};
