const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const pLimit = require("p-limit").default;

// Import sub-agents
const OrderAgent = require("./orderAgent");
const PromotionAgent = require("./promotionAgent");
const VectorAgent = require("./vectorAgent");
const ProductInfoAgent = require("./productInfoAgent");
const InternetSearchAgent = require("./internetSearchAgent");
const Neo4jAgent = require("./neo4jAgent");

const LLM_MODEL = process.env.BEDROCK_LLM_MODEL;
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

// Limit to only 1 concurrent LLM call with significant delay between calls
const llmLimiter = pLimit(1);

// Queue for managing API request timing
class RequestQueue {
  constructor(minDelayMs = 1000) {
    this.lastRequestTime = 0;
    this.minDelayMs = minDelayMs;
  }

  async execute(fn) {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    // If we haven't waited long enough since the last request
    if (timeSinceLastRequest < this.minDelayMs) {
      const delayNeeded = this.minDelayMs - timeSinceLastRequest;
      console.log(
        `Throttling protection: waiting ${delayNeeded}ms before next request`
      );
      await new Promise((resolve) => setTimeout(resolve, delayNeeded));
    }

    this.lastRequestTime = Date.now();
    return fn();
  }
}

// Create request queues with different delays
const bedrockQueue = new RequestQueue(1500); // 1.5 second between Bedrock calls

class SupervisorAgent {
  static async bedrockInvoke(payload, retries = 4) {
    let delay = 1000; // Start with a longer delay
    for (let i = 0; i <= retries; i++) {
      try {
        // Use the request queue to enforce minimum delay between requests
        return await bedrockQueue.execute(async () => {
          console.log(
            `Sending Bedrock request (attempt ${i + 1}/${retries + 1})`
          );
          const res = await bedrock.send(new InvokeModelCommand(payload));
          return JSON.parse(await res.body.transformToString());
        });
      } catch (err) {
        if (err.name === "ThrottlingException" && i < retries) {
          console.log(
            `ThrottlingException received, waiting ${delay}ms before retry`
          );
          await new Promise((r) => setTimeout(r, delay + Math.random() * 500));
          delay *= 2; // More aggressive backoff
          continue;
        }
        throw err;
      }
    }
  }

  static toText(c) {
    if (Array.isArray(c)) return c.map((x) => x.text || "").join("");
    if (typeof c === "string") return c;
    return JSON.stringify(c);
  }

  static async analyzeQuery(question) {
    const systemPrompt = `
    Bạn là trợ lý phân tích câu hỏi. Nhiệm vụ của bạn là phân tích câu hỏi của người dùng và xác định cần sử dụng những agent nào để trả lời.
    Lưu ý: không sử dụng cụm từ TGDD, thay bằng cửa hàng Zaplap khi trả lời.
    
    Các agent có sẵn:
    1. OrderAgent - CHỈ dùng khi cần truy vấn thông tin về đơn hàng CỤ THỂ của người dùng, như trạng thái đơn hàng, lịch sử đơn hàng. KHÔNG dùng cho các câu hỏi chung về chính sách, quy trình đặt hàng, hoặc trả hàng.
    2. PromotionAgent - Truy vấn thông tin về khuyến mãi, mã giảm giá
    3. ProductInfoAgent - Tìm kiếm thông tin chi tiết về sản phẩm cụ thể (laptop) khi người dùng hỏi về một sản phẩm cụ thể hoặc muốn tham khảo thông tin sản phẩm.
    4. InternetSearchAgent - Tìm kiếm thông tin trên internet cho các câu hỏi kiến thức chung, định nghĩa, so sánh, giải thích các khái niệm công nghệ không liên quan trực tiếp đến cửa hàng.
    5. VectorAgent - Tìm kiếm thông tin chung từ cơ sở dữ liệu vector, bao gồm các chính sách, quy trình, hướng dẫn, và các câu hỏi chung liên quan đến cửa hàng.
    6. Neo4jAgent - Tìm kiếm thông tin sản phẩm phức tạp bằng cách tạo và thực thi truy vấn Cypher trên cơ sở dữ liệu Neo4j. Sử dụng cho các câu hỏi so sánh sản phẩm, lọc theo nhiều tiêu chí, hoặc tìm kiếm sản phẩm theo mối quan hệ.
    
    Lưu ý quan trọng:
    - Câu hỏi về "chính sách trả hàng", "chính sách bảo hành", "hướng dẫn mua hàng" là câu hỏi chung, chỉ cần dùng VectorAgent.
    - Chỉ dùng OrderAgent khi người dùng hỏi về đơn hàng cụ thể của họ, ví dụ: "đơn hàng của tôi đã giao chưa?", "tôi đã đặt những sản phẩm nào?"
    - Dùng ProductInfoAgent khi người dùng hỏi về thông tin sản phẩm cụ thể đơn giản, ví dụ: "cho tôi biết thông tin về laptop Dell XPS", "tôi muốn tham khảo sản phẩm Lenovo ThinkPad"
    - Dùng Neo4jAgent khi người dùng hỏi về thông tin sản phẩm phức tạp hoặc so sánh, ví dụ: "laptop nào có RAM trên 16GB và giá dưới 30 triệu?", "so sánh các laptop Dell và Lenovo", "laptop nào có SSD lớn nhất?"
    - Dùng InternetSearchAgent khi người dùng hỏi về kiến thức chung, định nghĩa, so sánh, ví dụ: "SSD là gì?", "so sánh Intel và AMD", "RAM DDR4 và DDR5 khác nhau thế nào?"
    
    Trả về JSON với cấu trúc:
    {
      "needsOrderInfo": boolean,
      "needsPromotionInfo": boolean,
      "needsProductInfo": boolean,
      "needsNeo4jQuery": boolean,
      "needsInternetSearch": boolean,
      "needsVectorSearch": boolean,
      "reasoning": "Giải thích ngắn gọn lý do"
    }`;

    const bodyJson = {
      anthropic_version: "bedrock-2023-05-31",
      system: systemPrompt,
      max_tokens: 300,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: `Phân tích câu hỏi sau: "${question}"`,
        },
      ],
    };

    try {
      // Try with a simpler model first to avoid throttling the main model
      const fallbackModel = "anthropic.claude-3-haiku-20240307-v1:0";

      try {
        const json = await llmLimiter(() =>
          this.bedrockInvoke({
            modelId: fallbackModel,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(bodyJson),
          })
        );

        const responseText = this.toText(json.content);
        // Extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (fallbackError) {
        console.error("Fallback model error:", fallbackError);
        // Continue to try with main model if fallback fails
      }

      // Default to using all agents if parsing fails or if we couldn't use the fallback
      return {
        needsOrderInfo: true,
        needsPromotionInfo: true,
        needsProductInfo: true,
        needsNeo4jQuery: true,
        needsInternetSearch: true,
        needsVectorSearch: true,
        reasoning: "Using all agents as fallback",
      };
    } catch (error) {
      console.error("Error analyzing query:", error);
      // Default to using all agents if error occurs
      return {
        needsOrderInfo: true,
        needsPromotionInfo: true,
        needsProductInfo: true,
        needsNeo4jQuery: true,
        needsInternetSearch: true,
        needsVectorSearch: true,
        reasoning: "Error occurred, using all agents as fallback",
      };
    }
  }

  static async aggregateResponses(question, agentResults) {
    // Check if we have a product display result with cart option
    const productResult = agentResults.find(
      (r) =>
        r.agentName === "ProductInfoAgent" &&
        typeof r.data === "object" &&
        r.data.isProductDisplay
    );

    // If we have a product display and it's the only meaningful result, return it directly
    if (productResult && agentResults.length <= 2) {
      // ProductInfoAgent + maybe VectorAgent
      return productResult.data;
    }

    // Process agent results to handle objects
    const processedResults = agentResults.map((r) => {
      if (typeof r.data === "object" && r.data.text) {
        // Use the text version for LLM processing
        return { ...r, data: r.data.text };
      }
      return r;
    });

    const systemPrompt = `
    Bạn là trợ lý TMĐT, trả lời ngắn gọn, thân thiện, tiếng Việt. 
    Lưu ý: không sử dụng cụm từ TGDD, thay bằng cửa hàng Zaplap khi trả lời.
    Nhiệm vụ của bạn là tổng hợp thông tin từ các agent khác nhau để tạo câu trả lời hoàn chỉnh.
    Chỉ sử dụng thông tin được cung cấp, không tự thêm thông tin không có trong dữ liệu.
    Nếu thiếu thông tin, hãy yêu cầu người dùng cung cấp thêm chi tiết.`;

    const bodyJson = {
      anthropic_version: "bedrock-2023-05-31",
      system: systemPrompt,
      max_tokens: 700,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: `
          Câu hỏi: ${question}
          
          Thông tin từ các agent:
          ${processedResults
            .map((r) => `- ${r.agentName}: ${r.data || "Không có thông tin"}`)
            .join("\n")}
          
          Hãy tổng hợp thành câu trả lời hoàn chỉnh.`,
        },
      ],
    };

    try {
      // Always use Haiku model for response generation to avoid throttling
      const modelId = "anthropic.claude-3-haiku-20240307-v1:0";

      const json = await llmLimiter(() =>
        this.bedrockInvoke({
          modelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify(bodyJson),
        })
      );

      return this.toText(json.content);
    } catch (error) {
      console.error("Error aggregating responses:", error);
      if (error.name === "ThrottlingException") {
        // If even Haiku is throttled, return a simple response based on the data we have
        console.log(
          "Even fallback model is throttled, generating simple response"
        );

        // Create a simple response from the agent results
        let simpleResponse = `Tôi đã tìm được thông tin sau:\n\n`;

        for (const result of agentResults) {
          if (result.data && result.data.trim().length > 0) {
            simpleResponse += `${result.data}\n\n`;
          }
        }

        if (simpleResponse === `Tôi đã tìm được thông tin sau:\n\n`) {
          simpleResponse =
            "Xin lỗi, hiện tại hệ thống đang quá tải. Vui lòng thử lại sau ít phút.";
        }

        return simpleResponse;
      }
      throw error;
    }
  }

  static async processQuery(question, token) {
    try {
      // Extract userId from token if available
      let userId = null;
      if (token) {
        try {
          const jwt = require("jsonwebtoken");
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          userId = decoded.userId;
        } catch (err) {
          console.error("Error decoding token in SupervisorAgent:", err);
        }
      }

      // Analyze the query to determine which agents to use
      const analysis = await this.analyzeQuery(question);
      console.log("Query analysis:", analysis);

      // Collect responses from relevant agents
      const agentResults = [];

      // Run agents in parallel with proper error handling
      const promises = [];

      // Always prioritize VectorAgent for general information
      if (analysis.needsVectorSearch) {
        promises.push(
          VectorAgent.searchKB(question)
            .then((data) =>
              agentResults.push({ agentName: "VectorAgent", data })
            )
            .catch((error) => {
              console.error("Vector search failed:", error);
              agentResults.push({
                agentName: "VectorAgent",
                data: "Không thể tìm kiếm thông tin do hệ thống đang bận. Vui lòng thử lại sau.",
                error: true,
              });
            })
        );
      }

      // Only use OrderAgent if user is authenticated and query is specifically about their orders
      if (analysis.needsOrderInfo) {
        if (token) {
          promises.push(
            OrderAgent.getOrderContext(token)
              .then((data) =>
                agentResults.push({ agentName: "OrderAgent", data })
              )
              .catch((error) => {
                console.error("Order query failed:", error);
                agentResults.push({
                  agentName: "OrderAgent",
                  data: "Không thể truy vấn thông tin đơn hàng.",
                  error: true,
                });
              })
          );
        } else {
          // User is not authenticated but asking about orders
          agentResults.push({
            agentName: "OrderAgent",
            data: "Bạn cần đăng nhập để xem thông tin đơn hàng của mình.",
          });
        }
      }

      if (analysis.needsPromotionInfo) {
        promises.push(
          PromotionAgent.getPromotionContext()
            .then((data) =>
              agentResults.push({ agentName: "PromotionAgent", data })
            )
            .catch((error) => {
              console.error("Promotion query failed:", error);
              agentResults.push({
                agentName: "PromotionAgent",
                data: "Không thể truy vấn thông tin khuyến mãi.",
                error: true,
              });
            })
        );
      }

      // Use ProductInfoAgent for product-specific queries
      if (analysis.needsProductInfo) {
        promises.push(
          ProductInfoAgent.getProductContext(question, userId)
            .then((data) =>
              agentResults.push({ agentName: "ProductInfoAgent", data })
            )
            .catch((error) => {
              console.error("Product info query failed:", error);
              agentResults.push({
                agentName: "ProductInfoAgent",
                data: "Không thể truy vấn thông tin sản phẩm.",
                error: true,
              });
            })
        );
      }

      // Use Neo4jAgent for complex product queries
      if (analysis.needsNeo4jQuery) {
        promises.push(
          Neo4jAgent.getProductContext(question, userId)
            .then((data) =>
              agentResults.push({ agentName: "Neo4jAgent", data })
            )
            .catch((error) => {
              console.error("Neo4j query failed:", error);
              agentResults.push({
                agentName: "Neo4jAgent",
                data: "Không thể truy vấn cơ sở dữ liệu Neo4j.",
                error: true,
              });
            })
        );
      }

      // Use InternetSearchAgent for general knowledge queries
      // Check if it's a general knowledge query first, regardless of analysis
      const isGeneralKnowledge =
        InternetSearchAgent.isGeneralKnowledgeQuery(question);
      if (analysis.needsInternetSearch || isGeneralKnowledge) {
        console.log(`Using InternetSearchAgent for query: "${question}"`);

        // Run this first and wait for it to complete before proceeding
        try {
          const internetData = await InternetSearchAgent.getInternetContext(
            question
          );
          agentResults.push({
            agentName: "InternetSearchAgent",
            data: internetData,
          });
        } catch (error) {
          console.error("Internet search failed:", error);
          agentResults.push({
            agentName: "InternetSearchAgent",
            data: "Không thể tìm kiếm thông tin trên internet.",
            error: true,
          });
        }
      }

      // Wait for all agent responses (or their error handlers)
      await Promise.all(promises);

      // Check if all agents failed and no static responses were added
      const allFailed =
        agentResults.length > 0 &&
        agentResults.every((result) => result.error === true);

      if (allFailed) {
        return "Hệ thống đang gặp sự cố. Vui lòng thử lại sau ít phút.";
      }

      // If we have no results at all, provide a generic response
      if (agentResults.length === 0) {
        return "Xin lỗi, tôi không tìm thấy thông tin phù hợp với câu hỏi của bạn. Vui lòng thử lại với câu hỏi khác hoặc liên hệ với chúng tôi để được hỗ trợ.";
      }

      // Aggregate responses
      return await this.aggregateResponses(question, agentResults);
    } catch (error) {
      console.error("Error in supervisor agent:", error);
      if (error.name === "ThrottlingException") {
        return "Hệ thống đang bận, vui lòng thử lại sau ít phút.";
      }
      throw error;
    }
  }
}

module.exports = SupervisorAgent;
