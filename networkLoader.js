/**
 * NETWORKLOADER.JS - NÂNG CẤP ĐA PHÒNG & THÔNG BÁO RỜI MẠNG
 */
(function (window) {
    'use strict';

    const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
    const GLOBAL_TOPIC = 'ca_khia_online_game_2026/global';
    let mqttClient = null;
    let joinedTopics = [];

    window.NetworkManager = {
        connect: function (user, onMessageCallback, onStatusCallback) {
            const clientId = 'player_' + Math.random().toString(16).substring(2, 10);
            
            // Cài đặt Last Will: Tự động gửi tin nhắn này nếu user đột ngột mất mạng / tắt web
            const offlineMessage = JSON.stringify({
                sender: 'Hệ thống',
                text: `[${user.nickname}] đã rời khỏi mạng trò chuyện!`,
                isSystem: true,
                type: 'text'
            });

            mqttClient = mqtt.connect(MQTT_BROKER, { 
                clientId: clientId, 
                keepalive: 60,
                will: { topic: GLOBAL_TOPIC, payload: offlineMessage, qos: 0, retain: false }
            });

            mqttClient.on('connect', function () {
                if (onStatusCallback) onStatusCallback(true);
                window.NetworkManager.joinRoom(GLOBAL_TOPIC, user.nickname);
            });

            mqttClient.on('message', function (topic, message) {
                try {
                    const data = JSON.parse(message.toString());
                    data.topic = topic; // Gắn tên phòng vào tin nhắn để biết tab nào
                    if (onMessageCallback) onMessageCallback(data);
                } catch (e) {
                    console.error("Lỗi đọc dữ liệu mạng:", e);
                }
            });

            mqttClient.on('error', function () {
                if (onStatusCallback) onStatusCallback(false);
            });
        },

        joinRoom: function(topic, nickname) {
            if (mqttClient && !joinedTopics.includes(topic)) {
                mqttClient.subscribe(topic);
                joinedTopics.push(topic);
                
                const joinMsg = JSON.stringify({ sender: 'Hệ thống', text: `[${nickname}] đã tham gia phòng!`, isSystem: true, type: 'text' });
                mqttClient.publish(topic, joinMsg);
            }
        },

        leaveRoom: function(topic, nickname) {
            if (mqttClient && joinedTopics.includes(topic)) {
                const leaveMsg = JSON.stringify({ sender: 'Hệ thống', text: `[${nickname}] đã rời phòng!`, isSystem: true, type: 'text' });
                mqttClient.publish(topic, leaveMsg);
                
                mqttClient.unsubscribe(topic);
                joinedTopics = joinedTopics.filter(t => t !== topic);
            }
        },

        sendChat: function (topic, sender, content, type = 'text') {
            if (mqttClient && mqttClient.connected) {
                const payload = JSON.stringify({ sender: sender, text: content, isSystem: false, type: type });
                mqttClient.publish(topic, payload);
            }
        },

        disconnect: function () {
            if (mqttClient) mqttClient.end();
            joinedTopics = [];
        }
    };
})(window);
