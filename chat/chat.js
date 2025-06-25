/* ------------------------------------------------------------------
   chat.js – Multi-collaborator agent architecture with supervisor
-------------------------------------------------------------------*/
require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");

// Import the supervisor agent
const SupervisorAgent = require("./agents/supervisorAgent");
const CartAgent = require("./agents/cartAgent");
const ProductInfoAgent = require("./agents/productInfoAgent");

/* ──────────────── ROUTER ─────────────── */
const router = express.Router();

// Store user session data (in memory for simplicity, use Redis or another store in production)
const userSessions = new Map();

router.post("/", async (req, res) => {
  const { question = "" } = req.body;
  const token = req.headers.authorization?.split(" ")[1];
  
  // Extract userId from token
  let userId = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
      console.log(`Extracted userId ${userId} from token`);
    } catch (err) {
      console.error("Error decoding token:", err);
    }
  }

  try {
    console.log(`Processing query: "${question}" for userId: ${userId || 'unknown'}`);
    
    // Check if we're waiting for a cart confirmation from this user
    const userSession = userId ? userSessions.get(userId) : null;
    
    if (userId && userSession && userSession.waitingForCartConfirmation) {
      // Check if the response is a confirmation to add to cart
      if (CartAgent.isCartConfirmation(question)) {
        console.log(`Adding product ${userSession.productId} to cart for user ${userId}`);
        
        if (!userId || !userSession.productId) {
          console.error(`Missing userId (${userId}) or productId (${userSession.productId})`);
          return res.json({
            answer: "Xin lỗi, không thể thêm sản phẩm vào giỏ hàng do thiếu thông tin. Vui lòng đăng nhập và thử lại."
          });
        }
        
        // Add the product to the cart
        const result = await CartAgent.addToCart(
          userId, 
          userSession.productId, 
          userSession.quantity || 1
        );
        
        // Clear the session state
        userSessions.delete(userId);
        
        // Return the result
        return res.json({ 
          answer: result.success 
            ? `${result.message} Bạn có thể tiếp tục mua sắm hoặc xem giỏ hàng để thanh toán.` 
            : result.message 
        });
      } else {
        // User declined or gave an unclear response
        userSessions.delete(userId);
        return res.json({ 
          answer: "Đã hủy thêm sản phẩm vào giỏ hàng. Bạn cần hỗ trợ gì thêm không?" 
        });
      }
    }

    // Normal query processing
    const answer = await SupervisorAgent.processQuery(question, token);
    
    // Check if the answer is a product display with cart option
    if (typeof answer === 'object' && answer.isProductDisplay && answer.waitingForCartConfirmation) {
      // Make sure we have a userId from the token
      if (userId) {
        // Store the session state
        userSessions.set(userId, {
          waitingForCartConfirmation: true,
          productId: answer.productId,
          productName: answer.productName,
          quantity: 1,
          userId: userId
        });
      }
      
      // Return just the text to display
      return res.json({ answer: answer.text });
    }

    res.json({ answer });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

module.exports = router;
