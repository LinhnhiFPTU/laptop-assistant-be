const axios = require("axios");

class CartAgent {
  static isCartConfirmation(question) {
    const lowerQuestion = question.toLowerCase().trim();
    
    // Check for positive responses in Vietnamese
    const positiveResponses = [
      "có", "co", "đúng", "dung", "ok", "oke", "okay", "yes", "đồng ý", "dong y", 
      "chắc chắn", "chac chan", "muốn", "muon", "thêm", "them"
    ];
    
    // Check if the response is a positive confirmation
    return positiveResponses.some(response => 
      lowerQuestion === response || 
      lowerQuestion.includes(response)
    );
  }

  static async addToCart(userId, productId, quantity = 1) {
    try {
      // Validate required parameters
      if (!userId || !productId) {
        return {
          success: false,
          message: "Thiếu thông tin người dùng hoặc sản phẩm.",
          error: "Missing userId or productId"
        };
      }
      
      // Ensure quantity is a number
      const qty = Number(quantity) || 1;
      
      // Call the cart API to add the product
      const response = await axios.post(
        `http://localhost:${process.env.PORT || 3001}/api/cart/${userId}/add`,
        { productId, quantity: qty }
      );
      
      return {
        success: true,
        message: "Đã thêm sản phẩm vào giỏ hàng thành công!",
        data: response.data
      };
    } catch (error) {
      console.error("Error adding product to cart:", error);
      return {
        success: false,
        message: "Không thể thêm sản phẩm vào giỏ hàng. Vui lòng thử lại sau.",
        error: error.message
      };
    }
  }
}

module.exports = CartAgent;