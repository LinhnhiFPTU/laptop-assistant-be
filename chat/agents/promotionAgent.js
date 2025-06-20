const pool = require("../../db");

const PROMO_KW = [
  "mã giảm giá",
  "khuyến mãi",
  "promo",
  "promotion",
  "mã khuyến mãi",
  "giảm bao nhiêu",
  "được giảm",
  "discount",
  "voucher",
  "ưu đãi",
];

const fmtVND = (n) => new Intl.NumberFormat("vi-VN").format(+n) + " VND";

class PromotionAgent {
  static isPromotionQuery(question) {
    return PROMO_KW.some((k) => question.toLowerCase().includes(k));
  }

  static async getPromotionContext() {
    try {
      const { rows } = await pool.query(
        `SELECT code, description, discount_type, discount_value
         FROM promotions
         WHERE start_date <= NOW() AND end_date >= NOW()`
      );
      
      if (rows.length) {
        const list = rows
          .map((p) => {
            const val =
              p.discount_type === "percentage"
                ? `${p.discount_value}%`
                : `${fmtVND(p.discount_value)}`;
            return `• Mã \`${p.code}\`: ${p.description} (Giảm ${val})`;
          })
          .join("\n");
        return `\n\nCác khuyến mãi đang có:\n${list}`;
      } else {
        return `\n\nHiện không có khuyến mãi nào đang hoạt động.`;
      }
    } catch (error) {
      console.error("Promotion query error:", error);
      return "";
    }
  }
}

module.exports = PromotionAgent;