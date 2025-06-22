/* ------------------------------------------------------------------
   chat.js – Multi-collaborator agent architecture with supervisor
-------------------------------------------------------------------*/
require("dotenv").config();
const express = require("express");

// Import the supervisor agent
const SupervisorAgent = require("./agents/supervisorAgent");

/* ──────────────── ROUTER ─────────────── */
const router = express.Router();

router.post("/", async (req, res) => {
  const { question = "" } = req.body;
  const token = req.headers.authorization?.split(" ")[1];

  try {
    console.log(`Processing query: "${question}"`);

    // Use the supervisor agent to process the query
    const answer = await SupervisorAgent.processQuery(question, token);

    res.json({ answer });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

module.exports = router;
