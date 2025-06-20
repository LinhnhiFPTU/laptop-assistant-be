const axios = require("axios");

// Keywords that indicate a product query
const PRODUCT_KW = [
  "sản phẩm",
  "laptop",
  "máy tính",
  "thiết bị",
  "model",
  "tham khảo",
  "thông số",
  "cấu hình",
  "giá",
  "mua",
  "đặc điểm",
  "chi tiết",
  "specs",
];

class ProductInfoAgent {
  static isProductQuery(question) {
    const lowerQuestion = question.toLowerCase();
    return PRODUCT_KW.some((k) => lowerQuestion.includes(k));
  }

  static extractProductName(question) {
    // Common patterns for product queries in Vietnamese
    const patterns = [
      /(?:sản phẩm|laptop|máy tính|thiết bị|model)\s+([A-Za-z0-9\s]+)/i,
      /(?:tham khảo|thông số|cấu hình|giá|mua)\s+([A-Za-z0-9\s]+)/i,
      /(?:về|thông tin về)\s+([A-Za-z0-9\s]+)/i,
    ];

    for (const pattern of patterns) {
      const match = question.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // If no pattern matches, try to extract any potential product name
    const words = question.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      // Look for words that might be part of a product name (brand names, etc.)
      const potentialBrands = [
        "Dell",
        "HP",
        "Lenovo",
        "Asus",
        "Acer",
        "MSI",
        "Apple",
        "MacBook",
      ];
      for (const brand of potentialBrands) {
        if (words[i].toLowerCase().includes(brand.toLowerCase())) {
          // Extract a few words after the brand name as the potential product
          const productName = words.slice(i, i + 3).join(" ");
          return productName.trim();
        }
      }
    }

    return null;
  }

  static async searchProducts(query) {
    try {
      // Use the internal API endpoint
      const response = await axios.get(
        `http://localhost:${process.env.PORT || 3001}/api/laptops`,
        {
          params: { q: query, limit: 3 },
        }
      );

      if (response.data && response.data.length > 0) {
        return response.data;
      }

      return null;
    } catch (error) {
      console.error("Product search error:", error);
      return null;
    }
  }

  static formatProductInfo(products) {
    if (!products || products.length === 0) {
      return "Không tìm thấy thông tin về sản phẩm này.";
    }

    return products
      .map((product) => {
        const formattedPrice =
          new Intl.NumberFormat("vi-VN").format(product.price) + " VND";

        return `
• ${product.name}
  • Thương hiệu: ${product.brand || "Không có thông tin"}
  • CPU: ${product.processor_name || "Không có thông tin"}
  • Chip: ${product.processor_brand || "Không có thông tin"}
  • RAM: ${product.ram ? product.ram : "Không có thông tin"}
  • Ổ cứng: 
      - SSD: ${product.ssd || "Không có thông tin"} 
      - HDD: ${product.hdd || "Không có thông tin"}
  • Màn hình: ${
    product.display_type ? product.display_inches + '"' : "Không có thông tin"
  }
  • Giá: ${formattedPrice}
      `.trim();
      })
      .join("\n\n");
  }

  static async getProductContext(question) {
    try {
      const productName = this.extractProductName(question);

      if (!productName) {
        return "Không thể xác định sản phẩm cần tìm. Vui lòng cung cấp tên hoặc mã sản phẩm cụ thể.";
      }

      const products = await this.searchProducts(productName);
      return this.formatProductInfo(products);
    } catch (error) {
      console.error("Product info error:", error);
      return "Đã xảy ra lỗi khi tìm kiếm thông tin sản phẩm.";
    }
  }
}

module.exports = ProductInfoAgent;
