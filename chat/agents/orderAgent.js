const pool = require("../../db");
const jwt = require("jsonwebtoken");

// Keywords that indicate a query about a specific user's order
const ORDER_KW = [
  "đơn hàng của tôi",
  "đơn của tôi",
  "mã đơn của tôi", 
  "my order",
  "tôi đã đặt",
  "tôi mua",
  "tôi đã mua",
  "tracking đơn hàng",
  "vận chuyển đơn hàng của tôi",
  "giao hàng của tôi",
  "tình trạng đơn hàng",
  "shipping của tôi",
  "tôi đã thanh toán",
  "hóa đơn của tôi",
];

const fmtVND = (n) => new Intl.NumberFormat("vi-VN").format(+n) + " VND";
const fmtDate = (d) => new Date(d).toLocaleString("vi-VN", { hour12: false });

const formatOrders = (rows) =>
  rows
    .map(
      (o) =>
        `• Đơn #${o.id} – ${fmtVND(o.total_amount)}\n  • Trạng thái: ${
          o.order_status
        }\n  • Thanh toán: ${
          o.payment_status === "paid" ? "Đã thanh toán" : "Chưa thanh toán"
        }\n  • Tạo lúc: ${fmtDate(o.created_at)}`
    )
    .join("\n\n");

class OrderAgent {
  static isOrderQuery(question) {
    const lowerQuestion = question.toLowerCase();
    
    // Check for specific personal order keywords
    if (ORDER_KW.some((k) => lowerQuestion.includes(k))) {
      return true;
    }
    
    // More sophisticated check for personal context
    const hasOrderWord = lowerQuestion.includes('đơn hàng') || 
                        lowerQuestion.includes('order') || 
                        lowerQuestion.includes('mua') ||
                        lowerQuestion.includes('thanh toán');
                        
    const hasPersonalContext = lowerQuestion.includes('tôi') || 
                              lowerQuestion.includes('của mình') || 
                              lowerQuestion.includes('của tôi') ||
                              lowerQuestion.includes('mình') ||
                              lowerQuestion.includes('của em');
    
    // Only return true if both order-related and personal context are present
    return hasOrderWord && hasPersonalContext;
  }

  static async getOrderContext(token) {
    if (!token) return "";
    
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await pool.query(
        "SELECT * FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 3",
        [user.userId]
      );
      
      return rows.length
        ? `\n\nĐơn hàng của bạn:\n${formatOrders(rows)}`
        : "\n\nBạn chưa có đơn hàng nào.";
    } catch (error) {
      console.error("Order query error:", error);
      return "";
    }
  }
}

module.exports = OrderAgent;