/**
 * ============================================================================
 * MAINROUTER.JS - HẠT NHÂN TRUNG CHUYỂN & ĐIỀU PHỐI TOÀN CỤC (CORE EVENT BUS)
 * ============================================================================
 * Nhiệm vụ:
 * 1. Quản lý Đăng ký & Phân phát Sự kiện (Event Dispatcher)
 * 2. Quản lý Máy Trạng Thái Game (Game State Machine)
 * 3. Hàng đợi Xử lý Sự kiện Bất đồng bộ (Async Event Queue)
 * 4. Bắt lỗi Trung tâm & Kiểm soát An toàn Dữ liệu (Error Handling & Interceptor)
 * 5. Tích hợp GameAPI Hệ thống (System Bridges for Lua/Python/JS)
 */

(function (window) {
    'use strict';

    // ========================================================================
    // I. KHỞI TẠO CẤU TRÚC DỮ LIỆU NỘI BỘ (CORE PRIVATE VARIABLES)
    // ========================================================================
    
    // Cuốn danh bạ lưu trữ danh sách sự kiện và các file đăng ký lắng nghe
    const _eventRegistry = new Map();

    // Hàng đợi sự kiện (tránh tình trạng dồn dập sự kiện làm đơ trình duyệt)
    const _eventQueue = [];
    let _isProcessingQueue = false;

    // Các trạng thái hợp lệ của Game (State Machine)
    const GAME_STATES = {
        BOOT: 'BOOT',             // Đang tải tài nguyên hệ thống
        LOBBY: 'LOBBY',           // Trong phòng chờ / Tạo phòng
        MAP_LOADING: 'MAP_LOAD',  // Đang tải bản đồ
        BOARD_TURN: 'BOARD_TURN', // Lượt di chuyển trên bản đồ bàn cờ
        MINIGAME: 'MINIGAME',     // Đang trong màn chơi Mini-game
        PAUSED: 'PAUSED',         // Tạm dừng
        GAME_OVER: 'GAME_OVER'    // Kết thúc trận đấu
    };

    let _currentState = GAME_STATES.BOOT;
    const _stateChangeListeners = [];

    // ========================================================================
    // II. HỆ THỐNG MÁY TRẠNG THÁI (GAME STATE MACHINE)
    // ========================================================================
    
    const StateManager = {
        /**
         * Lấy trạng thái hiện tại của Game
         */
        getState: function () {
            return _currentState;
        },

        /**
         * Chuyển sang trạng thái mới và thông báo tới toàn hệ thống
         */
        setState: function (newState, payload = {}) {
            if (!GAME_STATES[newState]) {
                console.error(`[MainRouter Error]: Trạng thái "${newState}" không hợp lệ!`);
                return false;
            }

            if (_currentState === newState) {
                console.warn(`[MainRouter Warning]: Game đã ở trong trạng thái "${newState}"`);
                return false;
            }

            const previousState = _currentState;
            _currentState = newState;

            console.log(`[MainRouter State]: %c${previousState} ➔ %c${_currentState}`, 
                'color: #ff9900; font-weight: bold;', 
                'color: #00ff00; font-weight: bold;', 
                payload
            );

            // Báo cho các lắng nghe trạng thái biết
            _stateChangeListeners.forEach(listener => {
                try {
                    listener(_currentState, previousState, payload);
                } catch (err) {
                    console.error(`[MainRouter Error]: Lỗi khi chuyển trạng thái sang ${newState}:`, err);
                }
            });

            // Tự động phát sự kiện chuyển trạng thái qua Bus chính
            MainRouter.emit('SYS_STATE_CHANGED', {
                from: previousState,
                to: _currentState,
                data: payload
            });

            return true;
        },

        /**
         * Đăng ký lắng nghe sự thay đổi trạng thái
         */
        onStateChange: function (callback) {
            if (typeof callback === 'function') {
                _stateChangeListeners.push(callback);
            }
        }
    };

    // ========================================================================
    // III. HỆ THỐNG TỔNG ĐÀI SỰ KIỆN (EVENT BUS ENGINE)
    // ========================================================================

    const MainRouter = {
        States: GAME_STATES,
        State: StateManager,

        /**
         * ĐĂNG KÝ LẮNG NGHE (Listen / Subscribe)
         * @param {string} eventName - Tên sự kiện (Ví dụ: 'PLAYER_ROLL_DICE')
         * @param {function} callback - Hàm sẽ chạy khi sự kiện xảy ra
         * @param {object} context - Định danh file đăng ký (dùng cho Debug)
         */
        listen: function (eventName, callback, context = 'UnknownModule') {
            if (typeof eventName !== 'string' || typeof callback !== 'function') {
                console.error('[MainRouter Error]: Lệnh listen() nhận tham số không hợp lệ!');
                return;
            }

            if (!_eventRegistry.has(eventName)) {
                _eventRegistry.set(eventName, []);
            }

            const listeners = _eventRegistry.get(eventName);
            listeners.push({ callback, context });

            console.log(`[MainRouter Register]: Module %c[${context}]%c đã đăng ký sự kiện: %c"${eventName}"`,
                'color: #00bfff; font-weight: bold;', 'color: auto;', 'color: #ff00ff; font-weight: bold;'
            );
        },

        /**
         * HỦY ĐĂNG KÝ (Unsubscribe)
         */
        off: function (eventName, callback) {
            if (!_eventRegistry.has(eventName)) return;

            const listeners = _eventRegistry.get(eventName);
            const index = listeners.findIndex(item => item.callback === callback);
            
            if (index !== -1) {
                listeners.splice(index, 1);
                console.log(`[MainRouter Unsubscribe]: Đã hủy đăng ký sự kiện "${eventName}"`);
            }
        },

        /**
         * PHÁT LỆNH SỰ KIỆN (Emit / Dispatch)
         * @param {string} eventName - Tên sự kiện cần kích hoạt
         * @param {object} data - Dữ liệu truyền đi kèm theo
         */
        emit: function (eventName, data = {}) {
            // Đẩy sự kiện vào hàng đợi xử lý
            _eventQueue.push({ eventName, data, timestamp: Date.now() });
            
            // Xử lý hàng đợi ngay lập tức nếu chưa có tiến trình nào chạy
            if (!_isProcessingQueue) {
                _processEventQueue();
            }
        },

        /**
         * TRA CỨU TỔNG ĐÀI (Debug Helper)
         * In ra toàn bộ thông tin các Module đang liên kết với nhau
         */
        debugDump: function () {
            console.group('=== MAINROUTER DEBUG DUMP ===');
            console.log('Trạng thái hiện tại:', _currentState);
            console.log('Tổng số loại sự kiện đã đăng ký:', _eventRegistry.size);
            
            _eventRegistry.forEach((listeners, eventName) => {
                console.group(`Sự kiện: "${eventName}" (${listeners.length} module nghe)`);
                listeners.forEach(item => console.log(`- Module: ${item.context}`));
                console.groupEnd();
            });
            console.groupEnd();
        }
    };

    // ========================================================================
    // IV. XỬ LÝ HÀNG ĐỢI NỘI BỘ (INTERNAL QUEUE PROCESSOR)
    // ========================================================================

    function _processEventQueue() {
        if (_eventQueue.length === 0) {
            _isProcessingQueue = false;
            return;
        }

        _isProcessingQueue = true;
        const currentEvent = _eventQueue.shift();
        const { eventName, data } = currentEvent;

        if (_eventRegistry.has(eventName)) {
            const listeners = _eventRegistry.get(eventName);
            
            // Chạy qua từng Module đã đăng ký nghe sự kiện này
            listeners.forEach(item => {
                try {
                    item.callback(data, currentEvent);
                } catch (err) {
                    console.error(`[MainRouter Crash]: Lỗi xảy ra tại Module [${item.context}] khi xử lý sự kiện "${eventName}":`, err);
                }
            });
        } else {
            console.warn(`[MainRouter Unhandled]: Sự kiện "${eventName}" được phát nhưng không có Module nào đăng ký lắng nghe.`);
        }

        // Tiếp tục xử lý sự kiện tiếp theo trong hàng đợi (sử dụng setTimeout để tránh tràn bộ nhớ Stack)
        setTimeout(_processEventQueue, 0);
    }

    // ========================================================================
    // V. KHỞI TẠO CẦU NỐI HỆ THỐNG LÊN WINDOW (GLOBAL EXPORT)
    // ========================================================================
    
    // Đăng ký hạt nhân vào không gian toàn cục
    window.MainRouter = MainRouter;

    // Thông báo hạt nhân đã chạy thành công
    console.log('%c[MainRouter]: Bộ móng Trung chuyển Toàn cục đã được khởi tạo thành công!', 'color: #00ff00; font-size: 14px; font-weight: bold;');

})(window);
