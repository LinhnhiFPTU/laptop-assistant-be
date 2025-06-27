const neo4j = require("neo4j-driver");
const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");

let driver;

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

class Neo4jAgent {
  static async initialize() {
    if (!driver) {
      driver = neo4j.driver(
        process.env.NEO4J_URI,
        neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
      );
      console.log("✅ Neo4j driver initialized");
    }
  }

  static async generateCypherQuery(question) {
    try {
      const systemPrompt = `
You are a Cypher query generator for an e-commerce Neo4j database.

Graph schema:
(:Customer)-[:ADDED_TO_CART]->(:Product)
(:Customer)-[:PLACED]->(:Order)
(:Order)-[:CONTAINS]->(:Product)
(:Product)-[:RECOMMENDS]->(:Product)
(:Product)-[:HAS_SPEC]->(:LaptopSpec)
(:Product)-[:BELONGS_TO]->(:Category)

Node properties:
Product: id, name, brand, price
LaptopSpec: processor_name, ram, ssd, hdd, display_inches
Category: name

Guidelines:
- Translate intent like "laptop văn phòng HP" into brand = "HP" AND Category.name = "Văn phòng"
- Translate price phrases:
    - "khoảng 15 triệu" → price <= 15000000 AND price >= 13000000
    - "dưới 10 triệu" → price < 10000000
    - "trên 20 triệu" → price > 20000000
- Only return Cypher query
- Limit to 5 results unless specified

Examples:
Q: Tôi muốn mua laptop gaming dưới 20 triệu
A:
MATCH (p:Product)-[:BELONGS_TO]->(c:Category)
WHERE c.name = "Gaming" AND p.price < 20000000
RETURN p LIMIT 5

Q: Cho tôi vài máy văn phòng HP giá khoảng 15 triệu
A:
MATCH (p:Product)-[:BELONGS_TO]->(c:Category)
WHERE c.name = "Văn phòng" AND p.brand = "HP" AND p.price >= 13000000 AND p.price <= 17000000
RETURN p LIMIT 5

Now generate Cypher for this question: "${question}"
`.trim();

      const command = new InvokeModelCommand({
        modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 500,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: "user", content: question }],
        }),
      });

      const response = await bedrock.send(command);
      const body = JSON.parse(await response.body.transformToString());
      return body.content[0].text.trim();
    } catch (err) {
      console.error("❌ generateCypherQuery error:", err);
      return null;
    }
  }

  static async executeQuery(cypherQuery) {
    await this.initialize();
    const session = driver.session();
    try {
      const result = await session.run(cypherQuery);
      return this.formatResults(result);
    } catch (err) {
      console.error("❌ Cypher execution error:", err);
      return "Không thể thực thi truy vấn Cypher.";
    } finally {
      await session.close();
    }
  }

  static formatResults(result) {
    if (!result || result.records.length === 0)
      return "Không tìm thấy kết quả phù hợp.";

    const formatted = result.records.map((record) => {
      const obj = record.get(0)?.properties;
      if (!obj) return JSON.stringify(record.toObject());

      const price = obj.price?.toNumber?.() || obj.price;
      const display = obj.display_inches?.toNumber?.() || obj.display_inches;

      return `
• ${obj.name}
  • Thương hiệu: ${obj.brand || "Không có"}
  • CPU: ${obj.processor_name || "Không có"}
  • RAM: ${obj.ram || "Không có"}
  • SSD: ${obj.ssd || "Không có"}
  • HDD: ${obj.hdd || "Không có"}
  • Màn hình: ${display || "Không rõ"} inch
  • Giá: ${new Intl.NumberFormat("vi-VN").format(price)} VND
  • ID: ${obj.id}
      `.trim();
    });

    return formatted.join("\n\n");
  }

  static async getProductContext(question) {
    const query = await this.generateCypherQuery(question);
    if (!query) return "Không thể sinh truy vấn Cypher từ câu hỏi.";

    console.log("▶️ Executing query:", query);
    return await this.executeQuery(query);
  }
}

module.exports = Neo4jAgent;
