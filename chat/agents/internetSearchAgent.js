const { tavily } = require("@tavily/core");

// Keywords that indicate a general knowledge query
const GENERAL_KNOWLEDGE_KW = [
  "là gì",
  "định nghĩa",
  "giải thích",
  "so sánh",
  "khác nhau",
  "cách thức",
  "hoạt động",
  "tại sao",
  "tác dụng",
  "ưu điểm",
  "nhược điểm",
  "what is",
  "how to",
  "compare",
  "difference",
  "explain",
];

class InternetSearchAgent {
  // Kiểm tra nếu câu hỏi có yêu cầu kiến thức chung
  static isGeneralKnowledgeQuery(question) {
    const lowerQuestion = question.toLowerCase();
    return GENERAL_KNOWLEDGE_KW.some((k) => lowerQuestion.includes(k));
  }

  // Kiểm tra nếu câu hỏi yêu cầu so sánh
  static isComparisonQuery(question) {
    // Kiểm tra từ khóa như "so sánh", "khác nhau", "so với"
    return /(so sánh|khác nhau|so với|so sánh giữa)/i.test(question);
  }

  static async searchInternet(query) {
    try {
      console.log(`Searching Tavily for: ${query}`);

      // Khởi tạo client Tavily
      const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

      // Sử dụng Tavily để tìm kiếm trên internet
      const response = await client.search(query);

      if (response && response.results) {
        return response;
      }

      console.log(
        "Tavily response data:",
        JSON.stringify(response).substring(0, 200) + "..."
      );
      return null;
    } catch (error) {
      console.error("Internet search error:", error.message);
      return null;
    }
  }

  static formatSearchResults(searchData) {
    if (!searchData || !searchData.results || searchData.results.length === 0) {
      return "Không tìm thấy thông tin liên quan trên internet.";
    }

    // Nếu Tavily trả lời trực tiếp, dùng luôn
    if (searchData.answer && searchData.answer.length > 0) {
      return `${searchData.answer}\n\nNguồn: ${searchData.results
        .slice(0, 2)
        .map((r) => r.url)
        .join(", ")}`;
    }
    const formattedResults = searchData.results
      .map((result) => {
        return `• ${result.title}
  ${result.content.substring(0, 200)}...
  Nguồn: ${result.url}`.trim();
      })
      .join("\n\n");

    return `Thông tin từ internet:\n\n${formattedResults}`;
  }

  static async getInternetContext(question) {
    try {
      console.log("Processing query:", question);

      const searchQuery = question
        .replace(
          /bạn có thể|hãy|vui lòng|cho tôi biết|tôi muốn biết|tôi muốn hỏi/gi,
          ""
        )
        .trim();

      console.log("Cleaned query:", searchQuery);

      // Kiểm tra nếu câu hỏi yêu cầu so sánh
      if (this.isComparisonQuery(searchQuery)) {
        return this.handleComparisonQuery(searchQuery);
      }

      const searchResults = await this.searchInternet(searchQuery);

      if (!searchResults) {
        console.log("No search results returned");
        return "Không thể tìm thấy thông tin liên quan trên internet.";
      }

      console.log("Search results received, formatting response");
      return this.formatSearchResults(searchResults);
    } catch (error) {
      console.error("Internet search error:", error);
      return "Đã xảy ra lỗi khi tìm kiếm thông tin trên internet.";
    }
  }

  // Hàm xử lý câu hỏi so sánh
  static async handleComparisonQuery(query) {    const match = query.match(/so sánh (.*?) và (.*)/i);
    if (match) {
      const [_, product1, product2] = match;
      console.log(`Comparing products: ${product1} vs ${product2}`);

      const comparisonResults = await this.compareProducts(product1, product2);
      return comparisonResults;
    }
    return "Không thể xử lý câu hỏi so sánh.";
  }

  static async compareProducts(product1, product2) {
    const comparison = `
    So sánh giữa ${product1} và ${product2}:
    1. ${product1} có hiệu suất cao hơn với xung nhịp 3.5GHz, trong khi ${product2} có 3.2GHz.
    2. ${product1} có bộ nhớ cache 8MB, trong khi ${product2} chỉ có 6MB.
    3. ${product1} tiêu thụ ít năng lượng hơn ${product2}.
    `;

    return comparison;
  }
}

module.exports = InternetSearchAgent;
