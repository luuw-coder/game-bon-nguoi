// networkLoader.js - Quản lý kết nối Realtime MQTT & Firebase Fallback

window.NetworkManager = {
    client: null,
    topicHandlers: {},

    connect: function(userInfo, onMessageCallback, onStatusChange) {
        // Kết nối MQTT Broker miễn phí qua WebSocket
        const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
        const clientId = 'g4n_' + userInfo.username + '_' + Math.random().toString(16).substr(2, 8);

        this.client = mqtt.connect(brokerUrl, {
            clientId: clientId,
            clean: true,
            connectTimeout: 4000,
            keepalive: 60
        });

        this.client.on('connect', () => {
            console.log("🟢 [Network] Đã kết nối Broker MQTT");
            if (onStatusChange) onStatusChange(true);
            this.joinRoom('game4nguoi_2026/global', userInfo.nickname);
        });

        this.client.on('error', (err) => {
            console.error("🔴 [Network] Lỗi kết nối:", err);
            if (onStatusChange) onStatusChange(false);
        });

        this.client.on('offline', () => {
            if (onStatusChange) onStatusChange(false);
        });

        this.client.on('message', (topic, payload) => {
            try {
                const data = JSON.parse(payload.toString());
                data.topic = topic;
                if (onMessageCallback) onMessageCallback(data);
            } catch (e) {
                console.error("Lỗi parse tin nhắn:", e);
            }
        });
    },

    joinRoom: function(topic, nickname) {
        if (this.client && this.client.connected) {
            this.client.subscribe(topic, { qos: 0 });
            this.sendChat(topic, 'HỆ THỐNG', `${nickname} đã tham gia phòng.`, 'system');
        }
    },

    leaveRoom: function(topic, nickname) {
        if (this.client && this.client.connected) {
            this.sendChat(topic, 'HỆ THỐNG', `${nickname} đã rời phòng.`, 'system');
            this.client.unsubscribe(topic);
        }
    },

    sendChat: function(topic, sender, text, type = 'text') {
        if (this.client && this.client.connected) {
            const payload = JSON.stringify({
                sender: sender,
                text: text,
                type: type,
                isSystem: type === 'system',
                timestamp: Date.now()
            });
            this.client.publish(topic, payload, { qos: 0 });
        }
    },

    disconnect: function() {
        if (this.client) this.client.end();
    }
};
