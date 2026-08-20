/**
 * ============================================================================
 * FIREBASESYNC.JS - KẾT NỐI ĐÁM MÂY ĐỘC LẬP (FIREBASE REALTIME DATABASE)
 * ============================================================================
 * Nhiệm vụ:
 * 1. Kết nối Firebase Realtime Database (thay thế localStorage để nhiều máy
 *    cùng thấy nhau — localStorage chỉ tồn tại trên 1 trình duyệt/1 máy).
 * 2. Quản lý tài khoản người dùng: đăng ký, đăng nhập, đổi mật khẩu.
 * 3. Quản lý PHIÊN ĐĂNG NHẬP (session) để phát hiện trùng tài khoản:
 *    - Khi 1 tài khoản đang có người dùng mà người khác đăng nhập vào,
 *      hệ thống hỏi xác nhận trước khi "giành" phiên.
 *    - Người bị giành phiên sẽ nhận được thông báo real-time (bị kick),
 *      có thể đổi mật khẩu mới để giành lại quyền sử dụng ngay lập tức.
 * 4. Quản lý quyền Admin (cấp / tước).
 *
 * CÁCH DÙNG: dán config Firebase của bạn vào FIREBASE_CONFIG bên dưới,
 * rồi include 2 script CDN của Firebase TRƯỚC file này trong index.html:
 *
 *   <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-database-compat.js"></script>
 *   <script src="firebaseSync.js"></script>
 * ============================================================================
 */

(function (window) {
    'use strict';

    // ========================================================================
    // I. CẤU HÌNH FIREBASE — DÁN CONFIG CỦA BẠN VÀO ĐÂY
    // ========================================================================
    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyD36u8TkGhbtqFeJGs16xrOyQRubF994-c",
        authDomain: "game4nguoi-742cb.firebaseapp.com",
        databaseURL: "https://game4nguoi-742cb-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "game4nguoi-742cb",
        storageBucket: "game4nguoi-742cb.firebasestorage.app",
        messagingSenderId: "412516987706",
        appId: "1:412516987706:web:45321a1875c62a13f81603"
    };

    let db = null;
    let _initError = null;

    try {
        if (typeof firebase === 'undefined') {
            throw new Error('Chưa nạp Firebase SDK (thiếu <script> firebase-app / firebase-database trước firebaseSync.js)');
        }
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.database();
        console.log('%c[FirebaseSync]: Kết nối Đám Mây đã sẵn sàng!', 'color:#00e5ff; font-weight:bold;');
    } catch (err) {
        _initError = err;
        console.error('[FirebaseSync Error]: Không thể khởi tạo Firebase.', err);
    }

    // Các tham chiếu bảng dữ liệu
    const REF_USERS = () => db.ref('users');
    const REF_USER = (username) => db.ref('users/' + username);
    const REF_KICKS = (sessionId) => db.ref('kicks/' + sessionId);

    // ========================================================================
    // II. TIỆN ÍCH NỘI BỘ
    // ========================================================================

    function generateSessionId() {
        return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    }

    // Tài khoản gốc luôn được set cấp 5 (Admin) ngay khi tạo mới
    const ROOT_ADMIN_USERNAME = 'luuw';

    function guessDeviceLabel() {
        const ua = navigator.userAgent;
        let label = 'Thiết bị lạ';
        if (/Mobi|Android/i.test(ua)) label = 'Điện thoại';
        else if (/Windows/i.test(ua)) label = 'Máy tính (Windows)';
        else if (/Mac/i.test(ua)) label = 'Máy tính (Mac)';
        else if (/Linux/i.test(ua)) label = 'Máy tính (Linux)';
        if (/Chrome/i.test(ua)) label += ' - Chrome';
        else if (/Firefox/i.test(ua)) label += ' - Firefox';
        else if (/Safari/i.test(ua)) label += ' - Safari';
        return label;
    }

    let _currentSessionId = null;
    let _currentUsername = null;
    let _kickListenerRef = null;
    let _onForceKickedCallback = null;

    // ========================================================================
    // III. LẮNG NGHE BỊ KICK (REAL-TIME)
    // ========================================================================

    function _watchForKick(sessionId) {
        _stopWatchingKick();
        _kickListenerRef = REF_KICKS(sessionId);
        _kickListenerRef.on('value', function (snapshot) {
            if (snapshot.exists() && snapshot.val() === true) {
                // Phiên này đã bị người khác giành mất
                if (typeof _onForceKickedCallback === 'function') {
                    _onForceKickedCallback();
                }
            }
        });
    }

    function _stopWatchingKick() {
        if (_kickListenerRef) {
            _kickListenerRef.off();
            _kickListenerRef = null;
        }
    }

    // ========================================================================
    // IV. API CHÍNH — XUẤT RA WINDOW.FIREBASESYNC
    // ========================================================================

    window.FirebaseSync = {

        isReady: function () {
            return db !== null;
        },

        getInitError: function () {
            return _initError;
        },

        /**
         * Đăng ký lắng nghe khi phiên hiện tại bị người khác kick (giành tài khoản)
         */
        onForceKicked: function (callback) {
            _onForceKickedCallback = callback;
        },

        /**
         * ĐĂNG NHẬP / ĐĂNG KÝ
         * Trả về Promise, resolve với:
         *   { status: 'new_account' }                 -> tài khoản mới vừa tạo, đã đăng nhập
         *   { status: 'ok', user }                     -> đăng nhập thành công, không có ai dùng
         *   { status: 'wrong_password' }                -> sai mật khẩu
         *   { status: 'wrong_fullname' }                -> đúng tài khoản/mật khẩu nhưng SAI tên định danh
         *   { status: 'conflict', user, sessionInfo }   -> tài khoản đang có người dùng, cần xác nhận
         *
         * LƯU Ý: với tài khoản đã tồn tại, phải khớp CẢ 3 (username + password + fullname/tên định danh)
         * mới được vào — sai tên định danh sẽ bị chặn dù đúng tài khoản/mật khẩu.
         */
        login: function (username, password, fullname, nickname) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));

            return REF_USER(username).once('value').then(function (snapshot) {
                if (!snapshot.exists()) {
                    // Tài khoản chưa tồn tại -> tạo mới
                    // Tài khoản gốc (ROOT_ADMIN_USERNAME) tự động là cấp 5 (Admin)
                    const isRoot = (username === ROOT_ADMIN_USERNAME);
                    const newUser = {
                        password: password,
                        fullname: fullname,
                        nickname: nickname,
                        level: isRoot ? 5 : 1,
                        isAdmin: isRoot,
                        activeSession: null
                    };
                    return REF_USER(username).set(newUser).then(function () {
                        return window.FirebaseSync._claimSession(username, newUser);
                    }).then(function () {
                        return { status: 'new_account', user: newUser };
                    });
                }

                const userData = snapshot.val();

                if (userData.password !== password) {
                    return { status: 'wrong_password' };
                }

                // Tên định danh (fullname) phải khớp CHÍNH XÁC với dữ liệu đã lưu
                if (userData.fullname !== fullname) {
                    return { status: 'wrong_fullname' };
                }

                // Mật khẩu + tên định danh đúng — kiểm tra có ai đang giữ phiên không
                if (userData.activeSession && userData.activeSession.sessionId) {
                    return {
                        status: 'conflict',
                        user: userData,
                        sessionInfo: userData.activeSession
                    };
                }

                // Không ai đang dùng -> đăng nhập bình thường (chỉ cập nhật tên xưng hô/nickname,
                // KHÔNG cho đổi tên định danh qua login vì nó là khóa xác thực)
                userData.nickname = nickname || userData.nickname;
                return REF_USER(username).update({
                    nickname: userData.nickname
                }).then(function () {
                    return window.FirebaseSync._claimSession(username, userData);
                }).then(function () {
                    return { status: 'ok', user: userData };
                });
            });
        },

        /**
         * XÁC NHẬN GIÀNH PHIÊN (dùng khi login() trả về status: 'conflict'
         * và người dùng bấm "Vẫn tiếp tục")
         * Sẽ kick người đang dùng cũ và chiếm quyền sử dụng.
         */
        forceClaim: function (username, fullname, nickname) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));

            return REF_USER(username).once('value').then(function (snapshot) {
                const userData = snapshot.val();
                if (!userData) return { status: 'not_found' };

                // Vẫn phải khớp tên định danh khi giành phiên (tránh người khác đoán đúng
                // user/pass nhưng sai tên định danh mà vẫn chiếm được tài khoản)
                if (userData.fullname !== fullname) {
                    return { status: 'wrong_fullname' };
                }

                const oldSessionId = userData.activeSession ? userData.activeSession.sessionId : null;

                userData.nickname = nickname || userData.nickname;

                return REF_USER(username).update({
                    nickname: userData.nickname
                }).then(function () {
                    return window.FirebaseSync._claimSession(username, userData);
                }).then(function () {
                    // Đánh dấu phiên cũ bị kick — máy cũ đang lắng nghe sẽ nhận được ngay
                    if (oldSessionId) {
                        return REF_KICKS(oldSessionId).set(true);
                    }
                }).then(function () {
                    return { status: 'ok', user: userData };
                });
            });
        },

        /**
         * Nội bộ: ghi session mới của MÁY NÀY vào tài khoản + bắt đầu lắng nghe bị kick
         */
        _claimSession: function (username, userData) {
            _currentSessionId = generateSessionId();
            _currentUsername = username;

            const sessionInfo = {
                sessionId: _currentSessionId,
                deviceLabel: guessDeviceLabel(),
                loginAt: firebase.database.ServerValue.TIMESTAMP
            };

            _watchForKick(_currentSessionId);

            return REF_USER(username).child('activeSession').set(sessionInfo);
        },

        /**
         * ĐỔI MẬT KHẨU MỚI (dùng để "giành lại" tài khoản sau khi bị kick,
         * hoặc đổi mật khẩu bình thường). Tự động giành lại phiên luôn.
         */
        changePassword: function (username, oldPassword, newPassword, fullname, nickname) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));

            return REF_USER(username).once('value').then(function (snapshot) {
                if (!snapshot.exists()) return { status: 'not_found' };
                const userData = snapshot.val();

                if (userData.password !== oldPassword) {
                    return { status: 'wrong_password' };
                }

                const oldSessionId = userData.activeSession ? userData.activeSession.sessionId : null;

                return REF_USER(username).update({ password: newPassword }).then(function () {
                    return window.FirebaseSync._claimSession(username, userData);
                }).then(function () {
                    if (oldSessionId) {
                        return REF_KICKS(oldSessionId).set(true);
                    }
                }).then(function () {
                    return { status: 'ok' };
                });
            });
        },

        /**
         * ĐĂNG XUẤT — giải phóng phiên để người khác đăng nhập không bị hỏi xác nhận
         */
        logout: function (username) {
            _stopWatchingKick();
            if (!db || !username) return Promise.resolve();

            return REF_USER(username).once('value').then(function (snapshot) {
                const userData = snapshot.val();
                // Chỉ xoá session nếu đúng là session của MÁY NÀY (tránh xoá nhầm
                // session của người vừa giành mất tài khoản)
                if (userData && userData.activeSession && userData.activeSession.sessionId === _currentSessionId) {
                    return REF_USER(username).child('activeSession').remove();
                }
            }).finally(function () {
                if (_currentSessionId) REF_KICKS(_currentSessionId).remove();
                _currentSessionId = null;
                _currentUsername = null;
            });
        },

        // --- QUYỀN THEO CẤP BẬC (1-5) ---
        // Cấp 5 (Admin gốc): gán được mọi cấp 1-5 cho bất kỳ ai.
        // Cấp 4: gán được tối đa cấp 3 (không thể gán cấp 4 hoặc 5).
        // Cấp 1-3: không có quyền gán cấp cho ai.
        //
        // Trả về Promise, resolve với:
        //   { status: 'ok' }
        //   { status: 'not_found' }          -> không tìm thấy tài khoản đích
        //   { status: 'forbidden' }           -> người gọi không đủ quyền gán cấp này
        setLevel: function (actorLevel, targetUsername, newLevel) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));

            newLevel = parseInt(newLevel, 10);
            if (isNaN(newLevel) || newLevel < 1 || newLevel > 5) {
                return Promise.resolve({ status: 'forbidden' });
            }
            if (actorLevel < 4) {
                return Promise.resolve({ status: 'forbidden' });
            }
            if (actorLevel === 4 && newLevel > 3) {
                return Promise.resolve({ status: 'forbidden' });
            }

            return REF_USER(targetUsername).once('value').then(function (snapshot) {
                if (!snapshot.exists()) return { status: 'not_found' };
                return REF_USER(targetUsername).update({
                    level: newLevel,
                    isAdmin: (newLevel >= 5)
                }).then(function () {
                    return { status: 'ok' };
                });
            });
        },

        // Giữ lại 2 hàm cũ để tương thích ngược (grantAdmin = set cấp 5, revokeAdmin = set cấp 1)
        grantAdmin: function (username) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_USER(username).once('value').then(function (snapshot) {
                if (!snapshot.exists()) return { status: 'not_found' };
                return REF_USER(username).update({ isAdmin: true, level: 5 }).then(function () {
                    return { status: 'ok' };
                });
            });
        },

        revokeAdmin: function (username) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_USER(username).update({ isAdmin: false, level: 1 }).then(function () {
                return { status: 'ok' };
            });
        },

        /**
         * ĐỔI XƯNG HÔ (nickname hiển thị) — dùng cho tính năng "bấm vào tên để đổi tại chỗ".
         * KHÔNG đổi Tên định danh (fullname) vì đó là khoá xác thực đăng nhập, chỉ đổi nickname.
         */
        updateNickname: function (username, newNickname) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            if (!newNickname || !newNickname.trim()) return Promise.reject(new Error('Xưng hô không được để trống'));
            return REF_USER(username).update({ nickname: newNickname.trim() }).then(function () {
                return { status: 'ok' };
            });
        },

        getCurrentSessionId: function () {
            return _currentSessionId;
        }
    };

    // Tự động giải phóng phiên khi đóng tab/trình duyệt
    window.addEventListener('beforeunload', function () {
        if (_currentUsername && db) {
            // Dùng update đồng bộ tốt nhất có thể (không đảm bảo luôn kịp,
            // nhưng đây là best-effort tiêu chuẩn cho beforeunload)
            REF_USER(_currentUsername).child('activeSession').remove();
            if (_currentSessionId) REF_KICKS(_currentSessionId).remove();
        }
    });

})(window);
