import 'dotenv/config';
import express from "express";
import { MongoClient } from "mongodb";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

app.use((_, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});


const MONGODB_URI = process.env.MONGODB_URI; // set on Render/Railway
const DB_NAME = process.env.DB_NAME || "qrpasses";

let db;
async function start() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log("Connected to MongoDB");

  const passes = db.collection("passes");
  await passes.createIndex({ _id: 1 });
  await passes.createIndex({ status: 1 });
}
start().catch((e) => {
  console.error("DB connect error:", e);
  process.exit(1);
});

// 1) Public page that shows result and calls API
app.get("/p", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "pass.html"));
});

// 2) API used by /p page: single-use check-in (atomic)
app.get("/api/check-in", (_, res) =>
  res.status(405).json({ ok: false, message: "Use POST" })
);

// ...existing imports/setup...

// READ-ONLY: Show guest without consuming token
app.get("/api/peek", async (req, res) => {
  const token = String(req.query.token || "");
  console.log("[PEEK]", { token });
  if (!token) return res.status(400).json({ ok: false, message: "Missing token" });

  try {
    const doc = await db.collection("passes").findOne({ _id: token }, { projection: { name: 1, status: 1, checkedInAt: 1 } });
    if (!doc) return res.json({ ok: false, code: "NOT_FOUND", message: "Invalid pass." });

    // Never mutate here
    return res.json({ ok: true, code: doc.status === "unused" ? "READY" : "ALREADY_USED", name: doc.name, checkedInAt: doc.checkedInAt });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// TEMP: Reset a pass (for testing)
app.post("/api/reset-pass", async (req, res) => {
  const token = req.query.token || req.body?.token;
  if (!token) return res.status(400).json({ ok: false, message: "Missing token" });

  try {
    const passes = db.collection("passes");
    const result = await passes.updateOne(
      { _id: token },
      { 
        $set: { status: "unused" },
        $unset: { checkedInAt: "" }
      }
    );
    if (result.modifiedCount > 0) {
      return res.json({ ok: true, message: "Pass reset to unused" });
    }
    res.json({ ok: false, message: "Pass not found" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// MUTATING: POST only
app.post("/api/check-in", async (req, res) => {
  const token = String(req.query.token || req.body?.token || "");
  console.log("[CHECK-IN:start]", { token, method: req.method });

  if (!token) return res.status(400).json({ ok: false, message: "Missing token" });

  try {
    const passes = db.collection("passes");
    const now = new Date();

    const result = await passes.findOneAndUpdate(
      { _id: token, status: "unused" },
      { $set: { status: "used", checkedInAt: now } },
      { returnDocument: "after" }
    );

    console.log("[CHECK-IN:updateResult]", { matched: !!result.value });

    if (result.value) {
      console.log("[CHECK-IN:success]", { token, name: result.value.name });
      return res.json({ ok: true, code: "CHECKED_IN", name: result.value.name, checkedInAt: result.value.checkedInAt });
    }

    // No match: someone else may have just checked it in milliseconds before.
    const doc = await passes.findOne(
      { _id: token },
      { projection: { _id: 1, name: 1, status: 1, checkedInAt: 1 } }
    );
    console.log("[CHECK-IN:postDoc]", doc);

    // ✅ Idempotent success window (e.g., 15 seconds)
    if (doc?.status === "used" && doc.checkedInAt) {
      const delta = Math.abs(Date.now() - new Date(doc.checkedInAt).getTime());
      if (delta < 15_000) {
        console.log("[CHECK-IN:idempotent-success]", { token, deltaMs: delta });
        return res.json({
          ok: true,
          code: "CHECKED_IN", // keep same code so frontend shows the green success
          name: doc.name,
          checkedInAt: doc.checkedInAt
        });
      }
    }

    if (!doc) return res.json({ ok: false, code: "NOT_FOUND", message: "Invalid pass." });
    if (doc.status === "used") {
      return res.json({
        ok: false,
        code: "ALREADY_USED",
        name: doc.name,
        checkedInAt: doc.checkedInAt,
        message: "This pass has already been used."
      });
    }

    return res.json({ ok: false, message: "Unknown state" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on :" + PORT));
