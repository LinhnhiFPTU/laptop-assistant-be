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
 * /api/products:
 *   get:
 *     summary: Lấy danh sách sản phẩm
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
 *         name: type
 *         schema:
 *           type: string
 *         description: Lọc theo loại sản phẩm (laptop, mouse, keyboard, RAM, backpack)
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Lọc theo danh mục sản phẩm
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Tìm kiếm theo tên hoặc mô tả
 *     responses:
 *       200:
 *         description: Thành công, trả về danh sách sản phẩm
 */
app.get("/api/products", async (req, res) => {
  const { page = 1, limit = 20, brand, q, type, category } = req.query;
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];

  if (brand) {
    params.push(brand);
    where.push(`p.brand ILIKE $${params.length}`);
  }
  if (type) {
    params.push(type);
    where.push(`pt.name ILIKE $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`c.name ILIKE $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`
    );
  }

  params.push(limit, offset);
  const sql = `
    SELECT p.*, pt.name AS product_type, 
           ARRAY_AGG(c.name) AS categories
    FROM products p
    JOIN product_types pt ON p.product_type_id = pt.id
    LEFT JOIN product_categories pc ON p.id = pc.product_id
    LEFT JOIN categories c ON pc.category_id = c.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    GROUP BY p.id, pt.name
    ORDER BY p.id DESC
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
// app.get("/api/laptops/:id", async (req, res) => {
//   try {
//     // First, get the product and its type
//     const { rows: productRows } = await pool.query(
//       `SELECT p.*, pt.name AS product_type
//        FROM products p
//        JOIN product_types pt ON p.product_type_id = pt.id
//        WHERE p.id = $1`,
//       [req.params.id]
//     );
//     if (!productRows.length)
//       return res.status(404).json({ error: "Not found" });

//     const product = productRows[0];

//     if (product.product_type.toLowerCase() === "laptop") {
//       // If it's a laptop, join with laptop_specs
//       const { rows: laptopRows } = await pool.query(
//         `SELECT p.*, pt.name AS product_type, l.*
//          FROM products p
//          JOIN product_types pt ON p.product_type_id = pt.id
//          JOIN laptop_specs l ON p.id = l.product_id
//          WHERE p.id = $1`,
//         [req.params.id]
//       );
//       if (!laptopRows.length)
//         return res.status(404).json({ error: "Not found" });
//       return res.json(laptopRows[0]);
//     } else {
//       // If not a laptop, just return product info
//       return res.json(product);
//     }
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "DB query failed" });
//   }
// });
app.get("/api/laptops/:id", async (req, res) => {
  try {
    // Lấy thông tin sản phẩm, loại, và categories
    const { rows: productRows } = await pool.query(
      `
      SELECT 
        p.*, 
        pt.name AS product_type, 
        ARRAY_AGG(c.name) FILTER (WHERE c.name IS NOT NULL) AS categories
      FROM products p
      JOIN product_types pt ON p.product_type_id = pt.id
      LEFT JOIN product_categories pc ON p.id = pc.product_id
      LEFT JOIN categories c ON pc.category_id = c.id
      WHERE p.id = $1
      GROUP BY p.id, pt.name
      `,
      [req.params.id]
    );
    if (!productRows.length)
      return res.status(404).json({ error: "Not found" });

    const product = productRows[0];

    if (product.product_type.toLowerCase() === "laptop") {
      // Nếu là laptop, lấy thêm specs
      const { rows: specsRows } = await pool.query(
        `SELECT * FROM laptop_specs WHERE product_id = $1`,
        [req.params.id]
      );
      // Gộp specs vào product (nếu có)
      if (specsRows.length) {
        return res.json({ ...product, ...specsRows[0] });
      } else {
        // Không có specs, chỉ trả về product
        return res.json(product);
      }
    } else {
      // Không phải laptop, chỉ trả về product (không có specs)
      return res.json(product);
    }
  } catch (err) {
    console.error(err);
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
// app.post("/api/order", async (req, res) => {
//   // const { customerId, promoCode, paymentMethod, shippingAddress } = req.body;
//   const {
//     promoCode,
//     paymentMethod,
//     shippingAddress,
//     shippingMethod,
//     shippingFee,
//   } = req.body;

//   const client = await pool.connect();
//   try {
//     await client.query("BEGIN"); // Bắt đầu giao dịch

//     // 1. Lấy các sản phẩm từ giỏ hàng của khách hàng
//     const cartItemsResult = await client.query(
//       `SELECT c.product_id, l.name, c.quantity, l.price
//        FROM cart_items c
//        JOIN laptops l ON c.product_id = l.id
//        WHERE c.customer_id = $1`,
//       [customerId]
//     );

//     const cartItems = cartItemsResult.rows;

//     if (cartItems.length === 0) {
//       return res.status(400).json({ error: "Giỏ hàng trống!" });
//     }

//     // 2. Tính tổng giá trị giỏ hàng và áp dụng khuyến mãi nếu có
//     let totalAmount = cartItems.reduce(
//       (acc, item) => acc + item.price * item.quantity,
//       0
//     );
//     let discountValue = 0;

//     // Kiểm tra và áp dụng mã khuyến mãi
//     if (promoCode) {
//       const promoResult = await client.query(
//         `SELECT * FROM promotions WHERE code = $1 AND start_date <= NOW() AND end_date >= NOW()`,
//         [promoCode]
//       );

//       if (promoResult.rows.length > 0) {
//         const promo = promoResult.rows[0];

//         // Áp dụng khuyến mãi vào sản phẩm theo điều kiện
//         for (let item of cartItems) {
//           const conditionResult = await client.query(
//             `SELECT * FROM promotion_conditions WHERE promotion_id = $1 AND field = 'brand' AND value = $2`,
//             [promo.id, item.brand]
//           );
//           const processorResult = await client.query(
//             `SELECT * FROM promotion_conditions WHERE promotion_id = $1 AND field = 'processor_brand' AND value = $2`,
//             [promo.id, item.processor_brand]
//           );

//           if (
//             conditionResult.rows.length > 0 ||
//             processorResult.rows.length > 0
//           ) {
//             if (promo.discount_type === "percentage") {
//               discountValue += (item.price * promo.discount_value) / 100;
//             } else if (promo.discount_type === "fixed") {
//               discountValue += promo.discount_value;
//             }
//           }
//         }
//       }
//     }

//     // 3. Tính toán giá trị cuối cùng sau khi áp dụng khuyến mãi
//     const finalAmount = totalAmount - discountValue;

//     // 4. Tạo đơn hàng
//     const orderResult = await client.query(
//       `INSERT INTO orders (customer_id, total_amount, order_status, payment_status)
//       VALUES ($1, $2, 'pending', 'unpaid') RETURNING id`,
//       [customerId, finalAmount]
//     );
//     const orderId = orderResult.rows[0].id;

//     // 5. Chuyển giỏ hàng vào bảng order_details
//     for (let item of cartItems) {
//       const originalPrice = item.price;
//       const discountPrice =
//         item.price - (promoCode ? (item.price * discountValue) / 100 : 0);
//       await client.query(
//         `INSERT INTO order_details (order_id, product_id, product_name, quantity, price, total, original_price, discount_price, promotion_code)
//         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
//         [
//           orderId,
//           item.product_id,
//           item.name,
//           item.quantity,
//           originalPrice,
//           item.quantity * discountPrice,
//           originalPrice,
//           discountPrice,
//           promoCode,
//         ]
//       );
//     }

//     // 6. Lưu địa chỉ giao hàng
//     if (shippingAddress) {
//       await client.query(
//         `INSERT INTO shipping_addresses (order_id, address, city, postal_code, country)
//         VALUES ($1, $2, $3, $4, $5)`,
//         [
//           orderId,
//           shippingAddress.address,
//           shippingAddress.city,
//           shippingAddress.postal_code,
//           shippingAddress.country,
//         ]
//       );
//     }

//     // 7. Lưu phương thức thanh toán
//     await client.query(
//       `INSERT INTO payments (order_id, payment_method, payment_status)
//       VALUES ($1, $2, 'unpaid')`,
//       [orderId, paymentMethod]
//     );

//     // Cam kết giao dịch
//     await client.query("COMMIT");
//     res
//       .status(200)
//       .json({ message: "Đơn hàng đã được tạo thành công", orderId });
//   } catch (err) {
//     await client.query("ROLLBACK"); // Rollback nếu có lỗi
//     console.error(err);
//     res.status(500).json({ error: "Lỗi khi tạo đơn hàng" });
//   } finally {
//     client.release();
//   }
// });
app.post("/api/order", async (req, res) => {
  const {
    customerId,
    promoCode,
    paymentMethod,
    shippingAddress,
    shippingMethod,
    shippingFee,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Lấy giỏ hàng
    const { rows: cartItems } = await client.query(
      `SELECT c.product_id, l.name, c.quantity, l.price, l.brand, l.processor_brand 
       FROM cart_items c
       JOIN laptops l ON c.product_id = l.id
       WHERE c.customer_id = $1`,
      [customerId]
    );

    if (cartItems.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Giỏ hàng trống!" });
    }

    // 2. Tính tổng và khuyến mãi
    let totalAmount = cartItems.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0
    );
    let discountValue = 0;
    let promo = null;

    if (promoCode) {
      const { rows } = await client.query(
        `SELECT * FROM promotions 
         WHERE code = $1 AND start_date <= NOW() AND end_date >= NOW()`,
        [promoCode]
      );
      promo = rows[0];

      if (promo) {
        for (let item of cartItems) {
          const { rows: brandCond } = await client.query(
            `SELECT * FROM promotion_conditions 
             WHERE promotion_id = $1 AND field = 'brand' AND value = $2`,
            [promo.id, item.brand]
          );
          const { rows: cpuCond } = await client.query(
            `SELECT * FROM promotion_conditions 
             WHERE promotion_id = $1 AND field = 'processor_brand' AND value = $2`,
            [promo.id, item.processor_brand]
          );

          const matched = brandCond.length > 0 || cpuCond.length > 0;

          if (matched) {
            if (promo.discount_type === "percentage") {
              discountValue +=
                (item.price * item.quantity * promo.discount_value) / 100;
            } else if (promo.discount_type === "fixed") {
              // phân bổ khuyến mãi cố định đều cho sản phẩm hợp lệ
              discountValue += promo.discount_value;
            }
          }
        }
      }
    }

    // 3. Tính tổng cuối cùng
    const finalAmount =
      Math.max(totalAmount - discountValue, 0) + (shippingFee || 0);

    // 4. Tạo đơn hàng
    const {
      rows: [order],
    } = await client.query(
      `INSERT INTO orders (customer_id, total_amount, order_status, payment_status)
       VALUES ($1, $2, 'pending', 'unpaid') RETURNING id`,
      [customerId, finalAmount]
    );
    const orderId = order.id;

    // 5. Lưu chi tiết đơn hàng
    for (let item of cartItems) {
      let appliedPrice = item.price;

      if (promo) {
        const { rows: matched } = await client.query(
          `SELECT 1 FROM promotion_conditions
           WHERE promotion_id = $1 AND 
           ((field = 'brand' AND value = $2) OR 
            (field = 'processor_brand' AND value = $3))`,
          [promo.id, item.brand, item.processor_brand]
        );

        const isMatched = matched.length > 0;

        if (isMatched) {
          if (promo.discount_type === "percentage") {
            appliedPrice = item.price * (1 - promo.discount_value / 100);
          } else if (promo.discount_type === "fixed") {
            // phân bổ khuyến mãi cho mỗi sản phẩm
            const eligibleCount = cartItems.length;
            appliedPrice = item.price - promo.discount_value / eligibleCount;
          }
        }
      }

      const totalLine = appliedPrice * item.quantity;
      const discountLine = item.price * item.quantity - totalLine;

      await client.query(
        `INSERT INTO order_details
         (order_id, product_id, product_name, quantity, price, total, original_price, discount_price, promotion_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          orderId,
          item.product_id,
          item.name,
          item.quantity,
          appliedPrice,
          totalLine,
          item.price,
          discountLine,
          promoCode || null,
        ]
      );
    }

    // 6. Địa chỉ giao hàng
    if (shippingAddress) {
      await client.query(
        `INSERT INTO shipping_addresses
         (order_id, address, city, postal_code, country)
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

    // 7. Phương thức thanh toán
    await client.query(
      `INSERT INTO payments (order_id, payment_method, payment_status)
       VALUES ($1, $2, 'unpaid')`,
      [orderId, paymentMethod]
    );

    // 8. Ghi lại shipping method nếu cần
    if (shippingMethod) {
      await client.query(
        `INSERT INTO shipping_methods (order_id, method, fee)
         VALUES ($1, $2, $3)`,
        [orderId, shippingMethod, shippingFee || 0]
      );
    }

    // 9. Xóa giỏ hàng
    await client.query(`DELETE FROM cart_items WHERE customer_id = $1`, [
      customerId,
    ]);

    await client.query("COMMIT");
    res.json({
      message: "Đơn hàng đã được tạo thành công",
      orderId,
      total: totalAmount,
      discount: discountValue,
      shippingFee: shippingFee || 0,
      finalAmount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Checkout error:", err);
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
 * /api/promotions/available:
 *   get:
 *     summary: Lấy danh sách mã khuyến mãi đang hoạt động kèm điều kiện
 *     tags: [Promotions]
 *     responses:
 *       200:
 *         description: Danh sách khuyến mãi đang hoạt động
 */
app.get("/api/promotions/available", async (req, res) => {
  try {
    // Lấy danh sách khuyến mãi còn hiệu lực
    const { rows: promotions } = await pool.query(
      `SELECT id, code, description, discount_type, discount_value,
              TO_CHAR(start_date, 'YYYY-MM-DD') as start_date,
              TO_CHAR(end_date, 'YYYY-MM-DD') as end_date
       FROM promotions
       WHERE start_date <= NOW() AND end_date >= NOW()`
    );

    // Nếu không có khuyến mãi nào
    if (promotions.length === 0) return res.json([]);

    // Lấy ID của tất cả promotions
    const promoIds = promotions.map((p) => p.id);

    // Truy vấn điều kiện áp dụng
    const { rows: conditions } = await pool.query(
      `SELECT promotion_id, field, value, condition_type
       FROM promotion_conditions
       WHERE promotion_id = ANY($1::int[])`,
      [promoIds]
    );

    // Gộp điều kiện theo promotion_id
    const conditionMap = {};
    for (const cond of conditions) {
      if (!conditionMap[cond.promotion_id]) {
        conditionMap[cond.promotion_id] = [];
      }
      conditionMap[cond.promotion_id].push({
        field: cond.field,
        value: cond.value,
        condition_type: cond.condition_type,
      });
    }

    // Trả về promotions kèm theo conditions
    const result = promotions.map((promo) => ({
      ...promo,
      conditions: conditionMap[promo.id] || [],
    }));

    res.json(result);
  } catch (err) {
    console.error("Lỗi khi lấy danh sách khuyến mãi:", err);
    res.status(500).json({ error: "Không thể lấy danh sách khuyến mãi" });
  }
});

// Khởi động server
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Backend chạy tại http://localhost:${PORT}`)
);
