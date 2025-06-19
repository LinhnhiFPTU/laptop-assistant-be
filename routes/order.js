// routes/orders.js
const express = require("express");
const { authenticate } = require("./auth");
const pool = require("../db");
const router = express.Router();

router.get("/my-orders", authenticate, async (req, res) => {
  const userId = req.user.id; // Dữ liệu người dùng lấy từ token JWT

  try {
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE customer_id = $1",
      [userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Lỗi khi lấy đơn hàng" });
  }
});

module.exports = router;
