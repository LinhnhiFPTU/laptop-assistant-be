const express = require("express");
const router = express.Router();
const pool = require("../db");

// ─────────────────────────────────────────────
// 1. Thêm sản phẩm vào giỏ hàng
// ─────────────────────────────────────────────
router.post("/:userId/add", async (req, res) => {
  const { userId } = req.params;
  const { productId, quantity = 1 } = req.body;

  const userIdInt = parseInt(userId);
  const productIdInt = parseInt(productId);
  const quantityInt = parseInt(quantity);

  if (isNaN(userIdInt) || isNaN(productIdInt)) {
    return res.status(400).json({ error: "userId và productId phải là số nguyên" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO cart_items (customer_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
       RETURNING *`,
      [userIdInt, productIdInt, quantityInt]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Lỗi khi thêm vào giỏ hàng:", err);
    res.status(500).json({ error: "Thêm sản phẩm vào giỏ thất bại" });
  }
});

// ─────────────────────────────────────────────
// 2. Lấy toàn bộ giỏ hàng
// ─────────────────────────────────────────────
router.get("/:customerId", async (req, res) => {
  const { customerId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT c.customer_id, c.product_id, c.quantity,
              p.name, p.price, p.image, p.brand
       FROM cart_items c
       JOIN products p ON p.id = c.product_id
       WHERE c.customer_id = $1`,
      [customerId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Lỗi khi lấy giỏ hàng:", err);
    res.status(500).json({ error: "DB error (get cart)" });
  }
});

// ─────────────────────────────────────────────
// 3. Xoá sản phẩm khỏi giỏ
// ─────────────────────────────────────────────
router.delete("/:userId/remove/:productId", async (req, res) => {
  const { userId, productId } = req.params;

  try {
    await pool.query(
      `DELETE FROM cart_items WHERE customer_id = $1 AND product_id = $2`,
      [userId, productId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Lỗi khi xoá sản phẩm:", err);
    res.status(500).json({ error: "Xóa sản phẩm khỏi giỏ hàng thất bại" });
  }
});

// ─────────────────────────────────────────────
// 4. Thanh toán (checkout)
// ─────────────────────────────────────────────
router.post("/:customerId/checkout", async (req, res) => {
  const { customerId } = req.params;
  const { promoCode, paymentMethod, shippingAddress } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Lấy giỏ hàng
    const { rows: cart } = await client.query(
      `SELECT c.product_id, c.quantity, p.price, p.brand, p.name
       FROM cart_items c
       JOIN products p ON p.id = c.product_id
       WHERE c.customer_id = $1`,
      [customerId]
    );

    if (cart.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Giỏ hàng trống" });
    }

    let total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    let discount = 0;
    let promo = null;
    let conditions = [];

    // 2. Kiểm tra và xử lý khuyến mãi
    if (promoCode) {
      const { rows } = await client.query(
        `SELECT * FROM promotions
         WHERE code = $1 AND start_date <= NOW() AND end_date >= NOW()`,
        [promoCode]
      );
      promo = rows[0];

      if (promo) {
        const condRes = await client.query(
          `SELECT * FROM promotion_conditions WHERE promotion_id = $1`,
          [promo.id]
        );
        conditions = condRes.rows;

        const isItemMatched = (item, cond) => {
          const val = item[cond.field];
          return cond.condition_type === "contains"
            ? String(val).includes(cond.value)
            : val === cond.value;
        };

        const eligibleItems = conditions.length
          ? cart.filter((item) =>
              conditions.some((cond) => isItemMatched(item, cond))
            )
          : cart;

        if (promo.discount_type === "percentage") {
          for (const item of eligibleItems) {
            discount += (item.price * item.quantity * promo.discount_value) / 100;
          }
        } else if (promo.discount_type === "fixed" && eligibleItems.length > 0) {
          discount = promo.discount_value;
        }

        // Gắn lại eligibleItems cho phần tạo order_details
        cart.forEach((item) => {
          item.eligible = eligibleItems.some((el) => el.product_id === item.product_id);
        });
      }
    }

    const finalAmount = Math.max(total - discount, 0);

    // 3. Tạo đơn hàng
    const {
      rows: [order],
    } = await client.query(
      `INSERT INTO orders (customer_id, total_amount, order_status, payment_status)
       VALUES ($1, $2, 'complete', 'paid') RETURNING id`,
      [customerId, finalAmount]
    );

    // 4. Tạo order_details
    for (const item of cart) {
      let appliedPrice = item.price;

      if (promo && item.eligible) {
        if (promo.discount_type === "percentage") {
          appliedPrice = item.price * (1 - promo.discount_value / 100);
        } else if (promo.discount_type === "fixed") {
          const eligibleCount = cart.filter((i) => i.eligible).length;
          const sharedDiscount = promo.discount_value / eligibleCount;
          appliedPrice = item.price - sharedDiscount / item.quantity;
        }
      }

      const totalLine = appliedPrice * item.quantity;

      await client.query(
        `INSERT INTO order_details
         (order_id, product_id, quantity, price, total,
          original_price, discount_price, promotion_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          order.id,
          item.product_id,
          item.quantity,
          appliedPrice,
          totalLine,
          item.price,
          item.price * item.quantity - totalLine,
          item.eligible ? promoCode : null,
        ]
      );
    }

    // 5. Lưu địa chỉ giao hàng nếu có
    if (shippingAddress) {
      await client.query(
        `INSERT INTO shipping_addresses (order_id, address, city, postal_code, country)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          order.id,
          shippingAddress.addr,
          shippingAddress.city,
          shippingAddress.postal,
          shippingAddress.country,
        ]
      );
    }

    // 6. Thanh toán
    await client.query(
      `INSERT INTO payments (order_id, payment_method, payment_status)
       VALUES ($1, $2, 'paid')`,
      [order.id, paymentMethod]
    );

    // 7. Xoá giỏ hàng
    await client.query(`DELETE FROM cart_items WHERE customer_id = $1`, [customerId]);

    await client.query("COMMIT");

    res.json({ orderId: order.id, total, discount, finalAmount });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Checkout error:", err.message, err.stack);
    res.status(500).json({ error: "Checkout failed" });
  } finally {
    client.release();
  }
});

module.exports = router;
