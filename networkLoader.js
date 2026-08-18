/**
 * NETWORKLOADER.JS - ĐÃ SỬA LỖI ĐỒNG BỘ KÊNH CHAT
 */
(function (window) {
    'use strict';

    const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
    const DEFAULT_GLOBAL_TOPIC = 'game4nguoi_2026/global';
    let mqttClient = null;
    let joinedTopics = [];

    window.NetworkManager = {
        connect: function (user, onMessageCallback, onStatusCallback) {
            const clientId = 'player_' + Math.random().toString(16).substring(2, 10);
            
            // Thiết lập Last Will: Tự động phát tin nhắn thông báo khi mất kết nối đột ngột
            const offlineMessage = JSON.stringify({
                sender: 'Hệ thống',
                text: `[${user.nickname}] đã rời khỏi mạng trò chuyện!`,
                isSystem: true,
                type: 'text'
            });

            mqttClient = mqtt.connect(MQTT_BROKER, { 
                clientId: clientId, 
                keepalive: 60,
                will: { topic: DEFAULT_GLOBAL_TOPIC, payload: offlineMessage, qos: 0, retain: false }
            });

            mqttClient.on('connect', function () {
                if (onStatusCallback) onStatusCallback(true);
            });

            mqttClient.on('message', function (topic, message) {
                try {
                    const data = JSON.parse(message.toString());
                    data.topic = topic; // Đánh dấu tên kênh vào dữ liệu tin nhắn
                    if (onMessageCallback) onMessageCallback(data);
                } catch (e) {
                    console.error("Lỗi đọc dữ liệu mạng:", e);
                }
            });

            mqttClient.on('error', function (err) {
                console.error("Lỗi kết nối MQTT:", err);
                if (onStatusCallback) onStatusCallback(false);
            });

            mqttClient.on('offline', function () {
                if (onStatusCallback) onStatusCallback(false);
            });
        },

        joinRoom: function(topic, nickname) {
            if (mqttClient && mqttClient.connected && !joinedTopics.includes(topic)) {
                mqttClient.subscribe(topic, function(err) {
                    if (!err) {
                        joinedTopics.push(topic);
                        
                        // Không gửi tin nhắn tham gia nếu là kênh thông báo Server
                        if (topic !== 'game4nguoi_2026/system_announcement') {
                            const joinMsg = JSON.stringify({ 
                                sender: 'Hệ thống', 
                                text: `[${nickname}] đã tham gia phòng!`, 
                                isSystem: true, 
                                type: 'text' 
                            });
                            mqttClient.publish(topic, joinMsg);
                        }
                    }
                });
            }
        },

        leaveRoom: function(topic, nickname) {
            if (mqttClient && joinedTopics.includes(topic)) {
                const leaveMsg = JSON.stringify({ 
                    sender: 'Hệ thống', 
                    text: `[${nickname}] đã rời phòng!`, 
                    isSystem: true, 
                    type: 'text' 
                });
                mqttClient.publish(topic, leaveMsg);
                
                mqttClient.unsubscribe(topic);
                joinedTopics = joinedTopics.filter(t => t !== topic);
            }
        },

        sendChat: function (topic, sender, content, type = 'text') {
            if (mqttClient && mqttClient.connected) {
                const payload = JSON.stringify({ 
                    sender: sender, 
                    text: content, 
                    isSystem: false, 
                    type: type 
                });
                mqttClient.publish(topic, payload);
            }
        },

        disconnect: function () {
            if (mqttClient) {
                mqttClient.end();
                mqttClient = null;
            }
            joinedTopics = [];
        }
    };
})(window);
