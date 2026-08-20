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

    // Quản lý "chủ phòng" (người vào đầu tiên) theo từng topic (chỉ áp dụng phòng riêng do user tạo).
    // roomOwners: { [topic]: ownerNickname }  — chỉ có ý nghĩa với MÁY NÀY (mỗi client tự suy ra ai
    // là chủ phòng dựa trên thứ tự nhận được thông báo tham gia; xem thêm ghi chú bên index.html).
    let roomOwners = {};
    // banList: { [topic]: Set(nickname bị ban) } — tự hết hiệu lực khi phòng không còn chủ (rời hết)
    let banList = {};

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

        joinRoom: function(topic, nickname, isNewRoomCreator) {
            if (!mqttClient || !mqttClient.connected) return;

            // Subscribe kênh MQTT
            mqttClient.subscribe(topic, { qos: 0 }, function(err) {
                if (!err) {
                    if (!joinedTopics.includes(topic)) {
                        joinedTopics.push(topic);
                    }

                    // Nếu chính máy này vừa TẠO phòng riêng -> tự nhận làm chủ phòng và báo cho
                    // những người vào sau biết (họ sẽ tự cập nhật roomOwners qua message 'room_owner').
                    if (isNewRoomCreator) {
                        roomOwners[topic] = nickname;
                        mqttClient.publish(topic, JSON.stringify({
                            sender: 'Hệ thống', text: '', isSystem: true, type: 'room_owner', owner: nickname
                        }));
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

                // Nếu người rời chính là chủ phòng -> quyền kick/ban của phòng này mất hiệu lực
                // ngay (báo cho mọi người trong phòng biết để họ xoá roomOwners/banList của họ).
                if (roomOwners[topic] === nickname) {
                    mqttClient.publish(topic, JSON.stringify({
                        sender: 'Hệ thống', text: '', isSystem: true, type: 'room_owner_left', owner: nickname
                    }));
                    delete roomOwners[topic];
                }

                mqttClient.unsubscribe(topic);
                joinedTopics = joinedTopics.filter(t => t !== topic);
                delete banList[topic];
            }
        },

        sendChat: function (topic, sender, content, type = 'text') {
            if (mqttClient && mqttClient.connected) {
                // Không cho gửi nếu đã bị ban khỏi phòng này (chặn phía client; phòng riêng qua MQTT
                // công cộng không có bảo mật server-side thật, đây là hàng rào ở mức ứng dụng)
                if (banList[topic] && banList[topic].has(sender)) return;

                const payload = JSON.stringify({ 
                    sender: sender, 
                    text: content, 
                    isSystem: false, 
                    type: type 
                });
                mqttClient.publish(topic, payload);
            }
        },

        /**
         * KICK / BAN người khác khỏi phòng riêng. Chỉ có tác dụng khi máy gọi hàm này đang là
         * chủ phòng đã biết (roomOwners[topic] === myNickname) — kiểm tra thật ở index.html trước
         * khi gọi. permanent=true => ban (chặn gửi chat + tự leave), false => chỉ kick 1 lần (mời ra).
         */
        kickFromRoom: function(topic, actorNickname, targetNickname, permanent) {
            if (!mqttClient || !mqttClient.connected) return;
            if (roomOwners[topic] !== actorNickname) return; // không phải chủ phòng -> không có quyền

            mqttClient.publish(topic, JSON.stringify({
                sender: 'Hệ thống',
                text: permanent
                    ? `[${targetNickname}] đã bị BAN khỏi phòng bởi chủ phòng!`
                    : `[${targetNickname}] đã bị KICK khỏi phòng bởi chủ phòng!`,
                isSystem: true,
                type: permanent ? 'ban' : 'kick',
                target: targetNickname
            }));
        },

        /**
         * Trả về true nếu máy này đang được ghi nhận là chủ của phòng (topic) đó.
         */
        isRoomOwner: function(topic, nickname) {
            return roomOwners[topic] === nickname;
        },

        /**
         * Xử lý nội bộ các message hệ thống về chủ phòng/kick/ban — gọi từ index.html trong
         * receiveMessage() TRƯỚC khi hiển thị, để đồng bộ roomOwners/banList và tự thoát nếu bị kick/ban.
         * Trả về true nếu message này đã được xử lý và KHÔNG cần index.html xử lý thêm (vẫn có thể hiển thị).
         */
        handleRoomSystemMessage: function(data, myNickname) {
            if (!data || !data.topic) return;
            const topic = data.topic;

            if (data.type === 'room_owner') {
                roomOwners[topic] = data.owner;
            } else if (data.type === 'room_owner_left') {
                // Chủ phòng đã rời -> quyền kick/ban mất hiệu lực, xoá banList của phòng này
                delete roomOwners[topic];
                delete banList[topic];
            } else if (data.type === 'kick' || data.type === 'ban') {
                if (data.type === 'ban') {
                    if (!banList[topic]) banList[topic] = new Set();
                    banList[topic].add(data.target);
                }
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

                        if (roomOwners[topic] === nameToUse) {
                            mqttClient.publish(topic, JSON.stringify({
                                sender: 'Hệ thống', text: '', isSystem: true, type: 'room_owner_left', owner: nameToUse
                            }));
                        }
                    }
                });
                roomOwners = {};
                banList = {};

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
