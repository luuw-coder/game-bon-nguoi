/**
 * NETWORKLOADER.JS - SỬA LỖI HIỂN THỊ CHAT & THÔNG BÁO VÀO/THOÁT
 */
(function (window) {
    'use strict';

    const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
    const DEFAULT_GLOBAL_TOPIC = 'game4nguoi_2026/global';
    let mqttClient = null;
    let joinedTopics = [];
    let currentNickname = '';

    window.NetworkManager = {
        connect: function (user, onMessageCallback, onStatusCallback) {
            currentNickname = user.nickname;
            joinedTopics = []; // Reset danh sách phòng khi khởi tạo kết nối mới
            
            const clientId = 'player_' + Math.random().toString(16).substring(2, 10);
            
            // Last Will: Tự động phát thông báo nếu mất mạng bất ngờ
            const offlineMessage = JSON.stringify({
                sender: 'Hệ thống',
                text: `[${user.nickname}] đã mất kết nối mạng!`,
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
                    data.topic = topic;
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
            if (!mqttClient || !mqttClient.connected) return;

            // Subscribe kênh MQTT
            mqttClient.subscribe(topic, { qos: 0 }, function(err) {
                if (!err) {
                    if (!joinedTopics.includes(topic)) {
                        joinedTopics.push(topic);
                    }
                    
                    // Gửi thông báo tham gia (Trừ kênh thông báo hệ thống)
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
        },

        leaveRoom: function(topic, nickname) {
            if (mqttClient && mqttClient.connected && joinedTopics.includes(topic)) {
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

        disconnect: function (nickname) {
            const nameToUse = nickname || currentNickname;
            if (mqttClient) {
                // Gửi thông báo rời tất cả các phòng trước khi ngắt kết nối
                joinedTopics.forEach(topic => {
                    if (topic !== 'game4nguoi_2026/system_announcement') {
                        const leaveMsg = JSON.stringify({ 
                            sender: 'Hệ thống', 
                            text: `[${nameToUse}] đã rời phòng!`, 
                            isSystem: true, 
                            type: 'text' 
                        });
                        mqttClient.publish(topic, leaveMsg);
                    }
                });

                setTimeout(() => {
                    if (mqttClient) {
                        mqttClient.end();
                        mqttClient = null;
                    }
                }, 200);
            }
            joinedTopics = [];
        }
    };
})(window);
