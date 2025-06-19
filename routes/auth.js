const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// POST /api/auth/signin
router.post("/signin", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT c.id, c.email, c.password, c.name, roles.name as role
       FROM customers as c
       JOIN roles ON c.role_id = roles.id
       WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];
    if (!user)
      return res.status(401).json({ error: "Tài khoản không tồn tại" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Sai mật khẩu" });

    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ accessToken });
  } catch (err) {
    console.error("❌ Lỗi signin:", err);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// GET /api/auth/me
router.get("/me", (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Thiếu token" });

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ user });
  } catch (err) {
    res.status(403).json({ error: "Token không hợp lệ" });
  }
});

module.exports = router;

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { email, password, fullName } = req.body;

  try {
    // Kiểm tra email đã tồn tại
    const existing = await pool.query(
      "SELECT * FROM customers WHERE email = $1",
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Email đã tồn tại" });
    }

    const hash = await bcrypt.hash(password, 10);

    // Gán mặc định role_id = 1 (Customer)
    const insertResult = await pool.query(
      `INSERT INTO customers (email, password, name, role_id)
       VALUES ($1, $2, $3, 1) RETURNING id`,
      [email, hash, fullName]
    );

    res
      .status(201)
      .json({ message: "Đăng ký thành công", userId: insertResult.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi server" });
  }
});
