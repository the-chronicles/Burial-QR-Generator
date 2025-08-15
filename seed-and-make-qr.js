// import fs from "fs";
// import path from "path";
// import { parse } from "csv-parse/sync";
// import { MongoClient } from "mongodb";
// import QRCode from "qrcode";
// import crypto from "crypto";
// import "dotenv/config";

// const outDir = path.join(process.cwd(), "qr_out");
// if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

// const MONGODB_URI = process.env.MONGODB_URI;
// const DB_NAME = process.env.DB_NAME || "qrpasses";
// const SITE_BASE = process.env.SITE_BASE || "http://localhost:3000/p?token="; 
// // When deployed, set SITE_BASE=https://your-app.onrender.com/p?token=

// const csv = fs.readFileSync("./guests.csv", "utf8");
// const rows = parse(csv, { columns: true, skip_empty_lines: true });

// const client = new MongoClient(MONGODB_URI);

// function randomToken() {
//   return crypto.randomBytes(16).toString("hex"); // 32-char unguessable token
// }

// (async () => {
//   try {
//     await client.connect();
//     const db = client.db(DB_NAME);
//     const passes = db.collection("passes");

//     for (const row of rows) {
//       const token = randomToken();
//       const doc = {
//         _id: token,            // token as primary key
//         name: (row.name || "Guest").trim(),
//         phone: row.phone?.trim() || null,
//         note: row.note?.trim() || null,
//         status: "unused",
//         createdAt: new Date(),
//         checkedInAt: null
//       };
//       await passes.insertOne(doc);

//       const url = SITE_BASE + encodeURIComponent(token);
//       const filenameSafe = row.name ? row.name.replace(/\s+/g, "_") : "Guest";
//       const file = path.join(outDir, `${filenameSafe}_${token.slice(0,6)}.png`);
//       await QRCode.toFile(file, url, { margin: 1, width: 600 });

//       console.log(`Created: ${row.name} → ${url}`);
//     }
//     console.log("Done. PNGs in qr_out/");
//   } catch (e) {
//     console.error(e);
//   } finally {
//     await client.close();
//   }
// })();




import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { MongoClient } from "mongodb";
import QRCode from "qrcode";
import crypto from "crypto";
import "dotenv/config";

const outDir = path.join(process.cwd(), "qr_out");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "qrpasses";
let SITE_BASE = process.env.SITE_BASE || "http://localhost:3000/p?token=";
// strip accidental surrounding quotes
SITE_BASE = SITE_BASE.replace(/^"+|"+$/g, "");

const csv = fs.readFileSync("./guests.csv", "utf8");
const rows = parse(csv, { columns: true, skip_empty_lines: true });

const client = new MongoClient(MONGODB_URI, {
  serverSelectionTimeoutMS: 12000,
  socketTimeoutMS: 60000,
  maxPoolSize: 5,
  retryWrites: true
});

function randomToken() {
  return crypto.randomBytes(16).toString("hex");
}

async function connectWithRetry() {
  const max = 4;
  for (let i = 1; i <= max; i++) {
    try { await client.connect(); return; }
    catch (e) {
      console.error(`connect attempt ${i}/${max} failed:`, e.message);
      if (i === max) throw e;
      await new Promise(r => setTimeout(r, i * 1000));
    }
  }
}

(async () => {
  try {
    await connectWithRetry();
    const db = client.db(DB_NAME);
    const passes = db.collection("passes");

    for (const row of rows) {
      const token = randomToken();
      const doc = {
        _id: token,
        name: (row.name || "Guest").trim(),
        phone: row.phone?.trim() || null,
        note: row.note?.trim() || null,
        status: "unused",
        createdAt: new Date(),
        checkedInAt: null
      };
      await passes.insertOne(doc);

      const url = SITE_BASE + encodeURIComponent(token);
      const filenameSafe = (row.name || "Guest").replace(/\s+/g, "_");
      const file = path.join(outDir, `${filenameSafe}_${token.slice(0,6)}.png`);
      await QRCode.toFile(file, url, { margin: 1, width: 600 });

      console.log(`Created: ${row.name || "Guest"} → ${url}`);
    }
    console.log("Done. PNGs in qr_out/");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
})();
