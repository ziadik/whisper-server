class WhisperClient {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.audioContext = null;
    this.analyser = null;
    this.animationFrame = null;
    this.startTime = null;
    this.ws = null;
    this.stream = null;

    this.init();
  }

  async init() {
    this.bindEvents();
    await this.checkServerStatus();
    this.initWebSocket();
    this.loadLanguages();
    this.checkMicrophoneSupport();
  }

  bindEvents() {
    // Кнопки записи
    const recordBtn = document.getElementById("recordBtn");
    const stopBtn = document.getElementById("stopBtn");

    if (recordBtn)
      recordBtn.addEventListener("click", () => this.startRecording());
    if (stopBtn) stopBtn.addEventListener("click", () => this.stopRecording());

    // Загрузка файла
    const fileInput = document.getElementById("fileInput");
    const uploadBtn = document.getElementById("uploadBtn");

    if (fileInput)
      fileInput.addEventListener("change", (e) => this.handleFileSelect(e));
    if (uploadBtn) uploadBtn.addEventListener("click", () => this.uploadFile());

    // Копирование результата
    const copyBtn = document.getElementById("copyBtn");
    if (copyBtn) copyBtn.addEventListener("click", () => this.copyResult());

    // Переключение метода записи
    const methodSelect = document.getElementById("recordingMethod");
    if (methodSelect)
      methodSelect.addEventListener("change", (e) =>
        this.toggleRecordingMethod(e.target.value),
      );
  }

  checkMicrophoneSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.addStatusMessage(
        "❌ Ваш браузер не поддерживает доступ к микрофону",
        "error",
      );
      const recordBtn = document.getElementById("recordBtn");
      if (recordBtn) {
        recordBtn.disabled = true;
        recordBtn.title = "Микрофон не поддерживается в этом браузере";
      }
      return false;
    }

    // Проверяем, работает ли сайт по HTTPS или localhost
    const isSecure =
      location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1";
    if (!isSecure) {
      this.addStatusMessage(
        "⚠️ Для работы с микрофоном сайт должен быть открыт по HTTPS или localhost",
        "error",
      );
      const recordBtn = document.getElementById("recordBtn");
      if (recordBtn) {
        recordBtn.disabled = true;
        recordBtn.title =
          "Требуется HTTPS или localhost для доступа к микрофону";
      }
      return false;
    }

    return true;
  }

  async checkServerStatus() {
    try {
      const response = await fetch("/api/status");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();

      const statusText = document.getElementById("statusText");
      const indicator = document.querySelector(".status-indicator");

      if (data.modelLoaded && data.executableExists) {
        if (statusText) statusText.textContent = "✅ Сервер готов к работе";
        if (indicator) indicator.style.background = "#4ade80";
        this.addStatusMessage("Сервер подключен и готов к работе", "success");
      } else if (!data.modelLoaded) {
        if (statusText)
          statusText.textContent = "⚠️ Модель не найдена на сервере";
        if (indicator) indicator.style.background = "#f59e0b";
        this.addStatusMessage(
          "Модель не найдена. Проверьте папку whisper/models/",
          "error",
        );
      } else if (!data.executableExists) {
        if (statusText) statusText.textContent = "⚠️ whisper-cli.exe не найден";
        if (indicator) indicator.style.background = "#ef4444";
        this.addStatusMessage(
          "whisper-cli.exe не найден в папке whisper/",
          "error",
        );
      } else {
        if (statusText) statusText.textContent = "✅ Сервер готов";
        if (indicator) indicator.style.background = "#4ade80";
      }

      return data;
    } catch (error) {
      console.error("Status check error:", error);
      const statusText = document.getElementById("statusText");
      const indicator = document.querySelector(".status-indicator");
      if (statusText) statusText.textContent = "❌ Сервер недоступен";
      if (indicator) indicator.style.background = "#ef4444";
      this.addStatusMessage(
        "Не удалось подключиться к серверу. Убедитесь, что сервер запущен.",
        "error",
      );
      return null;
    }
  }

  initWebSocket() {
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("WebSocket connected");
        this.addStatusMessage("WebSocket соединение установлено", "success");
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "status") {
            this.addStatusMessage(data.data?.message || data.status, "info");
            if (data.status === "processing") {
              this.showProgress();
            }
          } else if (data.type === "connected") {
            this.addStatusMessage(data.message, "success");
          }
        } catch (err) {
          console.error("WebSocket message parse error:", err);
        }
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.addStatusMessage("WebSocket ошибка", "error");
      };

      this.ws.onclose = () => {
        console.log("WebSocket disconnected");
        // Пытаемся переподключиться через 5 секунд
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.CLOSED) {
            this.initWebSocket();
          }
        }, 5000);
      };
    } catch (error) {
      console.error("WebSocket init error:", error);
    }
  }

  async loadLanguages() {
    try {
      const response = await fetch("/api/languages");
      const languages = await response.json();
      const select = document.getElementById("languageSelect");

      if (select) {
        for (const [code, name] of Object.entries(languages)) {
          if (!select.querySelector(`option[value="${code}"]`)) {
            const option = document.createElement("option");
            option.value = code;
            option.textContent = name;
            select.appendChild(option);
          }
        }
      }
    } catch (error) {
      console.error("Failed to load languages:", error);
    }
  }

  async startRecording() {
    // Проверка поддержки микрофона
    if (!this.checkMicrophoneSupport()) {
      return;
    }

    try {
      // Запрашиваем доступ к микрофону
      this.addStatusMessage("Запрос доступа к микрофону...", "info");

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          sampleSize: 16,
        },
      });

      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: this.getSupportedMimeType(),
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const mimeType = this.mediaRecorder.mimeType;
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        await this.transcribeAudio(audioBlob);

        // Останавливаем все треки
        if (this.stream) {
          this.stream.getTracks().forEach((track) => track.stop());
          this.stream = null;
        }
      };

      // Начинаем запись с интервалом в 1 секунду для получения данных
      this.mediaRecorder.start(1000);

      this.isRecording = true;
      this.startTime = Date.now();

      const recordBtn = document.getElementById("recordBtn");
      const stopBtn = document.getElementById("stopBtn");

      if (recordBtn) recordBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;

      this.startVisualization(this.stream);
      this.updateRecordingTime();

      this.addStatusMessage("🎤 Запись началась... Говорите четко", "success");
    } catch (error) {
      console.error("Error starting recording:", error);

      let errorMessage = "Ошибка доступа к микрофону: ";
      if (error.name === "NotAllowedError") {
        errorMessage += "Пользователь запретил доступ к микрофону";
      } else if (error.name === "NotFoundError") {
        errorMessage += "Микрофон не найден";
      } else if (error.name === "NotReadableError") {
        errorMessage += "Микрофон занят другим приложением";
      } else if (error.name === "SecurityError") {
        errorMessage += "Доступ к микрофону запрещен политиками безопасности";
      } else {
        errorMessage += error.message;
      }

      this.addStatusMessage(errorMessage, "error");

      const recordBtn = document.getElementById("recordBtn");
      if (recordBtn) recordBtn.disabled = false;
    }
  }

  getSupportedMimeType() {
    const types = ["audio/webm", "audio/mp4", "audio/wav", "audio/ogg"];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return "";
  }

  stopRecording() {
    if (
      this.mediaRecorder &&
      this.isRecording &&
      this.mediaRecorder.state !== "inactive"
    ) {
      this.mediaRecorder.stop();
      this.isRecording = false;

      const recordBtn = document.getElementById("recordBtn");
      const stopBtn = document.getElementById("stopBtn");

      if (recordBtn) recordBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;

      this.stopVisualization();
      this.addStatusMessage(
        "Запись остановлена, отправляю на сервер...",
        "info",
      );
    }
  }

  startVisualization(stream) {
    try {
      this.audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )();
      this.analyser = this.audioContext.createAnalyser();
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.analyser);
      this.analyser.fftSize = 256;

      const canvas = document.getElementById("visualizer");
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        if (!this.isRecording || !this.analyser) return;

        this.animationFrame = requestAnimationFrame(draw);
        this.analyser.getByteFrequencyData(dataArray);

        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;

        if (canvas.width === 0 || canvas.height === 0) return;

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;

        ctx.fillStyle = "#1f2937";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * canvas.height;
          const gradient = ctx.createLinearGradient(
            0,
            canvas.height,
            0,
            canvas.height - barHeight,
          );
          gradient.addColorStop(0, "#667eea");
          gradient.addColorStop(1, "#764ba2");

          ctx.fillStyle = gradient;
          ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

          x += barWidth + 1;
        }
      };

      draw();
      this.audioContext.resume();
    } catch (error) {
      console.error("Visualization error:", error);
    }
  }

  stopVisualization() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;

    const canvas = document.getElementById("visualizer");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  updateRecordingTime() {
    if (!this.isRecording) return;

    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    const timeElement = document.getElementById("recordingTime");
    if (timeElement) {
      timeElement.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }

    setTimeout(() => this.updateRecordingTime(), 1000);
  }

  async transcribeAudio(audioBlob) {
    const formData = new FormData();
    const language = document.getElementById("languageSelect")?.value || "ru";

    formData.append("audio", audioBlob, "recording.wav");
    formData.append("language", language);

    this.showProgress();
    this.setTranscriptionResult(
      "🎙️ Распознаю аудио... Пожалуйста, подождите",
      "processing",
    );

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        this.setTranscriptionResult(data.text, "success");
        this.addStatusMessage("✅ Транскрипция успешно завершена", "success");
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (error) {
      console.error("Transcription error:", error);
      this.setTranscriptionResult(`❌ Ошибка: ${error.message}`, "error");
      this.addStatusMessage(`Ошибка транскрипции: ${error.message}`, "error");
    } finally {
      this.hideProgress();
    }
  }

  handleFileSelect(event) {
    const file = event.target.files[0];
    const uploadBtn = document.getElementById("uploadBtn");
    const fileInfo = document.getElementById("fileInfo");

    if (file && uploadBtn && fileInfo) {
      uploadBtn.disabled = false;
      fileInfo.innerHTML = `
                📁 Файл: ${file.name}<br>
                📦 Размер: ${(file.size / 1024).toFixed(2)} KB<br>
                🎵 Тип: ${file.type || "audio/*"}
            `;
    } else if (uploadBtn) {
      uploadBtn.disabled = true;
      if (fileInfo) fileInfo.innerHTML = "";
    }
  }

  async uploadFile() {
    const fileInput = document.getElementById("fileInput");
    const file = fileInput?.files[0];
    const language = document.getElementById("languageSelect")?.value || "ru";

    if (!file) {
      this.addStatusMessage("Выберите файл для загрузки", "error");
      return;
    }

    const formData = new FormData();
    formData.append("audio", file);
    formData.append("language", language);

    this.showProgress();
    this.setTranscriptionResult(
      "📤 Загрузка и обработка файла...",
      "processing",
    );

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        this.setTranscriptionResult(data.text, "success");
        this.addStatusMessage("✅ Файл успешно распознан", "success");
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (error) {
      console.error("Upload error:", error);
      this.setTranscriptionResult(`❌ Ошибка: ${error.message}`, "error");
      this.addStatusMessage(
        `Ошибка обработки файла: ${error.message}`,
        "error",
      );
    } finally {
      this.hideProgress();
    }
  }

  setTranscriptionResult(text, type) {
    const resultDiv = document.getElementById("transcriptionResult");
    const copyBtn = document.getElementById("copyBtn");

    if (!resultDiv) return;

    if (type === "processing") {
      resultDiv.innerHTML = `<div class="processing" style="text-align: center; color: #667eea;">${text}</div>`;
      if (copyBtn) copyBtn.disabled = true;
    } else if (type === "success") {
      resultDiv.innerHTML = `<div class="result-text" style="white-space: pre-wrap; word-wrap: break-word;">${this.escapeHtml(text)}</div>`;
      if (copyBtn) copyBtn.disabled = false;
    } else {
      resultDiv.innerHTML = `<div class="error-text" style="text-align: center; color: #ef4444;">${this.escapeHtml(text)}</div>`;
      if (copyBtn) copyBtn.disabled = true;
    }
  }

  copyResult() {
    const resultDiv = document.getElementById("transcriptionResult");
    if (!resultDiv) return;

    const text = resultDiv.innerText;

    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.addStatusMessage("📋 Текст скопирован в буфер обмена", "success");
        const copyBtn = document.getElementById("copyBtn");
        if (copyBtn) {
          const originalText = copyBtn.innerHTML;
          copyBtn.innerHTML = "✓ Скопировано!";
          setTimeout(() => {
            copyBtn.innerHTML = originalText;
          }, 2000);
        }
      })
      .catch((err) => {
        console.error("Copy failed:", err);
        this.addStatusMessage("Не удалось скопировать текст", "error");
      });
  }

  toggleRecordingMethod(method) {
    const micSection = document.getElementById("microphoneSection");
    const fileSection = document.getElementById("fileSection");

    if (method === "microphone") {
      if (micSection) micSection.style.display = "block";
      if (fileSection) fileSection.style.display = "none";
    } else {
      if (micSection) micSection.style.display = "none";
      if (fileSection) fileSection.style.display = "block";
    }
  }

  addStatusMessage(message, type = "info") {
    const container = document.getElementById("statusMessages");
    if (!container) return;

    const messageDiv = document.createElement("div");
    messageDiv.className = `status-message ${type}`;

    const icons = {
      success: "✅",
      error: "❌",
      info: "ℹ️",
    };

    const icon = icons[type] || "ℹ️";
    messageDiv.textContent = `${icon} [${new Date().toLocaleTimeString()}] ${message}`;
    container.appendChild(messageDiv);
    messageDiv.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // Автоочистка через 50 сообщений
    if (container.children.length > 50) {
      container.removeChild(container.children[0]);
    }
  }

  showProgress() {
    const progressBar = document.querySelector(".progress-bar");
    const progressFill = document.querySelector(".progress-fill");

    if (!progressBar || !progressFill) return;

    progressBar.style.display = "block";
    progressFill.style.width = "0%";

    let width = 0;
    const interval = setInterval(() => {
      if (width >= 90) {
        clearInterval(interval);
      } else {
        width += 10;
        progressFill.style.width = width + "%";
      }
    }, 500);

    this.progressInterval = interval;
  }

  hideProgress() {
    const progressBar = document.querySelector(".progress-bar");
    const progressFill = document.querySelector(".progress-fill");

    if (!progressBar || !progressFill) return;

    progressFill.style.width = "100%";
    setTimeout(() => {
      progressBar.style.display = "none";
      if (progressFill) progressFill.style.width = "0%";
    }, 500);

    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}



// Инициализация при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
  window.client = new WhisperClient();
});
