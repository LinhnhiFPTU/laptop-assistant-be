require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");

const app = express();
app.use(cors());
app.use(express.json());

const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);

const chatRoutes = require("./chat/chat");
app.use("/api/chat", chatRoutes);

const cartRouter = require("./routes/cart");
app.use("/api/cart", cartRouter);

// PostgreSQL setup
const pool = require("./db");

// Swagger config
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Laptop API",
      version: "1.0.0",
      description: "API mô tả các chức năng liên quan đến danh sách laptop",
    },
    servers: [
      {
        url: "http://localhost:3001",
      },
    ],
  },
  apis: ["./index.js"], // Swagger sẽ quét chính file này
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Đăng ký tài khoản mới
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               fullName:
 *                 type: string
 *     responses:
 *       201:
 *         description: Đăng ký thành công
 *       400:
 *         description: Email đã tồn tại
 *       500:
 *         description: Lỗi server
 */

/**
 * @swagger
 * /api/laptops:
 *   get:
 *     summary: Lấy danh sách laptop
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Trang hiện tại
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Số lượng mỗi trang
 *       - in: query
 *         name: brand
 *         schema:
 *           type: string
 *         description: Lọc theo hãng
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Tìm kiếm theo tên hoặc CPU
 *     responses:
 *       200:
 *         description: Thành công, trả về danh sách laptop
 */
app.get("/api/laptops", async (req, res) => {
  const { page = 1, limit = 20, brand, q } = req.query;
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];

  if (brand) {
    params.push(brand);
    where.push(`brand ILIKE $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(name ILIKE $${params.length} OR processor_name ILIKE $${params.length})`
    );
  }

  params.push(limit, offset);
  const sql = `
    SELECT * FROM laptops
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length};
  `;

  try {
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB query failed" });
  }
});

/**
 * @swagger
 * /api/laptops/{id}:
 *   get:
 *     summary: Lấy chi tiết một laptop
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID của laptop
 *     responses:
 *       200:
 *         description: Thành công, trả về chi tiết laptop
 *       404:
 *         description: Không tìm thấy laptop
 */
app.get("/api/laptops/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM laptops WHERE id = $1", [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "DB query failed" });
  }
});

/**
 * @swagger
 * /api/cart/{userId}/add:
 *   post:
 *     summary: Thêm sản phẩm vào giỏ hàng
 *     description: Thêm sản phẩm vào giỏ hàng của người dùng.
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID người dùng
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *               - quantity
 *             properties:
 *               productId:
 *                 type: integer
 *               quantity:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Thêm sản phẩm vào giỏ hàng thành công
 *       400:
 *         description: Dữ liệu không hợp lệ hoặc lỗi truy vấn DB
 */

/**
 * @swagger
 * /api/cart/{customerId}:
 *   get:
 *     summary: Lấy giỏ hàng của khách hàng
 *     description: Lấy toàn bộ sản phẩm trong giỏ hàng theo ID người dùng.
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID của khách hàng
 *     responses:
 *       200:
 *         description: Danh sách sản phẩm trong giỏ hàng
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   quantity:
 *                     type: integer
 *                   product_id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   price:
 *                     type: number
 *                   image:
 *                     type: string
 *       500:
 *         description: Lỗi truy vấn dữ liệu
 */

/**
 * @swagger
 * /api/order:
 *   post:
 *     summary: Tạo đơn hàng mới
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: integer
 *               cartItems:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: integer
 *                     productName:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *                     price:
 *                       type: number
 *               promoCode:
 *                 type: string
 *               paymentMethod:
 *                 type: string
 *     responses:
 *       200:
 *         description: Thành công, trả về thông tin đơn hàng
 *       500:
 *         description: Lỗi khi tạo đơn hàng
 */
app.post("/api/order", async (req, res) => {
  const { customerId, promoCode, paymentMethod, shippingAddress } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN"); // Bắt đầu giao dịch

    // 1. Lấy các sản phẩm từ giỏ hàng của khách hàng
    const cartItemsResult = await client.query(
      `SELECT c.product_id, l.name, c.quantity, l.price 
       FROM cart_items c
       JOIN laptops l ON c.product_id = l.id
       WHERE c.customer_id = $1`,
      [customerId]
    );

    const cartItems = cartItemsResult.rows;

    if (cartItems.length === 0) {
      return res.status(400).json({ error: "Giỏ hàng trống!" });
    }

    // 2. Tính tổng giá trị giỏ hàng và áp dụng khuyến mãi nếu có
    let totalAmount = cartItems.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0
    );
    let discountValue = 0;

    // Kiểm tra và áp dụng mã khuyến mãi
    if (promoCode) {
      const promoResult = await client.query(
        `SELECT * FROM promotions WHERE code = $1 AND start_date <= NOW() AND end_date >= NOW()`,
        [promoCode]
      );

      if (promoResult.rows.length > 0) {
        const promo = promoResult.rows[0];

        // Áp dụng khuyến mãi vào sản phẩm theo điều kiện
        for (let item of cartItems) {
          const conditionResult = await client.query(
            `SELECT * FROM promotion_conditions WHERE promotion_id = $1 AND field = 'brand' AND value = $2`,
            [promo.id, item.brand]
          );
          const processorResult = await client.query(
            `SELECT * FROM promotion_conditions WHERE promotion_id = $1 AND field = 'processor_brand' AND value = $2`,
            [promo.id, item.processor_brand]
          );

          if (
            conditionResult.rows.length > 0 ||
            processorResult.rows.length > 0
          ) {
            if (promo.discount_type === "percentage") {
              discountValue += (item.price * promo.discount_value) / 100;
            } else if (promo.discount_type === "fixed") {
              discountValue += promo.discount_value;
            }
          }
        }
      }
    }

    // 3. Tính toán giá trị cuối cùng sau khi áp dụng khuyến mãi
    const finalAmount = totalAmount - discountValue;

    // 4. Tạo đơn hàng
    const orderResult = await client.query(
      `INSERT INTO orders (customer_id, total_amount, order_status, payment_status)
      VALUES ($1, $2, 'pending', 'unpaid') RETURNING id`,
      [customerId, finalAmount]
    );
    const orderId = orderResult.rows[0].id;

    // 5. Chuyển giỏ hàng vào bảng order_details
    for (let item of cartItems) {
      const originalPrice = item.price;
      const discountPrice =
        item.price - (promoCode ? (item.price * discountValue) / 100 : 0);
      await client.query(
        `INSERT INTO order_details (order_id, product_id, product_name, quantity, price, total, original_price, discount_price, promotion_code)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          orderId,
          item.product_id,
          item.name,
          item.quantity,
          originalPrice,
          item.quantity * discountPrice,
          originalPrice,
          discountPrice,
          promoCode,
        ]
      );
    }

    // 6. Lưu địa chỉ giao hàng
    if (shippingAddress) {
      await client.query(
        `INSERT INTO shipping_addresses (order_id, address, city, postal_code, country)
        VALUES ($1, $2, $3, $4, $5)`,
        [
          orderId,
          shippingAddress.address,
          shippingAddress.city,
          shippingAddress.postal_code,
          shippingAddress.country,
        ]
      );
    }

    // 7. Lưu phương thức thanh toán
    await client.query(
      `INSERT INTO payments (order_id, payment_method, payment_status)
      VALUES ($1, $2, 'unpaid')`,
      [orderId, paymentMethod]
    );

    // Cam kết giao dịch
    await client.query("COMMIT");
    res
      .status(200)
      .json({ message: "Đơn hàng đã được tạo thành công", orderId });
  } catch (err) {
    await client.query("ROLLBACK"); // Rollback nếu có lỗi
    console.error(err);
    res.status(500).json({ error: "Lỗi khi tạo đơn hàng" });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/chat:
 *   post:
 *     summary: Gửi câu hỏi đến chatbot và nhận trả lời
 *     description: Gửi câu hỏi về đơn hàng và nhận câu trả lời từ chatbot tích hợp Bedrock.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       example: "user"
 *                     content:
 *                       type: string
 *                       example: "Hãy cho tôi biết tình trạng đơn hàng của tôi"
 *     responses:
 *       200:
 *         description: Trả về câu trả lời từ chatbot.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reply:
 *                   type: string
 *                   example: "Đơn hàng của bạn đã được giao."
 *       500:
 *         description: Lỗi server.
 *       401:
 *         description: Lỗi xác thực.
 */

/**
 * @swagger
 * /api/auth/signin:
 *   post:
 *     summary: Đăng nhập tài khoản
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Đăng nhập thành công, trả về accessToken
 *       401:
 *         description: Tài khoản không tồn tại hoặc sai mật khẩu
 *       500:
 *         description: Lỗi server
 */

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Lấy thông tin người dùng từ accessToken
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Trả về thông tin người dùng
 *       401:
 *         description: Thiếu token
 *       403:
 *         description: Token không hợp lệ
 */

/**
 * @swagger
 * /api/chat:
 *   post:
 *     summary: Chatbot – trả lời thông tin public / đơn hàng cá nhân
 *     tags: [Chat]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               question:
 *                 type: string
 *     responses:
 *       200:
 *         description: OK
 *       500:
 *         description: Lỗi hệ thống
 */

// GET /api/promotions/available
/**
 * @swagger
 * /promotions/available:
 *   get:
 *     summary: Lấy danh sách mã khuyến mãi đang hoạt động
 *     tags: [Promotions]
 *     responses:
 *       200:
 *         description: Danh sách khuyến mãi
 */
app.get("/api/promotions/available", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, description, discount_type, discount_value
       FROM promotions
       WHERE start_date <= NOW() AND end_date >= NOW()`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Không lấy được mã khuyến mãi" });
  }
});

// Khởi động server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`🚀 Backend chạy tại http://localhost:${PORT}`)
);
