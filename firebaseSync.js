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
        apiKey: "AIzaSyAgmBKH0K3esCQC5H4lxRHy2kGW2lkczsE",
        authDomain: "game4nguoi-742cb.firebaseapp.com",
        databaseURL: "https://game4nguoi-742cb-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "game4nguoi-742cb",
        storageBucket: "game4nguoi-742cb.firebasestorage.app",
        messagingSenderId: "412516987706",
        appId: "1:412516987706:web:45321a1875c62a13f81603"
    };

    let db = null;
    let _initError = null;

    // ========================================================================
    // I-B. HASH MẬT KHẨU (SHA-256 qua Web Crypto API có sẵn trên trình duyệt) —
    // KHÔNG BAO GIỜ lưu mật khẩu gốc (plain text) lên Firebase nữa. Kể cả ai đó
    // đọc được node "users" (do Rules mở hoặc bug), họ cũng chỉ thấy chuỗi hash,
    // không suy ngược ra được mật khẩu thật.
    // ========================================================================
    async function hashPassword(plainPassword) {
        const enc = new TextEncoder().encode(String(plainPassword));
        const hashBuffer = await crypto.subtle.digest('SHA-256', enc);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

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

    // Firebase Realtime Database CẤM các ký tự . # $ [ ] trong key. Vì tài khoản giờ có dạng
    // "abc@game4nguoi.com" (chứa dấu chấm), phải encode trước khi dùng làm key, decode khi cần hiển thị lại.
    function encodeUserKey(username) {
        return String(username)
            .replace(/\./g, '__DOT__')
            .replace(/#/g, '__HASH__')
            .replace(/\$/g, '__DOLLAR__')
            .replace(/\[/g, '__LB__')
            .replace(/\]/g, '__RB__');
    }
    function decodeUserKey(key) {
        return String(key)
            .replace(/__DOT__/g, '.')
            .replace(/__HASH__/g, '#')
            .replace(/__DOLLAR__/g, '$')
            .replace(/__LB__/g, '[')
            .replace(/__RB__/g, ']');
    }

    // Các tham chiếu bảng dữ liệu
    const REF_USERS = () => db.ref('users');
    const REF_USER = (username) => db.ref('users/' + encodeUserKey(username));
    const REF_KICKS = (sessionId) => db.ref('kicks/' + sessionId);
    // BẠN BÈ: friends/{userKey}/{friendKey} = true  |  friendRequests/{toUserKey}/{fromUserKey} = {fromNickname, fromFullname, at}
    const REF_FRIENDS = (username) => db.ref('friends/' + encodeUserKey(username));
    const REF_FRIEND_LINK = (username, friendUsername) => db.ref('friends/' + encodeUserKey(username) + '/' + encodeUserKey(friendUsername));
    const REF_FRIEND_REQUESTS = (username) => db.ref('friendRequests/' + encodeUserKey(username));
    const REF_FRIEND_REQUEST = (toUsername, fromUsername) => db.ref('friendRequests/' + encodeUserKey(toUsername) + '/' + encodeUserKey(fromUsername));

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
    // III-B. LẮNG NGHE THAY ĐỔI QUYỀN (REAL-TIME) — khi Admin/Cấp 4/5 cấp hoặc thu hồi quyền
    // của một tài khoản đang online, tài khoản đó thấy hiệu lực NGAY LẬP TỨC, không cần tải lại trang.
    // ========================================================================
    let _permissionListenerRef = null;
    let _onPermissionChangedCallback = null;
    let _friendRequestsListenerRef = null;
    function _stopWatchingFriendRequests() {
        if (_friendRequestsListenerRef) {
            _friendRequestsListenerRef.off('value');
            _friendRequestsListenerRef = null;
        }
    }

    function _watchOwnPermissions(username) {
        _stopWatchingPermissions();
        _permissionListenerRef = REF_USER(username);
        _permissionListenerRef.on('value', function (snapshot) {
            if (!snapshot.exists()) return;
            const val = snapshot.val();
            if (typeof _onPermissionChangedCallback === 'function') {
                _onPermissionChangedCallback({
                    level: (typeof val.level === 'number') ? val.level : 1,
                    isRootAdmin: !!val.isRootAdmin
                });
            }
        });
    }

    function _stopWatchingPermissions() {
        if (_permissionListenerRef) {
            _permissionListenerRef.off();
            _permissionListenerRef = null;
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
         * Đăng ký lắng nghe khi CẤP BẬC/QUYỀN của TÀI KHOẢN ĐANG ĐĂNG NHẬP thay đổi (real-time) —
         * ví dụ Admin vừa cấp hoặc thu hồi quyền. Callback nhận { level, isRootAdmin } mới nhất.
         * Việc lắng nghe tự bắt đầu ngay khi đăng nhập thành công (trong _claimSession).
         */
        onPermissionChanged: function (callback) {
            _onPermissionChangedCallback = callback;
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

            return hashPassword(password).then(function (passwordHash) {
            return REF_USER(username).once('value').then(function (snapshot) {
                if (!snapshot.exists()) {
                    // Tài khoản chưa tồn tại -> tạo mới
                    // Tài khoản gốc (ROOT_ADMIN_USERNAME) là ADMIN — vai trò TÁCH BIỆT HOÀN TOÀN khỏi
                    // thang cấp 1-5 (không phải "Cấp 5"). level vẫn để mặc định 1 vì Admin không dùng
                    // thang điểm đó; quyền của Admin được kiểm tra qua isRootAdmin riêng.
                    const isRoot = (username === ROOT_ADMIN_USERNAME);
                    const newUser = {
                        password: passwordHash,
                        fullname: fullname,
                        nickname: nickname,
                        level: 1,
                        isRootAdmin: isRoot,
                        activeSession: null
                    };
                    return REF_USER(username).set(newUser).then(function () {
                        return window.FirebaseSync._claimSession(username, newUser);
                    }).then(function () {
                        return { status: 'new_account', user: newUser };
                    });
                }

                const userData = snapshot.val();

                if (userData.deleted) {
                    return { status: 'account_deleted' };
                }

                if (userData.password !== passwordHash) {
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
                // KHÔNG cho đổi tên định danh qua login vì nó là khóa xác thực).
                // Tài khoản gốc (ROOT_ADMIN_USERNAME) LUÔN được đảm bảo cờ isRootAdmin=true, kể cả khi
                // dữ liệu cũ trong Firebase (từ lần thử nghiệm trước) chưa có cờ này — tự sửa lại cho đúng.
                const isRootLogin = (username === ROOT_ADMIN_USERNAME);
                userData.nickname = nickname || userData.nickname;
                const updates = { nickname: userData.nickname };
                if (isRootLogin) {
                    updates.isRootAdmin = true;
                    userData.isRootAdmin = true;
                }
                return REF_USER(username).update(updates).then(function () {
                    return window.FirebaseSync._claimSession(username, userData);
                }).then(function () {
                    return { status: 'ok', user: userData };
                });
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

                const isRootLogin = (username === ROOT_ADMIN_USERNAME);
                userData.nickname = nickname || userData.nickname;
                const updates = { nickname: userData.nickname };
                if (isRootLogin) {
                    updates.isRootAdmin = true;
                    userData.isRootAdmin = true;
                }

                return REF_USER(username).update(updates).then(function () {
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
         * Nội bộ: ghi session mới của MÁY NÀY vào tài khoản + bắt đầu lắng nghe bị kick + lắng nghe quyền
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
            _watchOwnPermissions(username);

            const sessionRef = REF_USER(username).child('activeSession');

            // QUAN TRỌNG: onDisconnect() được Firebase SERVER tự thực hiện ngay khi phát hiện mất kết nối
            // thật sự (đóng tab, tắt trình duyệt, rớt mạng, sập máy) — khác với 'beforeunload' ở phía
            // client vốn không chạy kịp trong nhiều trường hợp (crash, mất mạng đột ngột, tắt máy).
            // Nhờ vậy "online" trong danh sách bạn bè phản ánh đúng người ĐANG THỰC SỰ có kết nối, không
            // còn kẹt ở trạng thái online giả sau khi ai đó đã rời từ lâu.
            sessionRef.onDisconnect().remove();

            return sessionRef.set(sessionInfo);
        },

        /**
         * ĐỔI MẬT KHẨU MỚI (dùng để "giành lại" tài khoản sau khi bị kick,
         * hoặc đổi mật khẩu bình thường). Tự động giành lại phiên luôn.
         */
        changePassword: function (username, oldPassword, newPassword, fullname, nickname) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));

            return Promise.all([hashPassword(oldPassword), hashPassword(newPassword)]).then(function (hashes) {
                const oldHash = hashes[0], newHash = hashes[1];
                return REF_USER(username).once('value').then(function (snapshot) {
                    if (!snapshot.exists()) return { status: 'not_found' };
                    const userData = snapshot.val();

                    if (userData.password !== oldHash) {
                        return { status: 'wrong_password' };
                    }

                    const oldSessionId = userData.activeSession ? userData.activeSession.sessionId : null;

                    return REF_USER(username).update({ password: newHash }).then(function () {
                        return window.FirebaseSync._claimSession(username, userData);
                    }).then(function () {
                        if (oldSessionId) {
                            return REF_KICKS(oldSessionId).set(true);
                        }
                    }).then(function () {
                        return { status: 'ok' };
                    });
                });
            });
        },

        /**
         * ĐĂNG XUẤT — giải phóng phiên để người khác đăng nhập không bị hỏi xác nhận
         */
        logout: function (username) {
            _stopWatchingKick();
            _stopWatchingPermissions();
            if (!db || !username) return Promise.resolve();

            // Hủy lệnh onDisconnect().remove() đã đăng ký lúc đăng nhập — vì giờ ta TỰ xoá session
            // ngay bên dưới; nếu không hủy, lệnh cũ có thể trồi lên xoá nhầm session mới (của người
            // vừa đăng nhập lại) khi kết nối mạng cũ mới thật sự ngắt muộn hơn.
            REF_USER(username).child('activeSession').onDisconnect().cancel();

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
        // Admin (tài khoản gốc luuw): TÁCH BIỆT hoàn toàn khỏi thang 1-5, gán được mọi cấp 1-5 cho bất kỳ ai,
        //   cộng thêm các quyền đặc biệt riêng (Giám Sát, sửa Thông Báo Máy Chủ, v.v.) mà Cấp 5 không có.
        // Cấp 5: là cấp CAO NHẤT trong thang 1-5, gán được cấp 1-5 cho người khác, nhưng KHÔNG có các
        //   quyền đặc biệt riêng của Admin.
        // Cấp 4: gán được tối đa cấp 3 (không thể gán cấp 4 hoặc 5).
        // Cấp 1-3: không có quyền gán cấp cho ai.
        //
        // actor = { level: number, isRootAdmin: boolean } — thông tin người đang thực hiện thao tác gán cấp.
        // Trả về Promise, resolve với:
        //   { status: 'ok' }
        //   { status: 'not_found' }          -> không tìm thấy tài khoản đích
        //   { status: 'forbidden' }           -> người gọi không đủ quyền gán cấp này
        setLevel: function (actor, targetUsername, newLevel) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));

            const actorLevel = (actor && actor.level) || 1;
            const actorIsRootAdmin = !!(actor && actor.isRootAdmin);

            newLevel = parseInt(newLevel, 10);
            if (isNaN(newLevel) || newLevel < 1 || newLevel > 5) {
                return Promise.resolve({ status: 'forbidden' });
            }
            // Admin gán được mọi cấp; nếu không phải Admin thì phải là Cấp 4 trở lên mới được gán
            if (!actorIsRootAdmin) {
                if (actorLevel < 4) return Promise.resolve({ status: 'forbidden' });
                if (actorLevel === 4 && newLevel > 3) return Promise.resolve({ status: 'forbidden' });
            }

            return REF_USER(targetUsername).once('value').then(function (snapshot) {
                if (!snapshot.exists()) return { status: 'not_found' };
                return REF_USER(targetUsername).update({
                    level: newLevel
                }).then(function () {
                    return { status: 'ok' };
                });
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

        /**
         * LẤY DANH SÁCH TÀI KHOẢN ĐÃ ĐƯỢC CẤP QUYỀN (level > 1) — dùng cho Admin/Cấp 4/5 xem và thu hồi.
         * Trả về mảng: [{ username, nickname, fullname, level }]  (username đã decode, không còn __DOT__...)
         */
        listGrantedUsers: function () {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_USERS().once('value').then(function (snapshot) {
                const result = [];
                snapshot.forEach(function (child) {
                    const val = child.val();
                    const lvl = (val && typeof val.level === 'number') ? val.level : 1;
                    if (lvl > 1) {
                        result.push({
                            username: decodeUserKey(child.key),
                            nickname: val.nickname || '',
                            fullname: val.fullname || '',
                            level: lvl
                        });
                    }
                });
                return result;
            });
        },

        /**
         * XEM THÔNG TIN NGƯỜI CHƠI theo tài khoản (Admin/Cấp 4/5 dùng để tra cứu trước khi cấp quyền).
         * Trả về { status: 'ok', data: {...} } hoặc { status: 'not_found' }
         */
        lookupUser: function (username) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_USER(username).once('value').then(function (snapshot) {
                if (!snapshot.exists()) return { status: 'not_found' };
                const val = snapshot.val();
                return {
                    status: 'ok',
                    data: {
                        username: username,
                        nickname: val.nickname || '',
                        fullname: val.fullname || '',
                        level: (typeof val.level === 'number') ? val.level : 1,
                        isRootAdmin: !!val.isRootAdmin,
                        online: !!(val.activeSession && val.activeSession.sessionId)
                    }
                };
            });
        },

        /**
         * TRA CỨU NGƯỜI CHƠI THEO XƯNG HÔ (nickname) — có thể trùng tên giữa nhiều tài khoản khác nhau,
         * nên trả về MẢNG tất cả tài khoản khớp (không phân biệt hoa/thường, so khớp chính xác toàn bộ chuỗi).
         * Trả về mảng: [{ username, nickname, fullname, level, isRootAdmin, online }, ...]
         */
        lookupUsersByNickname: function (nickname) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            const target = String(nickname || '').trim().toLowerCase();
            if (!target) return Promise.resolve([]);

            return REF_USERS().once('value').then(function (snapshot) {
                const result = [];
                snapshot.forEach(function (child) {
                    const val = child.val();
                    if (val && String(val.nickname || '').trim().toLowerCase() === target) {
                        result.push({
                            username: decodeUserKey(child.key),
                            nickname: val.nickname || '',
                            fullname: val.fullname || '',
                            level: (typeof val.level === 'number') ? val.level : 1,
                            isRootAdmin: !!val.isRootAdmin,
                            online: !!(val.activeSession && val.activeSession.sessionId)
                        });
                    }
                });
                return result;
            });
        },

        getCurrentSessionId: function () {
            return _currentSessionId;
        },

        // ========================================================================
        // V. HỆ THỐNG BẠN BÈ
        // ========================================================================

        /**
         * GỬI LỜI MỜI KẾT BẠN — tìm người nhận theo Xưng hô (nickname) + Tên định danh (fullname),
         * cả 2 phải khớp CHÍNH XÁC (không phân biệt hoa/thường với nickname) để tránh gửi nhầm người
         * trùng tên. Trả về Promise resolve:
         *   { status: 'ok' }
         *   { status: 'not_found' }        -> không ai khớp cả xưng hô + tên định danh
         *   { status: 'self' }             -> gửi cho chính mình
         *   { status: 'already_friends' }  -> đã là bạn bè rồi
         *   { status: 'already_sent' }     -> đã gửi lời mời trước đó, đang chờ
         */
        sendFriendRequest: function (fromUsername, fromNickname, targetNickname, targetFullname) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            const wantNick = String(targetNickname || '').trim().toLowerCase();
            const wantFull = String(targetFullname || '').trim().toLowerCase();
            if (!wantNick || !wantFull) return Promise.resolve({ status: 'not_found' });

            return REF_USERS().once('value').then(function (snapshot) {
                let targetUsername = null;
                snapshot.forEach(function (child) {
                    const val = child.val();
                    if (val && String(val.nickname || '').trim().toLowerCase() === wantNick
                        && String(val.fullname || '').trim().toLowerCase() === wantFull) {
                        targetUsername = decodeUserKey(child.key);
                    }
                });
                if (!targetUsername) return { status: 'not_found' };
                if (targetUsername === fromUsername) return { status: 'self' };

                return REF_FRIEND_LINK(fromUsername, targetUsername).once('value').then(function (linkSnap) {
                    if (linkSnap.exists()) return { status: 'already_friends' };
                    return REF_FRIEND_REQUEST(targetUsername, fromUsername).once('value').then(function (reqSnap) {
                        if (reqSnap.exists()) return { status: 'already_sent' };
                        return REF_FRIEND_REQUEST(targetUsername, fromUsername).set({
                            fromNickname: fromNickname,
                            at: firebase.database.ServerValue.TIMESTAMP
                        }).then(function () { return { status: 'ok' }; });
                    });
                });
            });
        },

        /**
         * LẮNG NGHE LỜI MỜI KẾT BẠN ĐẾN (real-time) — callback nhận mảng
         * [{ fromUsername, fromNickname, at }, ...] mỗi khi danh sách thay đổi. Dùng để hiện số
         * thông báo cạnh mục Bạn Bè.
         */
        onFriendRequestsChanged: function (username, callback) {
            _stopWatchingFriendRequests();
            _friendRequestsListenerRef = REF_FRIEND_REQUESTS(username);
            _friendRequestsListenerRef.on('value', function (snapshot) {
                const result = [];
                snapshot.forEach(function (child) {
                    const val = child.val() || {};
                    result.push({
                        fromUsername: decodeUserKey(child.key),
                        fromNickname: val.fromNickname || '',
                        at: val.at || 0
                    });
                });
                if (typeof callback === 'function') callback(result);
            }, function (err) {
                // Thường là do Firebase Rules chưa mở quyền đọc "friendRequests" — log để dễ chẩn đoán
                console.error('Lỗi lắng nghe lời mời kết bạn (kiểm tra Firebase Rules node "friendRequests"):', err);
            });
        },

        /**
         * CHẤP NHẬN lời mời kết bạn — tạo liên kết 2 chiều trong friends/ rồi xoá lời mời.
         */
        acceptFriendRequest: function (myUsername, fromUsername) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            const updates = {};
            updates['friends/' + encodeUserKey(myUsername) + '/' + encodeUserKey(fromUsername)] = true;
            updates['friends/' + encodeUserKey(fromUsername) + '/' + encodeUserKey(myUsername)] = true;
            updates['friendRequests/' + encodeUserKey(myUsername) + '/' + encodeUserKey(fromUsername)] = null;
            return db.ref().update(updates).then(function () { return { status: 'ok' }; });
        },

        /**
         * TỪ CHỐI lời mời kết bạn — chỉ xoá lời mời, không tạo liên kết.
         */
        declineFriendRequest: function (myUsername, fromUsername) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_FRIEND_REQUEST(myUsername, fromUsername).remove().then(function () { return { status: 'ok' }; });
        },

        /**
         * LẤY DANH SÁCH BẠN BÈ hiện tại — trả về mảng đầy đủ thông tin (nickname, fullname, online)
         * để hiển thị trong mục Bạn Bè.
         */
        listFriends: function (username) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_FRIENDS(username).once('value').then(function (snapshot) {
                const friendUsernames = [];
                snapshot.forEach(function (child) {
                    if (child.val() === true) friendUsernames.push(decodeUserKey(child.key));
                });
                if (friendUsernames.length === 0) return [];
                return Promise.all(friendUsernames.map(function (fu) {
                    return REF_USER(fu).once('value').then(function (uSnap) {
                        const val = uSnap.val() || {};
                        return {
                            username: fu,
                            nickname: val.nickname || fu,
                            fullname: val.fullname || '',
                            online: !!(val.activeSession && val.activeSession.sessionId)
                        };
                    });
                }));
            });
        },

        /**
         * LẤY DANH SÁCH TẤT CẢ NGƯỜI ĐANG ONLINE (dùng cho tab "Đang online" trong mục Bạn Bè).
         * Trả về mảng: [{ username, nickname, fullname }]
         */
        listAllOnlineUsers: function () {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_USERS().once('value').then(function (snapshot) {
                const result = [];
                snapshot.forEach(function (child) {
                    const val = child.val();
                    if (val && val.activeSession && val.activeSession.sessionId) {
                        result.push({
                            username: decodeUserKey(child.key),
                            nickname: val.nickname || '',
                            fullname: val.fullname || ''
                        });
                    }
                });
                return result;
            });
        },

        /**
         * XOÁ BẠN — gỡ liên kết 2 chiều.
         */
        removeFriend: function (myUsername, friendUsername) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            const updates = {};
            updates['friends/' + encodeUserKey(myUsername) + '/' + encodeUserKey(friendUsername)] = null;
            updates['friends/' + encodeUserKey(friendUsername) + '/' + encodeUserKey(myUsername)] = null;
            return db.ref().update(updates).then(function () { return { status: 'ok' }; });
        },

        // ========================================================================
        // VI. QUẢN LÝ TÀI KHOẢN — XOÁ (MỀM) / KHÔI PHỤC
        // ========================================================================

        /**
         * XOÁ TÀI KHOẢN (xoá mềm — đánh dấu deleted:true, KHÔNG mất dữ liệu để Admin có thể khôi phục).
         * Tài khoản đã bị đánh dấu xoá sẽ không đăng nhập được nữa (login() sẽ từ chối) cho tới khi
         * Admin bấm Khôi Phục.
         * actorUsername: người thực hiện thao tác (dùng khi tự người chơi xoá tài khoản của chính mình).
         */
        deleteAccount: function (targetUsername, actorIsAdmin) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_USER(targetUsername).update({
                deleted: true,
                deletedAt: firebase.database.ServerValue.TIMESTAMP,
                activeSession: null
            }).then(function () { return { status: 'ok' }; });
        },

        /**
         * KHÔI PHỤC TÀI KHOẢN ĐÃ XOÁ — chỉ Admin gọi hàm này (kiểm tra quyền ở phía giao diện trước khi gọi).
         */
        restoreAccount: function (targetUsername) {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_USER(targetUsername).update({ deleted: false, deletedAt: null })
                .then(function () { return { status: 'ok' }; });
        },

        /**
         * DANH SÁCH ĐẦY ĐỦ TẤT CẢ TÀI KHOẢN ĐÃ TẠO (chỉ dành cho Admin) — bao gồm cả người đang online,
         * offline, và đã bị xoá mềm. Trả về mảng:
         * [{ username, nickname, fullname, level, isRootAdmin, online, deleted }]
         */
        listAllAccountsFull: function () {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_USERS().once('value').then(function (snapshot) {
                const result = [];
                snapshot.forEach(function (child) {
                    const val = child.val() || {};
                    result.push({
                        username: decodeUserKey(child.key),
                        nickname: val.nickname || '',
                        fullname: val.fullname || '',
                        level: (typeof val.level === 'number') ? val.level : 1,
                        isRootAdmin: !!val.isRootAdmin,
                        online: !!(val.activeSession && val.activeSession.sessionId),
                        deleted: !!val.deleted
                    });
                });
                return result;
            });
        },

        /**
         * DANH SÁCH NGƯỜI OFFLINE (không đang có phiên hoạt động, chưa bị xoá) — dùng cho tab "Offline"
         * trong Danh Sách Người Chơi, chỉ Admin thấy được tab này.
         */
        listOfflineUsers: function () {
            if (!db) return Promise.reject(_initError || new Error('Firebase chưa sẵn sàng'));
            return REF_USERS().once('value').then(function (snapshot) {
                const result = [];
                snapshot.forEach(function (child) {
                    const val = child.val() || {};
                    const isOnline = !!(val.activeSession && val.activeSession.sessionId);
                    if (!isOnline && !val.deleted) {
                        result.push({
                            username: decodeUserKey(child.key),
                            nickname: val.nickname || '',
                            fullname: val.fullname || ''
                        });
                    }
                });
                return result;
            });
        }
    };

    // LƯU Ý QUAN TRỌNG: KHÔNG tự động xoá activeSession khi đóng tab/tải lại trang (beforeunload) nữa —
    // người chơi phải luôn giữ được đăng nhập kể cả khi đóng hẳn trình duyệt rồi mở lại. Phiên chỉ được
    // giải phóng khi người dùng CHỦ ĐỘNG bấm "Đăng Xuất" (gọi FirebaseSync.logout ở trên).

})(window);
