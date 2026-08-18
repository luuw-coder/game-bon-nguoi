// GAME 4 NGUOI - App Core JavaScript Logic

// --- CẤU HÌNH FIREBASE CLOUD REALTIME DATABASE ---
const firebaseConfig = {
    apiKey: "AIzaSyDummyKeyForPublicDemoRealtime_G4N",
    authDomain: "game4nguoi-2026.firebaseapp.com",
    databaseURL: "https://game4nguoi-2026-default-rtdb.firebaseio.com",
    projectId: "game4nguoi-2026",
    storageBucket: "game4nguoi-2026.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
};

// Khởi tạo Firebase nếu chưa có
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

const GLOBAL_TOPIC = 'game4nguoi_2026/global';
const SYSTEM_ANNOUNCE_TOPIC = 'game4nguoi_2026/system_announcement';

const MASTER_ADMIN = {
    username: 'luuw',
    password: 'luuw',
    fullname: 'luuw',
    nickname: 'luuw'
};

let currentUser = null;
let currentTopic = GLOBAL_TOPIC;
let userPermissions = { isAdmin: false, isRootAdmin: false };
let mySessionId = 'sess_' + Math.random().toString(36).substr(2, 9);

const messagesDB = { [GLOBAL_TOPIC]: [] };

// DOM UI Elements
const ui = {
    authScreen: document.getElementById('screen-auth'),
    gameScreen: document.getElementById('screen-game'),
    fullname: document.getElementById('auth-fullname'),
    nickname: document.getElementById('auth-nickname'),
    username: document.getElementById('auth-username'),
    password: document.getElementById('auth-password'),
    chatBox: document.getElementById('chat-box'),
    chatInput: document.getElementById('chat-input'),
    tabContainer: document.getElementById('tab-container'),
    adminPanel: document.getElementById('admin-panel')
};

// --- 1. SỰ KIỆN DẤU CHẤM BÍ MẬT (Mở Modal nhập tay Admin, không tự điền) ---
document.getElementById('secret-admin-btn').addEventListener('click', function() {
    document.getElementById('admin-secret-user').value = '';
    document.getElementById('admin-secret-pass').value = '';
    document.getElementById('modal-admin-auth').classList.add('active');
});

document.getElementById('btn-close-admin-modal').addEventListener('click', function() {
    document.getElementById('modal-admin-auth').classList.remove('active');
});

document.getElementById('btn-confirm-secret-admin').addEventListener('click', function() {
    const user = document.getElementById('admin-secret-user').value.trim();
    const pass = document.getElementById('admin-secret-pass').value.trim();

    if (user === MASTER_ADMIN.username && pass === MASTER_ADMIN.password) {
        ui.fullname.value = MASTER_ADMIN.fullname;
        ui.nickname.value = MASTER_ADMIN.nickname;
        ui.username.value = MASTER_ADMIN.username;
        ui.password.value = MASTER_ADMIN.password;
        document.getElementById('modal-admin-auth').classList.remove('active');
        alert("🔑 Xác thực Admin thành công! Nhấn ĐĂNG NHẬP VÀO GAME.");
    } else {
        alert("❌ Sai tài khoản hoặc mật khẩu Admin!");
    }
});

// --- 2. XÁC THỰC & ĐĂNG NHẬP FIREBASE CLOUD ---
let pendingAuthData = null;

document.getElementById('btn-submit-auth').addEventListener('click', function() {
    const fullname = ui.fullname.value.trim();
    const nick = ui.nickname.value.trim();
    const user = ui.username.value.trim();
    const pass = ui.password.value.trim();

    if (!fullname || !nick || !user || !pass) return alert("Vui lòng điền đầy đủ 4 thông tin!");

    pendingAuthData = { fullname, nick, user, pass };

    // Kiểm tra trên Cloud Firebase Database
    db.ref('users/' + user).once('value').then(snapshot => {
        const userData = snapshot.val();

        if (user === MASTER_ADMIN.username) {
            if (pass !== MASTER_ADMIN.password) return alert("⚠️ Mật khẩu Admin không đúng!");
            proceedLogin(pendingAuthData, true, true);
        } else if (userData) {
            // Tài khoản đã tồn tại
            if (userData.password !== pass) {
                return alert("⚠️ TÀI KHOẢN ĐÃ TỒN TẠI! Mật khẩu bạn nhập không chính xác.");
            }

            // Mật khẩu đúng -> Kiểm tra xem có người dùng khác đang active không
            if (userData.activeSessionId && userData.activeSessionId !== mySessionId) {
                document.getElementById('conflict-msg').innerText = 
                    `Tài khoản [${user}] hiện đang có người dùng/thiết bị khác đăng nhập! Bạn có muốn tiếp tục vào không?`;
                document.getElementById('modal-conflict').classList.add('active');
            } else {
                proceedLogin(pendingAuthData, userData.isAdmin || false, false);
            }
        } else {
            // Khởi tạo tài khoản mới trên Cloud
            db.ref('users/' + user).set({
                password: pass,
                fullname: fullname,
                nickname: nick,
                isAdmin: false,
                activeSessionId: mySessionId,
                createdAt: Date.now()
            });
            proceedLogin(pendingAuthData, false, false);
        }
    }).catch(err => {
        // Nếu offline/lỗi mạng -> Dùng LocalStorage dự phòng
        fallbackLocalAuth(fullname, nick, user, pass);
    });
});

document.getElementById('btn-conflict-continue').addEventListener('click', function() {
    document.getElementById('modal-conflict').classList.remove('active');
    if (pendingAuthData) {
        proceedLogin(pendingAuthData, false, false);
    }
});

document.getElementById('btn-conflict-cancel').addEventListener('click', function() {
    document.getElementById('modal-conflict').classList.remove('active');
});

function proceedLogin(data, isAdmin, isRootAdmin) {
    userPermissions.isAdmin = isAdmin;
    userPermissions.isRootAdmin = isRootAdmin;
    currentUser = { username: data.user, fullname: data.fullname, nickname: data.nick };

    // Cập nhật session hoạt động trên Cloud
    db.ref('users/' + data.user).update({
        activeSessionId: mySessionId,
        fullname: data.fullname,
        nickname: data.nick,
        lastActive: Date.now()
    });

    // Lắng nghe thay đổi session (Nếu ai đó đăng nhập đè hoặc bị Kick)
    db.ref('users/' + data.user + '/activeSessionId').on('value', (snap) => {
        const cloudSess = snap.val();
        if (cloudSess && cloudSess !== mySessionId) {
            alert("⚠️ Tài khoản của bạn vừa có thêm 1 người dùng/thiết bị khác đăng nhập!");
        }
    });

    // Hiển thị UI
    document.getElementById('display-fullname').innerText = data.fullname;
    document.getElementById('display-nickname').innerText = data.nick;
    document.getElementById('display-username').innerText = data.user;

    const roleBadge = document.getElementById('display-role-badge');
    if (isRootAdmin) {
        roleBadge.innerText = 'Admin Chính (Root)';
        roleBadge.className = 'badge-admin';
        ui.adminPanel.classList.add('active');
    } else if (isAdmin) {
        roleBadge.innerText = 'Admin Server';
        roleBadge.className = 'badge-admin';
        ui.adminPanel.classList.add('active');
    } else {
        roleBadge.innerText = 'Thành Viên';
        roleBadge.className = 'badge-user';
    }

    ui.authScreen.classList.remove('active');
    ui.gameScreen.classList.add('active');

    // Kết nối mạng
    if (window.NetworkManager) {
        window.NetworkManager.connect(
            currentUser,
            receiveMessage,
            (isOnline) => { document.getElementById('display-status-text').innerText = isOnline ? '🟢 Trực tuyến' : '🔴 Mất kết nối'; }
        );

        setTimeout(() => {
            if (window.NetworkManager.joinRoom) {
                window.NetworkManager.joinRoom(SYSTEM_ANNOUNCE_TOPIC, currentUser.nickname);
            }
        }, 1000);
    }
}

function fallbackLocalAuth(fullname, nick, user, pass) {
    let localUsers = JSON.parse(localStorage.getItem('game4nguoi_users_db')) || {};
    if (localUsers[user] && localUsers[user].password !== pass) {
        return alert("⚠️ Sai mật khẩu tài khoản đã tồn tại!");
    }
    localUsers[user] = { password: pass, fullname, nickname: nick, isAdmin: false };
    localStorage.setItem('game4nguoi_users_db', JSON.stringify(localUsers));
    proceedLogin({ fullname, nick, user, pass }, false, false);
}

document.getElementById('btn-logout').addEventListener('click', function() {
    if (currentUser) {
        db.ref('users/' + currentUser.username + '/activeSessionId').off();
    }
    if (window.NetworkManager) window.NetworkManager.disconnect();
    location.reload();
});

// --- 3. ĐỔI MẬT KHẨU & ĐÁ THIẾT BỊ KHÁC ---
document.getElementById('btn-open-change-pass').addEventListener('click', () => {
    document.getElementById('modal-change-pass').classList.add('active');
});
document.getElementById('btn-close-change-pass').addEventListener('click', () => {
    document.getElementById('modal-change-pass').classList.remove('active');
});

document.getElementById('btn-confirm-change-pass').addEventListener('click', () => {
    const oldP = document.getElementById('pass-old').value;
    const newP = document.getElementById('pass-new').value;

    if (!oldP || !newP) return alert("Vui lòng điền mật khẩu cũ và mới!");

    db.ref('users/' + currentUser.username).once('value').then(snap => {
        const val = snap.val();
        if (val && val.password === oldP) {
            db.ref('users/' + currentUser.username).update({ password: newP }).then(() => {
                alert("✅ Đã đổi mật khẩu thành công!");
                document.getElementById('modal-change-pass').classList.remove('active');
            });
        } else {
            alert("❌ Mật khẩu cũ không chính xác!");
        }
    });
});

document.getElementById('btn-kick-others').addEventListener('click', () => {
    if (!currentUser) return;
    mySessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
    db.ref('users/' + currentUser.username).update({ activeSessionId: mySessionId }).then(() => {
        alert("⚡ Đã đá tất cả các thiết bị/người dùng khác ra khỏi tài khoản!");
    });
});

// --- 4. TẠO PHÒNG BẰNG MODAL TÙY CHỈNH (THAY THẾ WINDOW.PROMPT XẤU) ---
document.getElementById('btn-open-room-modal').addEventListener('click', function() {
    document.getElementById('room-code-input').value = '';
    document.getElementById('modal-room').classList.add('active');
});

document.getElementById('btn-close-room-modal').addEventListener('click', function() {
    document.getElementById('modal-room').classList.remove('active');
});

document.getElementById('btn-confirm-room').addEventListener('click', function() {
    const roomName = document.getElementById('room-code-input').value.trim();
    if (!roomName) return alert("Vui lòng nhập mã phòng!");

    const topicName = 'game4nguoi_2026/room_' + roomName;
    
    if (!messagesDB[topicName]) {
        messagesDB[topicName] = [];
        if (window.NetworkManager) window.NetworkManager.joinRoom(topicName, currentUser.nickname);
        
        const newTab = document.createElement('div');
        newTab.className = 'chat-tab';
        newTab.setAttribute('data-topic', topicName);
        newTab.innerHTML = `🔒 Phòng ${roomName} <span class="close-btn" onclick="closeTab(event, '${topicName}', this)">✖</span>`;
        newTab.onclick = function() { switchTab(this); };
        
        ui.tabContainer.insertBefore(newTab, document.getElementById('btn-open-room-modal'));
        switchTab(newTab);
    }
    
    document.getElementById('modal-room').classList.remove('active');
});

window.switchTab = function(tabElement) {
    document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
    tabElement.classList.add('active');
    currentTopic = tabElement.getAttribute('data-topic');
    renderChatBox();
}

window.closeTab = function(event, topic, btnElement) {
    event.stopPropagation();
    if (window.NetworkManager) window.NetworkManager.leaveRoom(topic, currentUser.nickname);
    delete messagesDB[topic];
    btnElement.parentElement.remove();
    switchTab(document.querySelector('.chat-tab'));
}

// --- 5. TÍNH NĂNG ADMIN & CHÁT ---
document.getElementById('btn-admin-broadcast').addEventListener('click', function() {
    if (!userPermissions.isAdmin) return;
    const msg = document.getElementById('admin-broadcast-input').value.trim();
    if (msg) {
        if (window.NetworkManager) window.NetworkManager.sendChat(SYSTEM_ANNOUNCE_TOPIC, 'HỆ THỐNG ADMIN', msg, 'announcement');
        document.getElementById('admin-broadcast-input').value = '';
    }
});

document.getElementById('btn-admin-grant').addEventListener('click', function() {
    if (!userPermissions.isAdmin) return;
    const targetUser = document.getElementById('admin-target-user').value.trim();
    if (!targetUser) return alert("Nhập tên tài khoản nhận quyền!");

    db.ref('users/' + targetUser).update({ isAdmin: true }).then(() => {
        alert(`✅ Đã cấp quyền Admin cho [${targetUser}] trên Cloud!`);
    });
});

document.getElementById('btn-admin-revoke').addEventListener('click', function() {
    if (!userPermissions.isAdmin) return;
    const targetUser = document.getElementById('admin-target-user').value.trim();
    if (!targetUser) return;

    if (targetUser === MASTER_ADMIN.username) {
        return alert("⛔ KHÔNG THỂ TƯỚC QUYỀN CỦA ADMIN CHÍNH (luuw)!");
    }

    db.ref('users/' + targetUser).update({ isAdmin: false }).then(() => {
        alert(`🗑️ Đã tước quyền Admin của [${targetUser}] trên Cloud!`);
    });
});

function receiveMessage(data) {
    if (data.type === 'announcement' || data.topic === SYSTEM_ANNOUNCE_TOPIC) {
        document.getElementById('announcement-text').innerText = `[${data.sender}]: ${data.text}`;
        return;
    }

    if (!messagesDB[data.topic]) messagesDB[data.topic] = [];
    messagesDB[data.topic].push(data);
    if (data.topic === currentTopic) renderChatBox();
}

function renderChatBox() {
    ui.chatBox.innerHTML = '';
    const msgs = messagesDB[currentTopic] || [];
    msgs.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'chat-msg' + (msg.isSystem ? ' system-msg' : '');
        
        if (msg.isSystem) {
            div.innerText = msg.text;
        } else {
            let namePrefix = `<strong>${msg.sender}:</strong> `;
            if (msg.type === 'image') {
                div.innerHTML = `${namePrefix} <br><img src="${msg.text}" class="chat-img" onclick="window.open(this.src)">`;
            } else {
                div.innerHTML = `${namePrefix} ${msg.text}`;
            }
        }
        ui.chatBox.appendChild(div);
    });
    ui.chatBox.scrollTop = ui.chatBox.scrollHeight;
}

document.getElementById('btn-send-chat').addEventListener('click', sendText);
ui.chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendText(); });

function sendText() {
    let text = ui.chatInput.value.trim();
    if (text) {
        if (window.NetworkManager) window.NetworkManager.sendChat(currentTopic, currentUser.nickname, text, 'text');
        ui.chatInput.value = '';
        document.getElementById('emoji-picker').classList.remove('active');
    }
}

// Emoji & Upload Image
document.getElementById('btn-toggle-emoji').addEventListener('click', () => {
    document.getElementById('emoji-picker').classList.toggle('active');
});

window.insertEmoji = function(emoji) {
    ui.chatInput.value += emoji;
    ui.chatInput.focus();
};

document.getElementById('btn-upload-image').addEventListener('click', () => {
    document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', function(e) {
    if (e.target.files.length > 0) processAndSendImage(e.target.files[0]);
});

ui.chatInput.addEventListener('paste', function(e) {
    let items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
            let file = items[i].getAsFile();
            processAndSendImage(file);
            e.preventDefault();
        }
    }
});

function processAndSendImage(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 400;
            let width = img.width, height = img.height;
            
            if (width > MAX_WIDTH) {
                height = height * (MAX_WIDTH / width);
                width = MAX_WIDTH;
            }
            
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            const base64Data = canvas.toDataURL('image/jpeg', 0.6); 
            if (window.NetworkManager) window.NetworkManager.sendChat(currentTopic, currentUser.nickname, base64Data, 'image');
        }
        img.src = e.target.result;
    }
    reader.readAsDataURL(file);
}
