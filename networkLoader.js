/**
 * NetworkLoader - Quản lý logic giả lập mạng, tài khoản và gửi dữ liệu
 */
const NetworkLoader = {
  currentUser: null,

  // Xử lý Đăng Nhập
  login(nickname, username, password) {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (!username || !nickname) {
          resolve({ success: false, message: "Vui lòng điền đầy đủ thông tin!" });
          return;
        }

        // Lưu thông tin người dùng đang đăng nhập
        this.currentUser = {
          nickname: nickname,
          username: username,
          loginTime: new Date().toLocaleTimeString()
        };

        resolve({ 
          success: true, 
          user: this.currentUser,
          message: "Đăng nhập thành công!" 
        });
      }, 200); // Giả lập độ trễ mạng ngắn
    });
  },

  // Xử lý Đăng Xuất
  logout() {
    this.currentUser = null;
    return true;
  },

  // Lấy thông tin User hiện tại
  getCurrentUser() {
    return this.currentUser;
  }
};
