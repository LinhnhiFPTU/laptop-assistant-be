const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const { QdrantClient } = require("@qdrant/js-client-rest");
const pLimit = require("p-limit").default;

/* ──────────────── CONFIG ─────────────── */
const EMBED_MODEL = process.env.BEDROCK_MODEL_ID;
const KB = "laptop";

/* ──────────────── CLIENTS ─────────────── */
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

// Rate limiter for Bedrock API calls - limit to 1 concurrent request
const embedLimiter = pLimit(1);

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
      console.log(`Throttling protection: waiting ${delayNeeded}ms before next embedding request`);
      await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }
    
    this.lastRequestTime = Date.now();
    return fn();
  }
}

// Create request queue with 2 second delay between embedding calls
const embedQueue = new RequestQueue(2000);

class VectorAgent {
  static embedPayload(text) {
    return EMBED_MODEL.startsWith("amazon.titan")
      ? { inputText: text }
      : { texts: [text] };
  }

  static async embed(text, retries = 3) {
    let delay = 2000; // Start with a longer delay
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Use both rate limiter and request queue for embedding requests
        return await embedLimiter(async () => {
          return await embedQueue.execute(async () => {
            console.log(`Sending embedding request (attempt ${attempt+1}/${retries+1})`);
            const res = await bedrock.send(
              new InvokeModelCommand({
                modelId: EMBED_MODEL,
                contentType: "application/json",
                accept: "application/json",
                body: JSON.stringify(this.embedPayload(text)),
              })
            );
            const body = JSON.parse(await res.body.transformToString());
            return body.embedding || body.embeddings?.[0];
          });
        });
      } catch (error) {
        // If it's a throttling error and we have retries left
        if (error.name === "ThrottlingException" && attempt < retries) {
          console.log(`Embedding throttled, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 500));
          delay *= 2; // More aggressive exponential backoff
          continue;
        }
        console.error("Embedding error:", error);
        throw error;
      }
    }
  }

  // Enhanced in-memory cache for vector search results
  static cache = new Map();
  static cacheExpiry = 30 * 60 * 1000; // 30 minutes - longer cache to reduce API calls
  static cacheHits = 0;
  static cacheMisses = 0;
  
  static async searchKB(question) {
    // Generate a cache key from the question - normalize and simplify for better cache hits
    const cacheKey = question.trim().toLowerCase()
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/[?!.,;:\-]/g, ''); // Remove punctuation
    
    // Check if we have a cached result
    if (this.cache.has(cacheKey)) {
      const { result, timestamp } = this.cache.get(cacheKey);
      if (Date.now() - timestamp < this.cacheExpiry) {
        this.cacheHits++;
        console.log(`Using cached vector search result (hits: ${this.cacheHits}, misses: ${this.cacheMisses})`);
        return result;
      }
    }
    
    // Look for similar questions in cache (fuzzy matching)
    const similarityThreshold = 0.8;
    for (const [key, value] of this.cache.entries()) {
      if (Date.now() - value.timestamp < this.cacheExpiry) {
        // Simple similarity check - if the question contains most of the cached key or vice versa
        if (key.length > 10 && // Only for substantial questions
            (cacheKey.includes(key) || key.includes(cacheKey) || 
             this.calculateSimilarity(key, cacheKey) > similarityThreshold)) {
          this.cacheHits++;
          console.log(`Using similar cached result (hits: ${this.cacheHits}, misses: ${this.cacheMisses})`);
          return value.result;
        }
      }
    }
    
    this.cacheMisses++;
    console.log(`Cache miss (hits: ${this.cacheHits}, misses: ${this.cacheMisses})`);
    
    try {
      // Try to get embedding with retries
      const vec = await this.embed(question);
      
      // Search Qdrant with the embedding
      const hits = await qdrant.search(KB, { vector: vec, top: 4 });
      const resultText = hits.map((h) => h.payload.text).join("\n\n");
      
      const result = resultText.length > 0
        ? resultText
        : "Không tìm thấy thông tin về câu hỏi này.";
      
      // Cache the result
      this.cache.set(cacheKey, { result, timestamp: Date.now() });
      
      // Clean up old cache entries if cache is getting too large
      if (this.cache.size > 100) {
        this.cleanCache();
      }
      
      return result;
    } catch (error) {
      console.error("Vector search error:", error);
      
      if (error.name === "ThrottlingException") {
        // Try to return any cached result that might be relevant
        if (this.cache.size > 0) {
          console.log("Throttling error - returning most recent cached result as fallback");
          // Get the most recent cache entry as a fallback
          let newestEntry = null;
          let newestTime = 0;
          
          for (const [key, value] of this.cache.entries()) {
            if (value.timestamp > newestTime) {
              newestTime = value.timestamp;
              newestEntry = value.result;
            }
          }
          
          if (newestEntry) {
            return newestEntry + "\n\n(Lưu ý: Đây là kết quả tạm thời do hệ thống đang quá tải)";
          }
        }
        
        return "Hệ thống đang bận, vui lòng thử lại sau ít phút.";
      }
      
      return "Đã xảy ra lỗi trong quá trình tìm kiếm.";
    }
  }
  
  // Helper method to calculate similarity between two strings
  static calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    // Count matching characters
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (longer.includes(shorter[i])) matches++;
    }
    
    return matches / longer.length;
  }
  
  // Clean up old cache entries
  static cleanCache() {
    const now = Date.now();
    const keysToDelete = [];
    
    // Find expired entries
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheExpiry) {
        keysToDelete.push(key);
      }
    }
    
    // Delete expired entries
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
    
    console.log(`Cache cleaned: removed ${keysToDelete.length} entries, ${this.cache.size} remaining`);
  }
}

module.exports = VectorAgent;
