const express = require("express");
const router = express.Router();
const pool = require("../db");

router.post("/:userId/add", async (req, res) => {
  const { userId } = req.params;
  const { productId, quantity = 1 } = req.body;

  if (!userId || !productId) {
    return res.status(400).json({ error: "Thiếu userId hoặc productId" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO cart_items (customer_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
       RETURNING *`,
      [userId, productId, quantity]
    );
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Lỗi khi thêm vào giỏ hàng:", err);
    res.status(500).json({ error: "Thêm sản phẩm vào giỏ thất bại" });
  }
});

/*────────────────────────────
  GET /api/cart/:customerId
  Lấy toàn bộ giỏ hàng của KH
────────────────────────────*/
router.get("/:customerId", async (req, res) => {
  const { customerId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT c.customer_id,
              c.product_id,
              c.quantity,
              l.name,
              l.price,
              l.image
       FROM cart_items c
       JOIN laptops l ON l.id = c.product_id
       WHERE c.customer_id = $1`,
      [customerId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Lỗi khi lấy giỏ hàng:", err);
    res.status(500).json({ error: "DB error (get cart)" });
  }
});

router.post("/:customerId/checkout", async (req, res) => {
  const { customerId } = req.params;
  const { promoCode, paymentMethod, shippingAddress } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Lấy giỏ hàng
    const { rows: cart } = await client.query(
      `SELECT c.product_id, c.quantity,
              l.price, l.brand, l.processor_brand, l.name
       FROM cart_items c
       JOIN laptops l ON l.id = c.product_id
       WHERE c.customer_id = $1`,
      [customerId]
    );

    if (cart.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Giỏ hàng trống" });
    }

    const total = cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    let discount = 0;
    let promo = null;
    let conditions = [];

    // 2. Xử lý khuyến mãi
    if (promoCode) {
      const { rows } = await client.query(
        `SELECT * FROM promotions
         WHERE code = $1 AND start_date <= NOW() AND end_date >= NOW()`,
        [promoCode]
      );
      promo = rows[0];

      if (promo) {
        const { rows: conditions } = await client.query(
          `SELECT * FROM promotion_conditions WHERE promotion_id = $1`,
          [promo.id]
        );

        const matchItem = (item, condition) => {
          const value = item[condition.field];
          return condition.condition_type === "contains"
            ? value.includes(condition.value)
            : value === condition.value;
        };

        const matchedItems =
          conditions.length > 0
            ? cart.filter((item) =>
                conditions.some((cond) => matchItem(item, cond))
              )
            : cart; // Nếu không có điều kiện => áp dụng toàn bộ

        if (promo.discount_type === "percentage") {
          for (const item of matchedItems) {
            discount +=
              (item.price * item.quantity * promo.discount_value) / 100;
          }
        } else if (promo.discount_type === "fixed") {
          if (matchedItems.length > 0) {
            discount = promo.discount_value;
          }
        }
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

    // 4. Thêm chi tiết đơn hàng
    for (const it of cart) {
      let appliedPrice = it.price;

      if (promo) {
        const { rows: matched } = await client.query(
          `SELECT 1 FROM promotion_conditions
       WHERE promotion_id = $1 AND
        ((field = 'brand' AND value = $2) OR (field = 'processor_brand' AND value = $3))`,
          [promo.id, it.brand, it.processor_brand]
        );

        const isMatched = matched.length > 0 || conditions.length === 0;

        if (isMatched) {
          if (promo.discount_type === "percentage") {
            appliedPrice = it.price * (1 - promo.discount_value / 100);
          } else if (promo.discount_type === "fixed") {
            // Phân bổ đều khuyến mãi cho sản phẩm hợp lệ
            const eligibleItems = cart.filter(
              (i) =>
                conditions.length === 0 ||
                conditions.some((cond) => {
                  const val = i[cond.field];
                  return cond.condition_type === "contains"
                    ? val.includes(cond.value)
                    : val === cond.value;
                })
            );

            const sharedDiscount = promo.discount_value / eligibleItems.length;
            if (eligibleItems.some((i) => i.product_id === it.product_id)) {
              appliedPrice = it.price - sharedDiscount / it.quantity;
            }
          }
        }
      }

      const totalLine = appliedPrice * it.quantity;

      await client.query(
        `INSERT INTO order_details
     (order_id, product_id, quantity, price, total,
      original_price, discount_price, promotion_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          order.id,
          it.product_id,
          it.quantity,
          appliedPrice,
          totalLine,
          it.price,
          it.price * it.quantity - totalLine,
          promoCode || null,
        ]
      );
    }

    // 5. Thêm địa chỉ giao hàng nếu có
    if (shippingAddress) {
      await client.query(
        `INSERT INTO shipping_addresses
         (order_id, address, city, postal_code, country)
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

    // 6. Thêm thông tin thanh toán
    await client.query(
      `INSERT INTO payments (order_id, payment_method, payment_status)
       VALUES ($1, $2, 'paid')`,
      [order.id, paymentMethod]
    );

    // 7. Xóa giỏ hàng sau khi checkout
    await client.query(`DELETE FROM cart_items WHERE customer_id = $1`, [
      customerId,
    ]);

    await client.query("COMMIT");

    res.json({
      orderId: order.id,
      total,
      discount,
      finalAmount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Checkout failed" });
  } finally {
    client.release();
  }
});

module.exports = router;
