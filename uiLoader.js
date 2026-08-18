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
/**
 * UILoader - Lắng nghe sự kiện người dùng và điều khiển giao diện UI
 */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Lấy các phần tử DOM Đăng nhập
  const btnLogin = document.getElementById('btn-submit-login');
  const inputNickname = document.getElementById('input-nickname');
  const inputUsername = document.getElementById('input-username');
  const inputPassword = document.getElementById('input-password');

  // 2. Lấy các phần tử DOM Giao diện Game
  const displayNickname = document.getElementById('display-nickname');
  const displayUsername = document.getElementById('display-username');
  const chatBox = document.getElementById('chat-box');
  const inputChatMsg = document.getElementById('input-chat-msg');
  const btnSendChat = document.getElementById('btn-send-chat');
  const btnLogout = document.getElementById('btn-logout');

  // 3. Lấy các phần tử DOM Admin
  const btnOpenAdmin = document.getElementById('btn-open-admin');
  const btnBackFromAdmin = document.getElementById('btn-back-from-admin');

  // 4. Các nút Menu chức năng
  const btnJoinRoom = document.getElementById('btn-join-room');

  // ==========================================
  // XỬ LÝ LỖI 1: ĐĂNG NHẬP CHUYỂN VÀO GAME
  // ==========================================
  if (btnLogin) {
    btnLogin.addEventListener('click', async () => {
      const nickname = inputNickname.value.trim();
      const username = inputUsername.value.trim();
      const password = inputPassword.value.trim();

      if (!nickname || !username) {
        alert("Vui lòng nhập Xưng hô và Tài khoản!");
        return;
      }

      // Gọi NetworkLoader để xác nhận đăng nhập
      const response = await NetworkLoader.login(nickname, username, password);

      if (response.success) {
        // Cập nhật thông tin giao diện người dùng
        displayNickname.textContent = response.user.nickname;
        displayUsername.textContent = response.user.username;

        // Xóa cũ và Thêm tin nhắn chào mừng vào Chat Box đúng như hình ảnh
        chatBox.innerHTML = `
          <div class="chat-msg" style="color: #ff9800; font-style: italic;">
            [${response.user.nickname}] đã gia nhập kênh trò chuyện!
          </div>
        `;

        // Chuyển sang Màn hình Game
        MainRouter.showScreen('screen-main');
      } else {
        alert(response.message);
      }
    });
  }

  // ==========================================
  // XỬ LÝ GỬI TIN NHẮN CHAT
  // ==========================================
  function sendMessage() {
    const text = inputChatMsg.value.trim();
    const user = NetworkLoader.getCurrentUser();
    if (text && user) {
      const msgElem = document.createElement('div');
      msgElem.className = 'chat-msg';
      msgElem.innerHTML = `<strong style="color:#ff9800;">[${user.nickname}]:</strong> ${text}`;
      chatBox.appendChild(msgElem);
      chatBox.scrollTop = chatBox.scrollHeight;
      inputChatMsg.value = '';
    }
  }

  if (btnSendChat) {
    btnSendChat.addEventListener('click', sendMessage);
  }
  if (inputChatMsg) {
    inputChatMsg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }

  // ==========================================
  // XỬ LÝ BẤM NHẬP MÃ PHÒNG (Ví dụ 777 như ảnh 3)
  // ==========================================
  if (btnJoinRoom) {
    btnJoinRoom.addEventListener('click', () => {
      const roomCode = prompt("Nhập mã phòng riêng (Ví dụ: 777):");
      if (roomCode) {
        alert(`Đã vào phòng: ${roomCode}`);
      }
    });
  }

  // ==========================================
  // XỬ LÝ ĐĂNG XUẤT
  // ==========================================
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      NetworkLoader.logout();
      MainRouter.showScreen('screen-login');
    });
  }

  // ==========================================
  // XỬ LÝ LỖI 2: NÚT ADMIN BẤM DỄ DÀNG
  // ==========================================
  if (btnOpenAdmin) {
    btnOpenAdmin.addEventListener('click', () => {
      MainRouter.showScreen('screen-admin');
    });
  }

  if (btnBackFromAdmin) {
    btnBackFromAdmin.addEventListener('click', () => {
      // Nếu đã đăng nhập thì về màn hình game, chưa thì về login
      if (NetworkLoader.getCurrentUser()) {
        MainRouter.showScreen('screen-main');
      } else {
        MainRouter.showScreen('screen-login');
      }
    });
  }
});
