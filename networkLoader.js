/**
 * NETWORKLOADER.JS - QUẢN LÝ KẾT NỐI MẠNG ONLINE (MQTT)
 */
(function (window) {
    'use strict';

    const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
    const GLOBAL_TOPIC = 'ca_khia_online_game_2026/global_chat';
    let mqttClient = null;

    window.NetworkManager = {
        // Hàm bắt đầu kết nối mạng
        connect: function (user, onMessageCallback, onStatusCallback) {
            const clientId = 'player_' + Math.random().toString(16).substring(2, 10);
            mqttClient = mqtt.connect(MQTT_BROKER, { clientId: clientId, keepalive: 60 });

            mqttClient.on('connect', function () {
                if (onStatusCallback) onStatusCallback(true);
                mqttClient.subscribe(GLOBAL_TOPIC);

                // Thông báo khi gia nhập
                const joinMsg = JSON.stringify({
                    sender: 'Hệ thống',
                    text: `[${user.nickname}] đã gia nhập kênh trò chuyện!`,
                    isSystem: true
                });
                mqttClient.publish(GLOBAL_TOPIC, joinMsg);
            });

            mqttClient.on('message', function (topic, message) {
                try {
                    const data = JSON.parse(message.toString());
                    if (onMessageCallback) onMessageCallback(data);
                } catch (e) {
                    console.error("Lỗi đọc dữ liệu mạng:", e);
                }
            });

            mqttClient.on('error', function () {
                if (onStatusCallback) onStatusCallback(false);
            });
        },

        // Hàm phát tin nhắn qua mạng
        sendChat: function (sender, text) {
            if (mqttClient && mqttClient.connected) {
                const payload = JSON.stringify({
                    sender: sender,
                    text: text,
                    isSystem: false
                });
                mqttClient.publish(GLOBAL_TOPIC, payload);
            }
        },

        // Hàm ngắt kết nối
        disconnect: function () {
            if (mqttClient) mqttClient.end();
        }
    };
})(window);
