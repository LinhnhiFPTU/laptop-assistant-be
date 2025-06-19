import "dotenv/config";
import { Client as PG } from "pg";
import axios from "axios";
import crypto from "node:crypto";

const pg = new PG({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION = "laptops";
const EMBED_DIM = process.env.EMBED_DIM || 384;
const EMBED_ENDPOINT = process.env.EMBED_ENDPOINT || "http://localhost:11434/api/embeddings";

// Ensure Qdrant collection exists
async function ensureCollection() {
  try {
    const res = await axios.get(`${QDRANT_URL}/collections/${COLLECTION}`);
    if (res.status === 200) {
      console.log(`✅ Collection "${COLLECTION}" already exists.`);
      return;
    }
  } catch (err) {
    // If collection doesn't exist, create it
    if (err.response && err.response.status === 404) {
      await axios.post(`${QDRANT_URL}/collections`, {
        name: COLLECTION,
        vectors: { size: EMBED_DIM, distance: "Cosine" }
      });
      console.log(`✅ Created collection "${COLLECTION}".`);
    } else {
      console.error("❌ Error while checking collection:", err);
      process.exit(1);
    }
  }
}

// Create embedding for text using Ollama API
async function embed(text) {
  const res = await axios.post(EMBED_ENDPOINT, {
    model: "nomic-embed-text",
    input: text
  });
  return res.data.data[0].embedding; // Assuming API returns a vector
}

// Convert Postgres row to Qdrant payload format
function rowToPayload(row) {
  return {
    id: row.id,
    brand: row.brand,
    name: row.name,
    price: row.price,
    ram: row.ram,
    ssd: row.ssd,
    gpu: row.gpu,
  };
}

(async () => {
  await ensureCollection();

  const { rows } = await pg.query("SELECT * FROM laptops");
  console.log("🚀 Fetched", rows.length, "rows from Postgres");

  const batch = [];
  for (const row of rows) {
    const txt = `${row.brand} ${row.name}. CPU ${row.processor_name}. RAM ${row.ram}. GPU ${row.gpu}. Giá ${row.price}`;
    const vector = await embed(txt);

    batch.push({
      id: crypto.randomUUID(),
      vector,
      payload: rowToPayload(row),
    });

    // Batches of 64, then upsert to Qdrant
    if (batch.length === 64) {
      await axios.post(`${QDRANT_URL}/points`, {
        collection_name: COLLECTION,
        points: batch,
      });
      batch.length = 0;
      process.stdout.write(".");
    }
  }

  if (batch.length) {
    await axios.post(`${QDRANT_URL}/points`, {
      collection_name: COLLECTION,
      points: batch,
    });
  }

  console.log("\n✅  Ingest finished.");
  await pg.end();
})();
