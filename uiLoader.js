/**
 * UILOADER.JS - TRÌNH QUẢN LÝ GIAO DIỆN (UI MODULE)
 */
(function (window) {
    'use strict';

    // Lưu thông tin người dùng tạm thời trên giao diện
    let currentUser = {
        name: '',
        roomKey: '',
        isHost: false
    };

    // Các phần tử HTML
    const screens = {
        login: document.getElementById('screen-login'),
        lobby: document.getElementById('screen-lobby')
    };

    // --- 1. LẮNG NGHE SỰ KIỆN TỪ MAINROUTER ---
    window.MainRouter.listen('SYS_STATE_CHANGED', function (eventData) {
        // Chuyển đổi màn hình giao diện theo trạng thái game
        if (eventData.to === window.MainRouter.States.LOBBY) {
            showScreen('lobby');
        } else if (eventData.to === window.MainRouter.States.BOOT) {
            showScreen('login');
        }
    }, 'UIModule');

    // --- 2. XỬ LÝ THAO TÁC BẤM NÚT CỦA NGƯỜI DÙNG ---
    document.addEventListener('DOMContentLoaded', function () {
        
        // Bấm nút "Tạo Phòng Mới"
        document.getElementById('btn-create-room').addEventListener('click', function () {
            const name = document.getElementById('nickname').value.trim();
            if (!name) return alert('Vui lòng nhập tên nhân vật!');

            currentUser.name = name;
            currentUser.isHost = true;
            currentUser.roomKey = generateRandomKey();

            setupLobbyUI();
            addChatMessage('System', `Bạn đã tạo phòng thành công với Key: ${currentUser.roomKey}`, true);
            
            // Báo cho Hạt nhân biết đã vào trạng thái LOBBY
            window.MainRouter.State.setState(window.MainRouter.States.LOBBY, currentUser);
        });

        // Bấm nút "Vào Phòng Bằng Key"
        document.getElementById('btn-join-room').addEventListener('click', function () {
            const name = document.getElementById('nickname').value.trim();
            const key = document.getElementById('room-key-input').value.trim().toUpperCase();

            if (!name) return alert('Vui lòng nhập tên nhân vật!');
            if (!key) return alert('Vui lòng nhập Key phòng!');

            currentUser.name = name;
            currentUser.isHost = false;
            currentUser.roomKey = key;

            setupLobbyUI();
            addChatMessage('System', `Người chơi [${currentUser.name}] đã gia nhập phòng qua Key ${key}!`, true);

            // Báo cho Hạt nhân biết đã vào trạng thái LOBBY
            window.MainRouter.State.setState(window.MainRouter.States.LOBBY, currentUser);
        });

        // Bấm nút Gửi Chat
        document.getElementById('btn-send-chat').addEventListener('click', sendChat);
        document.getElementById('chat-input').addEventListener('keypress', function (e) {
            if (e.key === 'Enter') sendChat();
        });
    });

    // --- 3. HÀM HỖ TRỢ GIAO DIỆN ---
    function showScreen(screenName) {
        Object.keys(screens).forEach(key => {
            screens[key].classList.remove('active');
        });
        if (screens[screenName]) {
            screens[screenName].classList.add('active');
        }
    }

    function setupLobbyUI() {
        document.getElementById('display-room-key').innerText = currentUser.roomKey;
        const hostControls = document.getElementById('host-controls');
        // Nếu là Chủ phòng thì mới hiện nút "BẮT ĐẦU GAME"
        hostControls.style.display = currentUser.isHost ? 'block' : 'none';
    }

    function sendChat() {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (text) {
            addChatMessage(currentUser.name, text, false);
            input.value = '';
        }
    }

    function addChatMessage(sender, message, isSystem = false) {
        const chatBox = document.getElementById('chat-box');
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${isSystem ? 'system' : ''}`;
        msgDiv.innerText = isSystem ? message : `${sender}: ${message}`;
        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function generateRandomKey() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

})(window);
