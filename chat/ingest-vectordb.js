require("dotenv").config();
const {
  TextractClient,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
} = require("@aws-sdk/client-textract");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const { QdrantClient } = require("@qdrant/js-client-rest");

const textract = new TextractClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

const BUCKET = process.env.S3_BUCKET_NAME;
const PDFKEY = process.env.S3_FILE_KEY; // file.pdf trong S3
const TXTKEY = `${PDFKEY}.extracted.txt`; // Sẽ upload file .txt này

const COLLECTION = process.env.QDRANT_COLLECTION;
const VECTOR_SIZE = 1536; // Titan-embed kích thước 1536

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. Gọi Textract bất đồng bộ ---------- */
async function startTextractJob() {
  const cmd = new StartDocumentAnalysisCommand({
    DocumentLocation: { S3Object: { Bucket: BUCKET, Name: PDFKEY } },
    FeatureTypes: ["TABLES", "FORMS"],
    LanguageCode: "vi",
  });
  const { JobId } = await textract.send(cmd);
  console.log("🟡 Textract job started. JobId =", JobId);
  return JobId;
}

/* ---------- 2. Poll kết quả ---------- */
async function pollTextract(jobId) {
  let status = "IN_PROGRESS";
  let blocks = [];

  while (status === "IN_PROGRESS") {
    const res = await textract.send(
      new GetDocumentAnalysisCommand({ JobId: jobId })
    );
    status = res.JobStatus;
    if (status === "SUCCEEDED") {
      blocks.push(...res.Blocks);
      console.log("\n✅ Textract SUCCEEDED");
      break;
    }
    if (status === "FAILED") throw new Error("❌ Textract FAILED");
    process.stdout.write("."); // progress dot
    await sleep(3000);
  }
  return blocks;
}

/* ---------- 3. Ghép text theo dòng meaningful ---------- */
function extractLines(blocks) {
  return blocks
    .filter((b) => b.BlockType === "LINE" && b.Text)
    .map((b) => b.Text.trim())
    .filter((l) => l.length > 20);
}

/* ---------- 4. Upload text lên cùng bucket ---------- */
async function uploadTextToS3(text) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: TXTKEY,
      Body: text,
    })
  );
  console.log(`📤 Uploaded extracted text -> s3://${BUCKET}/${TXTKEY}`);
}

/* ---------- 5. Nhúng 1 đoạn bằng Titan ---------- */
async function embed(text) {
  const cmd = new InvokeModelCommand({
    modelId: "amazon.titan-embed-text-v1",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text }),
  });
  const res = await bedrock.send(cmd);
  const body = JSON.parse(await res.body.transformToString());
  return body.embedding;
}

/* ---------- 6. Main pipeline ---------- */
async function main() {
  try {
    const jobId = await startTextractJob();
    const blocks = await pollTextract(jobId);
    const lines = extractLines(blocks);

    console.log(`📄 ${lines.length} lines after filtering`);
    await uploadTextToS3(lines.join("\n"));

    await qdrant.recreateCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });

    const points = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const vec = await embed(lines[i]);
        points.push({ id: i, vector: vec, payload: { text: lines[i] } });
        if ((i + 1) % 10 === 0)
          console.log(`✅ ${i + 1}/${lines.length} embedded`);
        await sleep(200); // tránh throttling
      } catch (e) {
        console.error(`❌ Embed fail #${i}:`, e.message);
      }
    }

    await qdrant.upsert(COLLECTION, { points });
    console.log("🎉 All vectors inserted into Qdrant");
  } catch (err) {
    console.error("🚨 Pipeline error:", err.message);
  }
}

main();
