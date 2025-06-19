/* ------------------------------------------------------------------
   chat.js – Optimised RAG pipeline (Claude‑3.5 Sonnet)
-------------------------------------------------------------------*/
require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");
const pLimit = require("p-limit").default;
const { QdrantClient } = require("@qdrant/js-client-rest");
const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const pool = require("../db");

/* ──────────────── CONFIG ─────────────── */
const EMBED_MODEL = process.env.BEDROCK_MODEL_ID;
const LLM_MODEL = process.env.BEDROCK_LLM_MODEL;
const KB = "laptop";

/* ──────────────── CLIENTS ─────────────── */
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

/* ──────────────── EMBEDDING ─────────────── */
function embedPayload(text) {
  return EMBED_MODEL.startsWith("amazon.titan")
    ? { inputText: text }
    : { texts: [text] };
}
async function embed(text) {
  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId: EMBED_MODEL,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(embedPayload(text)),
    })
  );
  const body = JSON.parse(await res.body.transformToString());
  return body.embedding || body.embeddings?.[0];
}

async function searchKB(vec) {
  const hits = await qdrant.search(KB, { vector: vec, top: 4 });
  return hits.map((h) => h.payload.text).join("\n\n");
}

/* ──────────────── LLM ─────────────── */
const SYSTEM_PROMPT =
  "Bạn là trợ lý TMĐT, trả lời ngắn gọn, thân thiện, tiếng Việt. Nếu thiếu thông tin, hãy yêu cầu người dùng cung cấp thêm chi tiết.";
const llmLimiter = pLimit(3);

async function bedrockInvoke(payload, retries = 4) {
  let delay = 400;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await bedrock.send(new InvokeModelCommand(payload));
      return JSON.parse(await res.body.transformToString());
    } catch (err) {
      if (err.name === "ThrottlingException" && i < retries) {
        await new Promise((r) => setTimeout(r, delay + Math.random() * 200));
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}

async function generateAnswer(question, context) {
  const bodyJson = {
    anthropic_version: "bedrock-2023-05-31",
    system: SYSTEM_PROMPT,
    max_tokens: 500,
    temperature: 0.3,
    messages: [
      {
        role: "user",
        content: context
          ? `Câu hỏi: ${question}\n\nThông tin:\n${context}`
          : `Câu hỏi: ${question}`,
      },
    ],
  };

  const call = (modelId) =>
    llmLimiter(() =>
      bedrockInvoke({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(bodyJson),
      })
    );

  const toText = (c) => {
    if (Array.isArray(c)) return c.map((x) => x.text || "").join("");
    if (typeof c === "string") return c;
    return JSON.stringify(c);
  };

  try {
    const json = await call(LLM_MODEL);
    return toText(json.content);
  } catch (e) {
    if (e.name === "ThrottlingException") {
      const fallback = "anthropic.claude-3-haiku-20240307-v1:0";
      const json = await call(fallback);
      return `${toText(
        json.content
      )}\n\n_(Trả lời bởi Claude‑3 Haiku do Sonnet quá tải)_`;
    }
    throw e;
  }
}

/* ──────────────── ĐƠN HÀNG util ─────────────── */
const ORDER_KW = [
  "đơn hàng",
  "mã đơn",
  "order",
  "tracking",
  "vận chuyển",
  "giao hàng",
  "tình trạng",
  "shipping",
];
const PROMO_KW = [
  "mã giảm giá",
  "khuyến mãi",
  "promo",
  "promotion",
  "mã khuyến mãi",
  "giảm bao nhiêu",
  "được giảm",
  "discount",
  "voucher",
  "ưu đãi",
];
const looksLikeOrder = (q) => ORDER_KW.some((k) => q.toLowerCase().includes(k));
const looksLikePromotion = (q) =>
  PROMO_KW.some((k) => q.toLowerCase().includes(k));
const fmtVND = (n) => new Intl.NumberFormat("vi-VN").format(+n) + " VND";
const fmtDate = (d) => new Date(d).toLocaleString("vi-VN", { hour12: false });
const formatOrders = (rows) =>
  rows
    .map(
      (o) =>
        `• Đơn #${o.id} – ${fmtVND(o.total_amount)}\n  • Trạng thái: ${
          o.order_status
        }\n  • Thanh toán: ${
          o.payment_status === "paid" ? "Đã thanh toán" : "Chưa thanh toán"
        }\n  • Tạo lúc: ${fmtDate(o.created_at)}`
    )
    .join("\n\n");

/* ──────────────── ROUTER ─────────────── */
const router = express.Router();
router.post("/", async (req, res) => {
  const { question = "" } = req.body;
  const token = req.headers.authorization?.split(" ")[1];
  try {
    const vec = await embed(question);
    let context = await searchKB(vec);

    if (token && looksLikeOrder(question)) {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await pool.query(
        "SELECT * FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 3",
        [user.userId]
      );
      context += rows.length
        ? `\n\nĐơn hàng của bạn:\n${formatOrders(rows)}`
        : "\n\nBạn chưa có đơn hàng nào.";
    }

    // ─── LẤY KHUYẾN MÃI ───
    if (looksLikePromotion(question)) {
      const { rows } = await pool.query(
        `SELECT code, description, discount_type, discount_value
         FROM promotions
         WHERE start_date <= NOW() AND end_date >= NOW()`
      );
      if (rows.length) {
        const list = rows
          .map((p) => {
            const val =
              p.discount_type === "percentage"
                ? `${p.discount_value}%`
                : `${fmtVND(p.discount_value)}`;
            return `• Mã \`${p.code}\`: ${p.description} (Giảm ${val})`;
          })
          .join("\n");
        context += `\n\nCác khuyến mãi đang có:\n${list}`;
      } else {
        context += `\n\nHiện không có khuyến mãi nào đang hoạt động.`;
      }
    }

    const answer = await generateAnswer(question, context);
    res.json({ answer });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

module.exports = router;
