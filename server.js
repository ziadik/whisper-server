const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const WebSocket = require("ws");
const https = require("https");

const app = express();

// Настройки HTTPS
let httpsOptions;
try {
  httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, "key.pem")),
    cert: fs.readFileSync(path.join(__dirname, "cert.pem")),
  };
  console.log("✅ SSL certificates loaded");
} catch (error) {
  console.error("❌ SSL certificates not found!");
  console.error(
    "   Please ensure key.pem and cert.pem exist in the project root",
  );
  process.exit(1);
}

const server = https.createServer(httpsOptions, app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("public"));
app.use("/example", express.static("example"));

// Обработка favicon
app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

// Пути
const WHISPER_DIR = path.join(__dirname, "whisper150");
const UPLOADS_DIR = path.join(WHISPER_DIR, "uploads");
const MODELS_DIR = path.join(WHISPER_DIR, "models");
const EXAMPLE_DIR = path.join(__dirname, "example");

// Создаем папки
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log(`📁 Created uploads directory: ${UPLOADS_DIR}`);
}

if (!fs.existsSync(EXAMPLE_DIR)) {
  fs.mkdirSync(EXAMPLE_DIR, { recursive: true });
  console.log(`📁 Created example directory: ${EXAMPLE_DIR}`);
  console.log(`   Place test audio files in this folder`);
}

// Настройка multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    // Сохраняем как .webm для оригинального файла
    cb(null, `${timestamp}-${random}.webm`);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("audio/") ||
      file.originalname.match(/\.(wav|mp3|m4a|webm)$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
    }
  },
});

// Конфигурация whisper
const WHISPER_CONFIG = {
  cwd: WHISPER_DIR,
  executable: "main.exe",
  model: path.join("models", "ggml-small-q8_0.bin"),
  language: "ru",
  threads: 4,
};

// WebSocket
const clients = new Set();

wss.on("connection", (ws) => {
  console.log("New WebSocket client connected");
  clients.add(ws);

  ws.on("close", () => {
    clients.delete(ws);
    console.log("Client disconnected");
  });

  ws.send(
    JSON.stringify({
      type: "connected",
      message: "Connected to Whisper Server",
    }),
  );
});

function broadcastStatus(status, data = null) {
  const message = JSON.stringify({ type: "status", status, data });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Функция конвертации в WAV с помощью FFmpeg
function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(
      `🔄 Converting: ${path.basename(inputPath)} -> ${path.basename(outputPath)}`,
    );

    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-y",
      outputPath,
    ]);

    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Показываем прогресс
      const progressMatch = chunk.match(/size=\s*(\d+)kB/);
      if (progressMatch) {
        console.log(`   Progress: ${progressMatch[1]} kB processed`);
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        console.log("✅ FFmpeg conversion successful");
        resolve();
      } else {
        console.error("❌ FFmpeg error:", stderr);
        reject(
          new Error(`FFmpeg conversion failed: ${stderr.substring(0, 200)}`),
        );
      }
    });

    ffmpeg.on("error", (error) => {
      console.error("❌ FFmpeg process error:", error);
      reject(
        new Error(`FFmpeg not found: ${error.message}. Please install FFmpeg.`),
      );
    });
  });
}

// Функция транскрипции
async function transcribeAudio(audioFilename, language = "ru") {
  const originalPath = path.join(UPLOADS_DIR, audioFilename);
  // Создаем уникальное имя для WAV файла
  const wavFilename = audioFilename.replace(/\.webm$/, ".wav");
  const wavPath = path.join(UPLOADS_DIR, wavFilename);

  try {
    if (!fs.existsSync(originalPath)) {
      throw new Error(`Audio file not found: ${originalPath}`);
    }

    const stats = fs.statSync(originalPath);
    if (stats.size < 1000) {
      throw new Error(`Audio file too small (${stats.size} bytes)`);
    }

    console.log(
      `\n📁 Original webm file: ${audioFilename} (${(stats.size / 1024).toFixed(2)} KB)`,
    );

    // Конвертируем WebM в WAV
    console.log(`🔄 Converting WebM to WAV (16kHz, 16bit, mono)...`);
    await convertToWav(originalPath, wavPath);

    // Проверяем сконвертированный файл
    if (!fs.existsSync(wavPath)) {
      throw new Error("Converted WAV file not found");
    }

    const wavStats = fs.statSync(wavPath);
    if (wavStats.size < 1000) {
      throw new Error(`Converted WAV file too small (${wavStats.size} bytes)`);
    }

    console.log(
      `📁 Converted WAV: ${wavFilename} (${(wavStats.size / 1024).toFixed(2)} KB)`,
    );

    // Удаляем оригинальный WebM файл
    try {
      if (fs.existsSync(originalPath)) {
        fs.unlinkSync(originalPath);
        console.log(`🗑️ Deleted original webm: ${audioFilename}`);
      }
    } catch (err) {}

    const relativeWavPath = path.join("uploads", wavFilename);
    const args = [
      "-m",
      WHISPER_CONFIG.model,
      "-f",
      relativeWavPath,
      "-l",
      language,
      "-t",
      WHISPER_CONFIG.threads.toString(),
      "--no-timestamps",
    ];

    console.log(`\n🚀 Executing whisper:`);
    console.log(`   Command: ${WHISPER_CONFIG.executable} ${args.join(" ")}`);

    return new Promise((resolve, reject) => {
      let transcribedText = "";
      let stderr = "";

      const whisperProcess = spawn(WHISPER_CONFIG.executable, args, {
        cwd: WHISPER_CONFIG.cwd,
        shell: true,
      });

      whisperProcess.stdout.on("data", (data) => {
        const output = data.toString();

        const lines = output.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Пропускаем служебные строки
          if (
            trimmed.includes("-->") ||
            trimmed.startsWith("whisper_") ||
            trimmed.startsWith("main:") ||
            trimmed.startsWith("system_info") ||
            trimmed.includes("load time") ||
            trimmed.includes("mel time") ||
            trimmed.includes("sample time") ||
            trimmed.includes("encode time") ||
            trimmed.includes("decode time") ||
            trimmed.match(/^\[?\d{2}:\d{2}:\d{2}/)
          ) {
            continue;
          }

          // Очищаем от таймкодов
          let cleanLine = trimmed;
          cleanLine = cleanLine.replace(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/, "");
          cleanLine = cleanLine.replace(
            /^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\s*/,
            "",
          );

          if (
            cleanLine &&
            cleanLine.length > 0 &&
            !cleanLine.includes("system_info")
          ) {
            transcribedText += (transcribedText ? " " : "") + cleanLine;
            console.log(`   📝 Captured: "${cleanLine}"`);
          }
        }
      });

      whisperProcess.stderr.on("data", (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (
          !chunk.includes("Loading") &&
          !chunk.includes("system_info") &&
          !chunk.includes("whisper_model_load") &&
          !chunk.includes("whisper_init") &&
          !chunk.includes("whisper_print_timings")
        ) {
          // Выводим только важные ошибки
          if (!chunk.includes("pcm_s16le")) {
            console.log("STDERR:", chunk.trim());
          }
        }
      });

      whisperProcess.on("close", (code) => {
        console.log(`Whisper process exited with code ${code}`);
        console.log(`📝 Final text: "${transcribedText}"`);

        // Удаляем временный WAV файл
        try {
          if (fs.existsSync(wavPath)) {
            fs.unlinkSync(wavPath);
            console.log(`🗑️ Deleted temp WAV: ${wavFilename}`);
          }
        } catch (err) {}

        if (code !== 0) {
          reject(
            new Error(
              `Whisper failed with code ${code}: ${stderr.substring(0, 200)}`,
            ),
          );
          return;
        }

        if (!transcribedText.trim()) {
          reject(
            new Error(
              "No transcription result. Audio might be too short or silent.",
            ),
          );
          return;
        }

        resolve(transcribedText.trim());
      });

      whisperProcess.on("error", (error) => {
        reject(new Error(`Failed to start whisper: ${error.message}`));
      });

      const timeout = setTimeout(() => {
        if (!whisperProcess.killed) {
          whisperProcess.kill();
          reject(new Error("Whisper process timeout (60 seconds)"));
        }
      }, 60000);

      whisperProcess.on("close", () => clearTimeout(timeout));
    });
  } catch (error) {
    console.error("❌ Error:", error.message);
    throw error;
  }
}

// API эндпоинты
app.get("/api/status", (req, res) => {
  const modelPath = path.join(WHISPER_DIR, WHISPER_CONFIG.model);
  const executablePath = path.join(WHISPER_DIR, WHISPER_CONFIG.executable);
  const modelExists = fs.existsSync(modelPath);
  const executableExists = fs.existsSync(executablePath);

  res.json({
    status: "running",
    modelLoaded: modelExists,
    executableExists: executableExists,
    config: {
      model: WHISPER_CONFIG.model,
      executable: WHISPER_CONFIG.executable,
      language: WHISPER_CONFIG.language,
      threads: WHISPER_CONFIG.threads,
      workingDirectory: WHISPER_DIR,
    },
  });
});

app.get("/api/test-files", (req, res) => {
  const exampleDir = path.join(__dirname, "example");

  if (!fs.existsSync(exampleDir)) {
    return res.json({ files: [] });
  }

  try {
    const files = fs
      .readdirSync(exampleDir)
      .filter((file) => file.match(/\.(wav|mp3|m4a|webm|ogg)$/i))
      .map((file) => ({
        name: file,
        path: `/example/${file}`,
        size: fs.statSync(path.join(exampleDir, file)).size,
      }));

    res.json({ files });
  } catch (error) {
    console.error("Error listing test files:", error);
    res.status(500).json({ error: "Failed to list test files" });
  }
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  let audioFilename = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    audioFilename = req.file.filename;
    const language = req.body.language || WHISPER_CONFIG.language;

    console.log(`\n📥 Received audio file:`);
    console.log(`   Filename: ${audioFilename}`);
    console.log(`   Original size: ${(req.file.size / 1024).toFixed(2)} KB`);
    console.log(`   Language: ${language}`);
    console.log(`   MIME type: ${req.file.mimetype}`);

    try {
      broadcastStatus("processing", {
        message: `Конвертация и обработка аудио...`,
      });
    } catch (err) {}

    const transcribedText = await transcribeAudio(audioFilename, language);

    console.log(`✅ Transcription complete: "${transcribedText}"`);

    res.json({
      success: true,
      text: transcribedText,
      language: language,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Transcription error:", error.message);

    if (audioFilename) {
      const fullPath = path.join(UPLOADS_DIR, audioFilename);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`🗑️ Cleaned up: ${audioFilename}`);
        } catch (err) {}
      }
    }

    res.status(500).json({
      error: "Transcription failed",
      details: error.message,
    });
  }
});

app.get("/api/languages", (req, res) => {
  const languages = {
    ru: "Русский",
    en: "English",
    de: "Deutsch",
    fr: "Français",
    es: "Español",
    it: "Italiano",
    pt: "Português",
    nl: "Nederlands",
    pl: "Polski",
    uk: "Українська",
    zh: "中文",
    ja: "日本語",
    ko: "한국어",
  };
  res.json(languages);
});

app.post("/api/cleanup", (req, res) => {
  if (fs.existsSync(UPLOADS_DIR)) {
    const files = fs.readdirSync(UPLOADS_DIR);
    let deleted = 0;
    const now = Date.now();

    for (const file of files) {
      const filePath = path.join(UPLOADS_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > 3600000) {
        try {
          fs.unlinkSync(filePath);
          deleted++;
        } catch (err) {}
      }
    }

    res.json({ message: `Cleaned up ${deleted} old files` });
  } else {
    res.json({ message: "Upload directory not found" });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n" + "=".repeat(60));
  console.log("🎙️  WHISPER SERVER STARTED (HTTPS)");
  console.log("=".repeat(60));
  console.log(`\n🌐 HTTPS Server URL: https://localhost:${PORT}`);
  console.log(`🌐 Network access: https://YOUR_IP:${PORT}`);

  console.log(`\n📁 Configuration:`);
  console.log(`   Whisper dir: ${WHISPER_DIR}`);
  console.log(`   Model: ${WHISPER_CONFIG.model}`);
  console.log(`   Language: ${WHISPER_CONFIG.language}`);
  console.log(`   Threads: ${WHISPER_CONFIG.threads}`);

  console.log(`\n✅ Status:`);

  const executablePath = path.join(WHISPER_DIR, WHISPER_CONFIG.executable);
  if (!fs.existsSync(executablePath)) {
    console.log(`   ❌ main.exe NOT FOUND`);
  } else {
    console.log(`   ✓ main.exe found`);
  }

  const modelPath = path.join(WHISPER_DIR, WHISPER_CONFIG.model);
  if (!fs.existsSync(modelPath)) {
    console.log(`   ❌ Model NOT FOUND`);
  } else {
    const stats = fs.statSync(modelPath);
    console.log(
      `   ✓ Model found (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
    );
  }

  // Проверка FFmpeg
  const ffmpegTest = spawn("ffmpeg", ["-version"]);
  ffmpegTest.on("error", () => {
    console.log(`\n⚠️  WARNING: FFmpeg not found!`);
    console.log(`   Please install FFmpeg for audio conversion`);
    console.log(`   Download: https://www.gyan.dev/ffmpeg/builds/`);
  });
  ffmpegTest.on("close", (code) => {
    if (code === 0) {
      console.log(`\n✅ FFmpeg found - audio conversion available`);
    }
  });

  console.log(`\n💡 Ready for transcription!`);
  console.log(
    `   Audio files will be converted from WebM to WAV (16kHz/16bit/mono)`,
  );
  console.log(`\n⚠️  Note: Using self-signed certificate`);
  console.log(`   In browser, click "Advanced" -> "Proceed to site"`);
  console.log("\n" + "=".repeat(60) + "\n");
});
