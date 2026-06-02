
export interface ZApiStatusResponse {
    connected: boolean;
    phone?: string;
    marketing_name?: string;
}

export const zapiService = {
    // Helper to construct URL
    getUrl(instanceId: string, token: string, path: string = '') {
        return `https://api.z-api.io/instances/${instanceId}/token/${token}${path}`;
    },

    /**
     * Connection Management
     */
    async getStatus(instanceId: string, token: string, clientToken: string): Promise<ZApiStatusResponse> {
        try {
            const response = await fetch(this.getUrl(instanceId, token, '/status'), {
                headers: { 'Client-Token': clientToken }
            });
            const data = await response.json();
            return {
                connected: data.connected || data.status === 'CONNECTED',
                phone: data.phone,
                marketing_name: data.marketing_name
            };
        } catch (error) {
            console.error(`Z-API Status Error (${instanceId}):`, error);
            return { connected: false };
        }
    },

    async restart(instanceId: string, token: string, clientToken: string): Promise<boolean> {
        try {
            const response = await fetch(this.getUrl(instanceId, token, '/restart'), {
                method: 'GET',
                headers: { 'Client-Token': clientToken }
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    },

    async disconnect(instanceId: string, token: string, clientToken: string): Promise<boolean> {
        try {
            const response = await fetch(this.getUrl(instanceId, token, '/disconnect'), {
                method: 'GET',
                headers: { 'Client-Token': clientToken }
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    },

    async getQrCode(instanceId: string, token: string, clientToken: string): Promise<string | null> {
        try {
            const response = await fetch(this.getUrl(instanceId, token, '/qr-code/image'), {
                headers: { 'Client-Token': clientToken }
            });
            const data = await response.json();
            return data.value || data.link || null;
        } catch (error) {
            return null;
        }
    },

    /**
     * Messaging Methods (Stateless)
     */
    async sendText(instanceId: string, token: string, clientToken: string, phone: string, message: string): Promise<any> {
        return this.post(instanceId, token, clientToken, '/send-text', { phone, message });
    },

    async sendButtonList(instanceId: string, token: string, clientToken: string, phone: string, message: string, buttons: { id: string, label: string }[]): Promise<any> {
        return this.post(instanceId, token, clientToken, '/send-button-list', {
            phone,
            message,
            buttonList: {
                buttons: buttons.map(b => ({ id: b.id, label: b.label }))
            }
        });
    },

    async sendOptionList(instanceId: string, token: string, clientToken: string, phone: string, message: string, title: string, options: { id: string, label: string }[]): Promise<any> {
        return this.post(instanceId, token, clientToken, '/send-option-list', {
            phone,
            message,
            optionList: {
                title,
                buttonLabel: "Abrir Menu",
                options: options.map(o => ({ id: o.id, label: o.label }))
            }
        });
    },

    // Internal Helper
    async post(instanceId: string, token: string, clientToken: string, endpoint: string, body: any) {
        try {
            const response = await fetch(this.getUrl(instanceId, token, endpoint), {
                method: 'POST',
                headers: {
                    'Client-Token': clientToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Z-API Error [${response.status}]:`, errorText);
                throw new Error(`Z-API Error: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Z-API Request Failed:', error);
            throw error;
        }
    }
};
