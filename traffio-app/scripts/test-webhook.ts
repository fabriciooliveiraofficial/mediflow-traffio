import fetch from 'node-fetch';

async function testWebhook() {
    const url = 'http://localhost:3000/api/whatsapp-webhook';

    // Z-API Payload Simulator
    const payload = {
        phone: '5511999999999',
        messageId: 'ABC123456',
        connectedPhone: '5511888888888',
        text: {
            message: 'Quero agendar uma consulta'
        }
    };

    console.log('📡 Enviando mensagem simulada (Padrão Z-API)...', payload);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('✅ Resposta do Servidor:', data);
    } catch (error) {
        console.error('❌ Erro no teste:', error);
    }
}

testWebhook();
