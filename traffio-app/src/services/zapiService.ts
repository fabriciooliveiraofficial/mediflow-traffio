
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

    getHeaders(clientToken?: string | null, additionalHeaders: Record<string, string> = {}) {
        const headers: Record<string, string> = { ...additionalHeaders };
        if (clientToken) {
            headers['Client-Token'] = clientToken;
        }
        return headers;
    },

    /**
     * Connection Management
     */
    async getStatus(instanceId: string, token: string, clientToken?: string | null): Promise<ZApiStatusResponse> {
        try {
            const response = await fetch(this.getUrl(instanceId, token, '/status'), {
                headers: this.getHeaders(clientToken)
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

    async restart(instanceId: string, token: string, clientToken?: string | null): Promise<boolean> {
        try {
            const response = await fetch(this.getUrl(instanceId, token, '/restart'), {
                method: 'GET',
                headers: this.getHeaders(clientToken)
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    },

    async disconnect(instanceId: string, token: string, clientToken?: string | null): Promise<boolean> {
        try {
            const response = await fetch(this.getUrl(instanceId, token, '/disconnect'), {
                method: 'GET',
                headers: this.getHeaders(clientToken)
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    },

    async getQrCode(instanceId: string, token: string, clientToken?: string | null): Promise<string | null> {
        try {
            const response = await fetch(this.getUrl(instanceId, token, '/qr-code/image'), {
                headers: this.getHeaders(clientToken)
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
    async sendText(instanceId: string, token: string, clientToken: string | null | undefined, phone: string, message: string): Promise<any> {
        return this.post(instanceId, token, clientToken, '/send-text', { phone, message });
    },

    async sendButtonList(instanceId: string, token: string, clientToken: string | null | undefined, phone: string, message: string, buttons: { id: string, label: string }[]): Promise<any> {
        return this.post(instanceId, token, clientToken, '/send-button-list', {
            phone,
            message,
            buttonList: {
                buttons: buttons.map(b => ({ id: b.id, label: b.label }))
            }
        });
    },

    async sendOptionList(instanceId: string, token: string, clientToken: string | null | undefined, phone: string, message: string, title: string, options: { id: string, label: string }[]): Promise<any> {
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
    async post(instanceId: string, token: string, clientToken: string | null | undefined, endpoint: string, body: any) {
        try {
            const response = await fetch(this.getUrl(instanceId, token, endpoint), {
                method: 'POST',
                headers: this.getHeaders(clientToken, {
                    'Content-Type': 'application/json'
                }),
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
    },

    async updateWebhooks(instanceId: string, token: string, clientToken: string | null | undefined, webhookUrl: string): Promise<boolean> {
        try {
            const headers = this.getHeaders(clientToken, {
                'Content-Type': 'application/json'
            });
            const body = JSON.stringify({ value: webhookUrl });

            // We update received, delivery, and disconnected webhooks
            const endpoints = [
                '/update-webhook-received',
                '/update-webhook-delivery',
                '/update-webhook-disconnected'
            ];

            const results = await Promise.all(
                endpoints.map(endpoint => 
                    fetch(this.getUrl(instanceId, token, endpoint), {
                        method: 'PUT',
                        headers,
                        body
                    }).then(res => res.ok).catch(() => false)
                )
            );

            // Log if any webhook update failed, but return true if received is configured
            console.log(`[Z-API] Webhooks updated for ${instanceId}:`, results);
            return results[0]; // Received message webhook is the critical one
        } catch (error) {
            console.error('Z-API Webhooks Update Failed:', error);
            return false;
        }
    }
};
