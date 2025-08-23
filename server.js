// server.js
import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import morgan from "morgan";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { Readable } from "node:stream";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security & logs
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(morgan("tiny"));
app.use(express.json({ limit: "2mb" }));

// Static client
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// Rate limit: 60 req/min per IP
const ttsLimiter = new RateLimiterMemory({ points: 60, duration: 60 });

// ElevenLabs proxy
app.post("/api/tts", async (req, res) => {
  try {
    try {
      await ttsLimiter.consume(req.ip);
    } catch {
      return res.status(429).json({ error: "Too many requests" });
    }

    const { text, model = "eleven_multilingual_v2", voice_settings } = req.body || {};
    if (!process.env.ELEVEN_API_KEY || !process.env.ELEVEN_VOICE_ID) {
      return res.status(500).json({ error: "Server TTS sozlanmagan (API_KEY/VOICE_ID yo‘q)." });
    }
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Matn (text) talab qilinadi." });
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVEN_VOICE_ID}?optimize_streaming_latency=2&output_format=mp3_44100_128`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVEN_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: voice_settings?.stability ?? 0.55,
          similarity_boost: voice_settings?.similarity_boost ?? 0.85,
          style: voice_settings?.style ?? 0.2,
          use_speaker_boost: true
        }
      })
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return res.status(502).json({ error: "ElevenLabs error", detail });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    // Node 18+: convert Web ReadableStream -> Node Readable and pipe to res
    const nodeStream = Readable.fromWeb(resp.body);
    nodeStream.on("error", () => res.end());
    nodeStream.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server ichki xatosi" });
  }
});

// SPA fallback
app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 5173;
app.listen(PORT, () => console.log(`✅ Server http://localhost:${PORT} da ishlayapti`));
