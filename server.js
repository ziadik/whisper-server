const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const WebSocket = require("ws");
const https = require("https");

const app = express();

// ============================================================
// HTTPS
// ============================================================
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

// ============================================================
// Middleware
// ============================================================
app.use(cors());
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));
app.use(express.static("public"));
app.use("/example", express.static("example"));

app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

// ============================================================
// Пути
// ============================================================
const WHISPER_DIR = path.join(__dirname, "whisper150");
const UPLOADS_DIR = path.join(WHISPER_DIR, "uploads");
const MODELS_DIR = path.join(WHISPER_DIR, "models");
const EXAMPLE_DIR = path.join(__dirname, "example");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log(`📁 Created uploads directory: ${UPLOADS_DIR}`);
}

if (!fs.existsSync(EXAMPLE_DIR)) {
  fs.mkdirSync(EXAMPLE_DIR, { recursive: true });
  console.log(`📁 Created example directory: ${EXAMPLE_DIR}`);
}

// ============================================================
// Multer
// ============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const ext = path.extname(file.originalname).toLowerCase() || ".webm";
    cb(null, `${timestamp}-${random}${ext}`);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("audio/") ||
      file.mimetype === "video/webm" ||
      file.originalname.match(/\.(wav|mp3|m4a|webm|ogg|flac|aac)$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
    }
  },
});

// ============================================================
// Whisper config — доступные модели
// ============================================================
const WHISPER_CONFIG = {
  cwd: WHISPER_DIR,
  executable: "main.exe",
  language: "ru",
  threads: 4,
};

// Доступные модели
const AVAILABLE_MODELS = {
  small: {
    name: "ggml-small-q8_0.bin",
    path: path.join("models", "ggml-small-q8_0.bin"),
    label: "Small (258 MB) — быстро",
    sizeMB: 258,
    speed: "⚡ Быстро",
    quality: "80-85%",
  },
  medium: {
    name: "ggml-medium-q8_0.bin",
    path: path.join("models", "ggml-medium-q8_0.bin"),
    label: "Medium (804 MB) — баланс",
    sizeMB: 804,
    speed: "⚖️ Средне",
    quality: "85-90%",
  },
  large: {
    name: "ggml-large-v3-q5_0.bin",
    path: path.join("models", "ggml-large-v3-q5_0.bin"),
    label: "Large (1 GB) — максимум",
    sizeMB: 1024,
    speed: "🐌 Медленно",
    quality: "90-95%",
  },
};

const DEFAULT_MODEL = "small";

// Настройки нарезки
const SPLIT_THRESHOLD_BYTES = 20 * 1024 * 1024; // 20 MB
const SEGMENT_TIME_SEC = 600; // 10 минут

// ============================================================
// WebSocket
// ============================================================
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

// ============================================================
// Утилита: форматирование секунд → MM:SS или HH:MM:SS
// ============================================================
function formatTime(seconds) {
  seconds = Math.floor(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ============================================================
// Утилита: длительность аудио через ffprobe
// ============================================================
function getAudioDuration(filePath) {
  return new Promise((resolve) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);

    let stdout = "";
    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.on("close", () => {
      const duration = parseFloat(stdout.trim());
      resolve(isNaN(duration) ? 0 : duration);
    });

    ffprobe.on("error", () => {
      resolve(0);
    });
  });
}

// ============================================================
// Утилита: очистка текста от галлюцинаций (повторов)
// ============================================================
function cleanTranscription(text) {
  if (!text) return "";

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const unique = [];
  for (const sentence of sentences) {
    const last = unique[unique.length - 1];
    if (last && last.toLowerCase() === sentence.toLowerCase()) {
      continue;
    }
    unique.push(sentence);
  }

  const cleaned = unique.map((sentence) => {
    const words = sentence.split(/\s+/);
    const result = [];
    let i = 0;
    while (i < words.length) {
      let foundRepeat = false;
      for (let blockSize = 10; blockSize >= 3; blockSize--) {
        if (i + blockSize * 2 > words.length) continue;
        const block1 = words.slice(i, i + blockSize).join(" ");
        const block2 = words.slice(i + blockSize, i + blockSize * 2).join(" ");
        if (block1.toLowerCase() === block2.toLowerCase()) {
          result.push(block1);
          i += blockSize * 2;
          foundRepeat = true;
          break;
        }
      }
      if (!foundRepeat) {
        result.push(words[i]);
        i++;
      }
    }
    return result.join(" ");
  });

  return cleaned
    .filter((s) => s.length > 0)
    .join(" ")
    .trim();
}

// ============================================================
// ФУНКЦИЯ 1: Конвертация в WAV 16kHz/16bit/mono
// ============================================================
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
    let lastProgress = "";

    ffmpeg.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      const progressMatch = chunk.match(/size=\s*(\d+)kB.*time=(\d+:\d+:\d+)/);
      if (progressMatch) {
        const progress = `${progressMatch[1]}kB, time=${progressMatch[2]}`;
        if (progress !== lastProgress) {
          console.log(`   Progress: ${progress}`);
          lastProgress = progress;
        }
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

// ============================================================
// ФУНКЦИЯ 2: Обрезка тишины (безопасная версия)
// ============================================================
function trimSilence(inputPath, outputPath) {
  return new Promise((resolve) => {
    console.log(`✂️  Trimming silence: ${path.basename(inputPath)}`);

    // Проверяем длительность до обрезки
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);

    let durationStr = "";
    ffprobe.stdout.on("data", (data) => {
      durationStr += data.toString();
    });

    ffprobe.on("error", () => {
      resolve(inputPath);
    });

    ffprobe.on("close", () => {
      const originalDuration = parseFloat(durationStr.trim()) || 0;

      const ffmpeg = spawn("ffmpeg", [
        "-i",
        inputPath,
        // Менее агрессивный фильтр: -40dB, минимум 2 сек тишины
        "-af",
        "silenceremove=start_periods=1:start_duration=2:start_threshold=-40dB:detection=peak,areverse,silenceremove=start_periods=1:start_duration=2:start_threshold=-40dB:detection=peak,areverse",
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
        stderr += data.toString();
      });

      ffmpeg.on("error", () => {
        resolve(inputPath);
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          console.error("❌ FFmpeg trim error:", stderr);
          resolve(inputPath);
          return;
        }

        // Проверяем длительность после обрезки
        const ffprobe2 = spawn("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          outputPath,
        ]);

        let newDurationStr = "";
        ffprobe2.stdout.on("data", (data) => {
          newDurationStr += data.toString();
        });

        ffprobe2.on("error", () => {
          resolve(outputPath);
        });

        ffprobe2.on("close", () => {
          const newDuration = parseFloat(newDurationStr.trim()) || 0;

          // Если после обрезки осталось < 50% исходного — используем оригинал
          if (newDuration < originalDuration * 0.5) {
            console.log(
              `   ⚠️ Trimmed too much (${newDuration.toFixed(1)}s of ${originalDuration.toFixed(1)}s) — using original`,
            );
            try {
              fs.unlinkSync(outputPath);
            } catch (e) {}
            resolve(inputPath);
            return;
          }

          // Если осталось < 1 сек — считаем тишиной
          if (newDuration < 1) {
            console.log(
              `   ⚠️ File after trim is too small — probably silence only`,
            );
            try {
              fs.unlinkSync(outputPath);
            } catch (e) {}
            resolve(null);
            return;
          }

          console.log(
            `✅ Silence trimmed (${originalDuration.toFixed(1)}s → ${newDuration.toFixed(1)}s)`,
          );
          resolve(outputPath);
        });
      });
    });
  });
}

// ============================================================
// ФУНКЦИЯ 3: Нарезка WAV на части + длительности
// ============================================================
function splitAudio(inputPath, segmentTime = 600) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(inputPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPattern = path.join(dir, `${baseName}_part_%03d.wav`);

    console.log(`✂️  Splitting audio into ${segmentTime}-second segments...`);
    console.log(`   Input: ${path.basename(inputPath)}`);
    console.log(`   Output pattern: ${path.basename(outputPattern)}`);

    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      segmentTime.toString(),
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-y",
      outputPattern,
    ]);

    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", async (code) => {
      if (code === 0) {
        const partFiles = fs
          .readdirSync(dir)
          .filter(
            (f) => f.startsWith(`${baseName}_part_`) && f.endsWith(".wav"),
          )
          .sort();

        const parts = [];
        let offset = 0;
        for (const f of partFiles) {
          const fullPath = path.join(dir, f);
          const duration = await getAudioDuration(fullPath);
          parts.push({
            path: fullPath,
            name: f,
            start: offset,
            duration: duration,
            end: offset + duration,
          });
          offset += duration;
        }

        console.log(`✅ Split into ${parts.length} parts:`);
        parts.forEach((p, i) => {
          const size = (fs.statSync(p.path).size / 1024 / 1024).toFixed(2);
          console.log(
            `   [${i}] ${p.name} (${size} MB) — ${formatTime(p.start)} – ${formatTime(p.end)}`,
          );
        });

        resolve(parts);
      } else {
        console.error("❌ FFmpeg split error:", stderr);
        reject(new Error(`FFmpeg split failed: ${stderr.substring(0, 200)}`));
      }
    });

    ffmpeg.on("error", (error) => {
      reject(new Error(`FFmpeg not found: ${error.message}`));
    });
  });
}

// ============================================================
// ФУНКЦИЯ 4: Распознавание ОДНОГО WAV файла
// ============================================================
function transcribeSingleFile(wavPath, language, options = {}, modelKey = DEFAULT_MODEL) {
  return new Promise((resolve, reject) => {
    const model = AVAILABLE_MODELS[modelKey] || AVAILABLE_MODELS[DEFAULT_MODEL];
    const relativeWavPath = path.join("uploads", path.basename(wavPath));

    const args = [
      "-m", model.path,
      "-f", relativeWavPath,
      "-l", language,
      "-t", WHISPER_CONFIG.threads.toString(),
      "-nt",  // --no-timestamps
    ];

    // Анти-галлюцинации — только поддерживаемые флаги
    if (options.antiHallucination) {
      args.push("-mc", "0");  // --max-context 0
      args.push("-nf");       // --no-fallback
    }

    if (options.beamSize) {
      args.push("-bs", options.beamSize.toString());  // --beam-size
    }

    console.log(`\n🚀 Whisper: ${path.basename(wavPath)}`);
    console.log(`   Model: ${model.name} (${model.label})`);
    console.log(`   Command: ${WHISPER_CONFIG.executable} ${args.join(" ")}`);

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

        let cleanLine = trimmed;
        cleanLine = cleanLine.replace(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/, "");
        cleanLine = cleanLine.replace(
          /^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\s*/,
          "",
        );

        if (cleanLine && cleanLine.length > 0 && !cleanLine.includes("system_info")) {
          transcribedText += (transcribedText ? " " : "") + cleanLine;
          console.log(`   📝 ${path.basename(wavPath)}: "${cleanLine}"`);
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
        console.log("STDERR:", chunk.trim().substring(0, 300));
      }
    });

    whisperProcess.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Whisper failed with code ${code}: ${stderr.substring(0, 300)}`,
          ),
        );
        return;
      }

      const rawText = transcribedText.trim();
      let finalText = rawText;

      if (options.cleanRepeats) {
        finalText = cleanTranscription(rawText);
      }

      console.log(`\n📄 ${path.basename(wavPath)} — результат:`);
      console.log(`   Raw:     ${rawText.length} симв.`);
      if (options.cleanRepeats) {
        console.log(`   Cleaned: ${finalText.length} симв.`);
      }
      console.log(`   "${finalText.substring(0, 100)}"\n`);

      resolve(finalText);
    });

    whisperProcess.on("error", (error) => {
      reject(new Error(`Failed to start whisper: ${error.message}`));
    });

    const TIMEOUT_MS = 30 * 60 * 1000;
    const timeout = setTimeout(() => {
      if (!whisperProcess.killed) {
        whisperProcess.kill();
        reject(new Error(`Whisper timeout (${TIMEOUT_MS / 1000}s)`));
      }
    }, TIMEOUT_MS);

    whisperProcess.on("close", () => clearTimeout(timeout));
  });
}

// ============================================================
// ФУНКЦИЯ 5: Главная — конвертация → нарезка → распознавание
// ============================================================
async function transcribeAudio(audioFilename, language = "ru", options = {}) {
  const modelKey = options.model || DEFAULT_MODEL;
  const originalPath = path.join(UPLOADS_DIR, audioFilename);
  const wavFilename = audioFilename.replace(/\.[^/.]+$/, ".wav");
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
      `\n📁 Original file: ${audioFilename} (${(stats.size / 1024).toFixed(2)} KB)`,
    );

    // Шаг 1: конвертация
    console.log(`🔄 Converting to WAV (16kHz, 16bit, mono)...`);
    await convertToWav(originalPath, wavPath);

    if (!fs.existsSync(wavPath)) {
      throw new Error("Converted WAV file not found");
    }

    const wavStats = fs.statSync(wavPath);
    if (wavStats.size < 1000) {
      throw new Error(`Converted WAV file too small (${wavStats.size} bytes)`);
    }

    console.log(
      `📁 Converted WAV: ${wavFilename} (${(wavStats.size / 1024 / 1024).toFixed(2)} MB)`,
    );

    try {
      if (fs.existsSync(originalPath) && originalPath !== wavPath) {
        fs.unlinkSync(originalPath);
        console.log(`🗑️ Deleted original: ${audioFilename}`);
      }
    } catch (err) {}

    let finalText = "";

    // Шаг 2: нарезка
    if (wavStats.size > SPLIT_THRESHOLD_BYTES) {
      console.log(
        `✂️  File is large (${(wavStats.size / 1024 / 1024).toFixed(2)} MB > ${SPLIT_THRESHOLD_BYTES / 1024 / 1024} MB) — splitting...`,
      );

      const parts = await splitAudio(wavPath, SEGMENT_TIME_SEC);

      broadcastStatus("split", {
        totalParts: parts.length,
        message: `Файл разбит на ${parts.length} частей`,
      });

      try {
        fs.unlinkSync(wavPath);
        console.log(`🗑️ Deleted original WAV: ${wavFilename}`);
      } catch (err) {}

      const results = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        console.log(
          `\n🎯 Processing part ${i + 1}/${parts.length}: ${part.name} (${formatTime(part.start)} – ${formatTime(part.end)})`,
        );

        broadcastStatus("part_start", {
          currentPart: i + 1,
          totalParts: parts.length,
          startTime: part.start,
          endTime: part.end,
          startTimeFormatted: formatTime(part.start),
          endTimeFormatted: formatTime(part.end),
          message: `Обработка части ${i + 1}/${parts.length} (${formatTime(part.start)} – ${formatTime(part.end)})...`,
        });

        // Обрезка тишины (если включена)
        let resultPath = part.path;
        if (options.trimSilence) {
          const trimmedPath = path.join(UPLOADS_DIR, `trimmed_${part.name}`);
          const trimmed = await trimSilence(part.path, trimmedPath);
          if (!trimmed) {
            console.log(`   ⚠️ Part ${i + 1} is silent — skipping`);
            broadcastStatus("part_result", {
              currentPart: i + 1,
              totalParts: parts.length,
              startTime: part.start,
              endTime: part.end,
              startTimeFormatted: formatTime(part.start),
              endTimeFormatted: formatTime(part.end),
              text: "",
              message: `Часть ${i + 1}/${parts.length} пуста (тишина)`,
            });
            try {
              fs.unlinkSync(part.path);
            } catch (e) {}
            continue;
          }
          resultPath = trimmed;
        }

        try {
          const text = await transcribeSingleFile(
            resultPath,
            language,
            options,
            modelKey,
          );
          if (text) {
            results.push(text);
            console.log(`   ✅ Part ${i + 1} done (${text.length} chars)`);

            broadcastStatus("part_result", {
              currentPart: i + 1,
              totalParts: parts.length,
              startTime: part.start,
              endTime: part.end,
              startTimeFormatted: formatTime(part.start),
              endTimeFormatted: formatTime(part.end),
              text: text,
              message: `Часть ${i + 1}/${parts.length} распознана`,
            });
          } else {
            console.log(`   ⚠️ Part ${i + 1} returned empty`);
            broadcastStatus("part_result", {
              currentPart: i + 1,
              totalParts: parts.length,
              startTime: part.start,
              endTime: part.end,
              startTimeFormatted: formatTime(part.start),
              endTimeFormatted: formatTime(part.end),
              text: "",
              message: `Часть ${i + 1}/${parts.length} пуста`,
            });
          }
        } catch (err) {
          console.error(`   ❌ Part ${i + 1} failed:`, err.message);
          broadcastStatus("part_error", {
            currentPart: i + 1,
            totalParts: parts.length,
            startTime: part.start,
            endTime: part.end,
            startTimeFormatted: formatTime(part.start),
            endTimeFormatted: formatTime(part.end),
            message: `Ошибка в части ${i + 1}/${parts.length}: ${err.message}`,
          });
        } finally {
          if (resultPath !== part.path) {
            try {
              fs.unlinkSync(resultPath);
            } catch (e) {}
          }
          try {
            fs.unlinkSync(part.path);
          } catch (e) {}
          console.log(`   🗑️ Deleted part: ${part.name}`);
        }
      }

      finalText = results.join(" ").trim();
    } else {
      // Маленький файл
      console.log(`🎯 File is small — processing as single file`);

      const duration = await getAudioDuration(wavPath);

      broadcastStatus("part_start", {
        currentPart: 1,
        totalParts: 1,
        startTime: 0,
        endTime: duration,
        startTimeFormatted: "00:00",
        endTimeFormatted: formatTime(duration),
        message: `Обработка файла (00:00 – ${formatTime(duration)})...`,
      });

      let resultPath = wavPath;
      if (options.trimSilence) {
        const trimmedPath = path.join(UPLOADS_DIR, `trimmed_${wavFilename}`);
        const trimmed = await trimSilence(wavPath, trimmedPath);
        if (trimmed) {
          resultPath = trimmed;
        }
      }

      finalText = await transcribeSingleFile(
        resultPath,
        language,
        options,
        modelKey,
      );

      broadcastStatus("part_result", {
        currentPart: 1,
        totalParts: 1,
        startTime: 0,
        endTime: duration,
        startTimeFormatted: "00:00",
        endTimeFormatted: formatTime(duration),
        text: finalText,
        message: `Файл распознан`,
      });

      if (resultPath !== wavPath) {
        try {
          fs.unlinkSync(resultPath);
        } catch (e) {}
      }
      try {
        fs.unlinkSync(wavPath);
        console.log(`🗑️ Deleted temp WAV: ${wavFilename}`);
      } catch (err) {}
    }

    if (!finalText.trim()) {
      throw new Error(
        "No transcription result. Audio might be too short or silent.",
      );
    }

    console.log(`\n✅ Final text length: ${finalText.length} chars`);
    return finalText.trim();
  } catch (error) {
    console.error("❌ Error:", error.message);
    try {
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    } catch (err) {}
    throw error;
  }
}

// ============================================================
// API
// ============================================================
app.get("/api/status", (req, res) => {
  const executablePath = path.join(WHISPER_DIR, WHISPER_CONFIG.executable);
  const executableExists = fs.existsSync(executablePath);

  const modelsStatus = {};
  for (const [key, m] of Object.entries(AVAILABLE_MODELS)) {
    const fullPath = path.join(WHISPER_DIR, m.path);
    modelsStatus[key] = fs.existsSync(fullPath);
  }

  res.json({
    status: "running",
    modelLoaded: Object.values(modelsStatus).some((v) => v),
    executableExists: executableExists,
    models: modelsStatus,
    defaultModel: DEFAULT_MODEL,
    config: {
      executable: WHISPER_CONFIG.executable,
      language: WHISPER_CONFIG.language,
      threads: WHISPER_CONFIG.threads,
      workingDirectory: WHISPER_DIR,
      splitThresholdMB: SPLIT_THRESHOLD_BYTES / 1024 / 1024,
      segmentTimeSec: SEGMENT_TIME_SEC,
    },
  });
});

app.get("/api/models", (req, res) => {
  const models = Object.entries(AVAILABLE_MODELS).map(([key, m]) => {
    const fullPath = path.join(WHISPER_DIR, m.path);
    return {
      key,
      name: m.name,
      label: m.label,
      sizeMB: m.sizeMB,
      speed: m.speed,
      quality: m.quality,
      exists: fs.existsSync(fullPath),
    };
  });
  res.json({ models, default: DEFAULT_MODEL });
});

app.get("/api/test-files", (req, res) => {
  if (!fs.existsSync(EXAMPLE_DIR)) {
    return res.json({ files: [] });
  }

  try {
    const files = fs
      .readdirSync(EXAMPLE_DIR)
      .filter((file) => file.match(/\.(wav|mp3|m4a|webm|ogg)$/i))
      .map((file) => ({
        name: file,
        path: `/example/${file}`,
        size: fs.statSync(path.join(EXAMPLE_DIR, file)).size,
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

    // Настройки качества с клиента
    const options = {
      antiHallucination: req.body.antiHallucination === "1",
      trimSilence: req.body.trimSilence === "1",
      cleanRepeats: req.body.cleanRepeats === "1",
      temperature: parseFloat(req.body.temperature) || 0,
      beamSize: parseInt(req.body.beamSize) || 5,
      model: req.body.model || DEFAULT_MODEL,
    };

    console.log(`\n📥 Received audio file:`);
    console.log(`   Filename: ${audioFilename}`);
    console.log(`   Original size: ${(req.file.size / 1024).toFixed(2)} KB`);
    console.log(`   Language: ${language}`);
    console.log(`   MIME type: ${req.file.mimetype}`);
    console.log(`   Original name: ${req.file.originalname}`);
    console.log(`   Model: ${options.model}`);
    console.log(`   Quality options:`, options);

    try {
      broadcastStatus("processing", {
        message: `Конвертация и обработка аудио (модель: ${options.model})...`,
      });
    } catch (err) {}

    const transcribedText = await transcribeAudio(
      audioFilename,
      language,
      options,
    );

    console.log(
      `✅ Transcription complete: "${transcribedText.substring(0, 100)}..."`,
    );

    res.json({
      success: true,
      text: transcribedText,
      language: language,
      model: options.model,
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

// ============================================================
// Запуск
// ============================================================
const PORT = process.env.PORT || 9008;

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n" + "=".repeat(60));
  console.log("🎙️  WHISPER SERVER STARTED (HTTPS)");
  console.log("=".repeat(60));
  console.log(`\n👤 Author: Зядик Дмитрий Сергеевич`);
  console.log(`🌐 Website: https://ziidik.ru/`);
  console.log(`\n🌐 HTTPS Server URL: https://localhost:${PORT}`);
  console.log(`🌐 Network access: https://YOUR_IP:${PORT}`);

  console.log(`\n📁 Configuration:`);
  console.log(`   Whisper dir: ${WHISPER_DIR}`);
  console.log(`   Language: ${WHISPER_CONFIG.language}`);
  console.log(`   Threads: ${WHISPER_CONFIG.threads}`);

  console.log(`\n🤖 Available models:`);
  for (const [key, m] of Object.entries(AVAILABLE_MODELS)) {
    const fullPath = path.join(WHISPER_DIR, m.path);
    const exists = fs.existsSync(fullPath);
    const stats = exists ? fs.statSync(fullPath) : null;
    const sizeStr = stats
      ? (stats.size / 1024 / 1024).toFixed(2) + " MB"
      : "NOT FOUND";
    const mark = key === DEFAULT_MODEL ? " (default)" : "";
    console.log(
      `   ${exists ? "✓" : "❌"} ${key}: ${m.name} — ${sizeStr}${mark}`,
    );
  }

  console.log(`\n✂️  Splitting settings:`);
  console.log(`   Threshold: ${SPLIT_THRESHOLD_BYTES / 1024 / 1024} MB`);
  console.log(
    `   Segment length: ${SEGMENT_TIME_SEC} sec (${SEGMENT_TIME_SEC / 60} min)`,
  );

  console.log(`\n✅ Status:`);

  const executablePath = path.join(WHISPER_DIR, WHISPER_CONFIG.executable);
  if (!fs.existsSync(executablePath)) {
    console.log(`   ❌ main.exe NOT FOUND`);
  } else {
    console.log(`   ✓ main.exe found`);
  }

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
  console.log(`   Supported formats: WAV, MP3, M4A, WebM, OGG, FLAC, AAC`);
  console.log(`   All files are converted to 16kHz/16bit/mono WAV`);
  console.log(
    `   Files larger than ${SPLIT_THRESHOLD_BYTES / 1024 / 1024} MB are split into ${SEGMENT_TIME_SEC / 60}-min segments`,
  );
  console.log(`   Max file size: 500 MB`);
  console.log(`\n⚠️  Note: Using self-signed certificate`);
  console.log(`   In browser, click "Advanced" -> "Proceed to site"`);
  console.log("\n" + "=".repeat(60) + "\n");
});
