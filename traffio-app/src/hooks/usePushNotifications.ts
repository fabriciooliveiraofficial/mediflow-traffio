import { useState, useEffect } from 'react';

export function usePushNotifications() {
    const [isSupported, setIsSupported] = useState(false);
    const [permission, setPermission] = useState<NotificationPermission>('default');

    useEffect(() => {
        if ('Notification' in window && 'serviceWorker' in navigator) {
            setIsSupported(true);
            setPermission(Notification.permission);
        }
    }, []);

    const requestPermission = async () => {
        if (!isSupported) return false;

        try {
            const result = await Notification.requestPermission();
            setPermission(result);

            if (result === 'granted') {
                // Here we would typically subscribe to push service
                // and send the token to Supabase
                console.log('Permission granted for push notifications.');
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error requesting notification permission:', error);
            return false;
        }
    };

    return {
        isSupported,
        permission,
        requestPermission
    };
}
