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
    this.progressInterval = null;
    this.recordingTimer = null;
    this.currentProcessingPart = null;
    this.totalParts = null;
    this.liveTextParts = [];
    this.availableModels = [];

    this.init();
  }

  async init() {
    this.bindEvents();
    this.initQualityPreset();
    await this.loadModels();
    await this.checkServerStatus();
    this.initWebSocket();
    this.loadLanguages();
    this.checkMicrophoneSupport();
  }

  // ============================================================
  // Модели
  // ============================================================
  async loadModels() {
    try {
      const response = await fetch("/api/models");
      const data = await response.json();
      this.availableModels = data.models || [];

      const select = document.getElementById("modelSelect");
      if (!select) return;

      select.innerHTML = "";

      for (const model of this.availableModels) {
        const option = document.createElement("option");
        option.value = model.key;
        option.textContent = `${model.speed} ${model.name.replace(".bin", "")} (${model.sizeMB} MB)`;
        if (!model.exists) {
          option.disabled = true;
          option.textContent += " — не найдена";
        }
        if (model.key === data.default) {
          option.selected = true;
        }
        select.appendChild(option);
      }

      // Восстанавливаем из localStorage
      const saved = localStorage.getItem("selectedModel");
      if (saved) {
        const opt = select.querySelector(
          `option[value="${saved}"]:not(:disabled)`,
        );
        if (opt) select.value = saved;
      }

      this.updateModelInfo();

      select.addEventListener("change", () => {
        this.updateModelInfo();
        localStorage.setItem("selectedModel", select.value);
      });
    } catch (error) {
      console.error("Failed to load models:", error);
    }
  }

  updateModelInfo() {
    const select = document.getElementById("modelSelect");
    const info = document.getElementById("modelInfo");
    if (!select || !info) return;

    const selectedKey = select.value;
    const model = this.availableModels.find((m) => m.key === selectedKey);
    if (model) {
      info.innerHTML = `Качество: <strong>${model.quality}</strong> | Скорость: ${model.speed} | Размер: ${model.sizeMB} MB`;
    }
  }

  getSelectedModel() {
    const select = document.getElementById("modelSelect");
    return select?.value || "small";
  }

  // ============================================================
  // Пресеты качества
  // ============================================================
  initQualityPreset() {
    const presetSelect = document.getElementById("qualityPreset");
    if (!presetSelect) return;

    const saved = localStorage.getItem("qualityPreset") || "balanced";
    presetSelect.value = saved;
    this.applyPreset(saved);

    presetSelect.addEventListener("change", (e) => {
      localStorage.setItem("qualityPreset", e.target.value);
      this.applyPreset(e.target.value);
    });

    [
      "antiHallucination",
      "trimSilence",
      "cleanRepeats",
      "temperatureSelect",
      "beamSizeSelect",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("change", () => {
          presetSelect.value = "custom";
        });
      }
    });
  }

  applyPreset(preset) {
    const antiHallucination = document.getElementById("antiHallucination");
    const trimSilence = document.getElementById("trimSilence");
    const cleanRepeats = document.getElementById("cleanRepeats");
    const temperature = document.getElementById("temperatureSelect");
    const beamSize = document.getElementById("beamSizeSelect");

    switch (preset) {
      case "fast":
        if (antiHallucination) antiHallucination.checked = false;
        if (trimSilence) trimSilence.checked = false;
        if (cleanRepeats) cleanRepeats.checked = false;
        if (temperature) temperature.value = "0";
        if (beamSize) beamSize.value = "1";
        break;
      case "balanced":
        if (antiHallucination) antiHallucination.checked = true;
        if (trimSilence) trimSilence.checked = true;
        if (cleanRepeats) cleanRepeats.checked = true;
        if (temperature) temperature.value = "0";
        if (beamSize) beamSize.value = "5";
        break;
      case "accurate":
        if (antiHallucination) antiHallucination.checked = true;
        if (trimSilence) trimSilence.checked = true;
        if (cleanRepeats) cleanRepeats.checked = true;
        if (temperature) temperature.value = "0";
        if (beamSize) beamSize.value = "8";
        break;
      case "paranoid":
        if (antiHallucination) antiHallucination.checked = true;
        if (trimSilence) trimSilence.checked = true;
        if (cleanRepeats) cleanRepeats.checked = true;
        if (temperature) temperature.value = "0";
        if (beamSize) beamSize.value = "8";
        break;
    }
  }

  getQualityOptions() {
    const preset =
      document.getElementById("qualityPreset")?.value || "balanced";

    if (preset !== "custom") {
      switch (preset) {
        case "fast":
          return {
            antiHallucination: false,
            trimSilence: false,
            cleanRepeats: false,
            temperature: 0,
            beamSize: 1,
          };
        case "balanced":
          return {
            antiHallucination: true,
            trimSilence: true,
            cleanRepeats: true,
            temperature: 0,
            beamSize: 5,
          };
        case "accurate":
          return {
            antiHallucination: true,
            trimSilence: true,
            cleanRepeats: true,
            temperature: 0,
            beamSize: 8,
          };
        case "paranoid":
          return {
            antiHallucination: true,
            trimSilence: true,
            cleanRepeats: true,
            temperature: 0,
            beamSize: 8,
          };
      }
    }

    return {
      antiHallucination:
        document.getElementById("antiHallucination")?.checked || false,
      trimSilence: document.getElementById("trimSilence")?.checked || false,
      cleanRepeats: document.getElementById("cleanRepeats")?.checked || false,
      temperature: parseFloat(
        document.getElementById("temperatureSelect")?.value || "0",
      ),
      beamSize: parseInt(
        document.getElementById("beamSizeSelect")?.value || "5",
      ),
    };
  }

  appendQualityOptions(formData) {
    const opts = this.getQualityOptions();
    formData.append("antiHallucination", opts.antiHallucination ? "1" : "0");
    formData.append("trimSilence", opts.trimSilence ? "1" : "0");
    formData.append("cleanRepeats", opts.cleanRepeats ? "1" : "0");
    formData.append("temperature", opts.temperature);
    formData.append("beamSize", opts.beamSize);

    // Модель
    formData.append("model", this.getSelectedModel());

    console.log("Quality options:", opts, "Model:", this.getSelectedModel());
  }

  // ============================================================
  // События
  // ============================================================
  bindEvents() {
    const recordBtn = document.getElementById("recordBtn");
    const stopBtn = document.getElementById("stopBtn");

    if (recordBtn)
      recordBtn.addEventListener("click", () => this.startRecording());
    if (stopBtn) stopBtn.addEventListener("click", () => this.stopRecording());

    const fileInput = document.getElementById("fileInput");
    const uploadBtn = document.getElementById("uploadBtn");

    if (fileInput)
      fileInput.addEventListener("change", (e) => this.handleFileSelect(e));
    if (uploadBtn) uploadBtn.addEventListener("click", () => this.uploadFile());

    const copyBtn = document.getElementById("copyBtn");
    if (copyBtn) copyBtn.addEventListener("click", () => this.copyResult());

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

        // Показываем, какие модели доступны
        if (data.models) {
          const available = Object.entries(data.models)
            .filter(([_, exists]) => exists)
            .map(([key]) => key);
          if (available.length > 0) {
            this.addStatusMessage(
              `🤖 Доступные модели: ${available.join(", ")}`,
              "info",
            );
          }
        }

        if (data.config && data.config.splitThresholdMB) {
          this.addStatusMessage(
            `✂️ Нарезка: файлы > ${data.config.splitThresholdMB} MB на части по ${data.config.segmentTimeSec / 60} мин`,
            "info",
          );
        }
      } else if (!data.modelLoaded) {
        if (statusText)
          statusText.textContent = "⚠️ Модель не найдена на сервере";
        if (indicator) indicator.style.background = "#f59e0b";
        this.addStatusMessage(
          "Модель не найдена. Проверьте папку whisper/models/",
          "error",
        );
      } else if (!data.executableExists) {
        if (statusText) statusText.textContent = "⚠️ main.exe не найден";
        if (indicator) indicator.style.background = "#ef4444";
        this.addStatusMessage("main.exe не найден в папке whisper/", "error");
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

          if (data.type === "connected") {
            this.addStatusMessage(data.message, "success");
            return;
          }

          if (data.type === "status") {
            const message = data.data?.message || data.status;

            if (data.status === "processing") {
              this.addStatusMessage(message, "info");
              this.showProgress();
              this.resetLiveResult();
              this.showLiveResult();
              return;
            }

            if (data.status === "split") {
              this.totalParts = data.data?.totalParts || null;
              this.addStatusMessage(
                `✂️ Файл разбит на ${this.totalParts} частей`,
                "info",
              );
              this.showLiveResult();
              return;
            }

            if (data.status === "part_start") {
              this.currentProcessingPart = data.data?.currentPart || null;
              this.totalParts = data.data?.totalParts || this.totalParts;
              const startStr = data.data?.startTimeFormatted || "";
              const endStr = data.data?.endTimeFormatted || "";
              const label =
                startStr && endStr ? ` (${startStr} – ${endStr})` : "";
              this.addStatusMessage(
                `Обработка части ${this.currentProcessingPart}/${this.totalParts}${label}...`,
                "info",
              );
              this.updateProgressForParts();
              this.showLiveResult();
              return;
            }

            if (data.status === "part_result") {
              const partText = data.data?.text || "";
              const currentPart = data.data?.currentPart || null;
              const totalParts = data.data?.totalParts || this.totalParts;
              const startTime = data.data?.startTime;
              const endTime = data.data?.endTime;
              const startStr = data.data?.startTimeFormatted || "";
              const endStr = data.data?.endTimeFormatted || "";

              if (partText) {
                this.appendLiveResult(
                  partText,
                  currentPart,
                  totalParts,
                  startTime,
                  endTime,
                );
                this.addStatusMessage(
                  `✅ Часть ${currentPart}/${totalParts} (${startStr} – ${endStr}) распознана (${partText.length} симв.)`,
                  "success",
                );
              } else {
                this.addStatusMessage(
                  `⚠️ Часть ${currentPart}/${totalParts} (${startStr} – ${endStr}) пуста`,
                  "info",
                );
              }

              this.updateProgressForParts();
              return;
            }

            if (data.status === "part_error") {
              this.addStatusMessage(message, "error");
              return;
            }

            this.addStatusMessage(message, "info");
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

  async loadTestFiles() {
    try {
      const response = await fetch("/api/test-files");
      const data = await response.json();

      const fileListDiv = document.getElementById("testFileList");
      if (!fileListDiv) return;

      if (!data.files || data.files.length === 0) {
        fileListDiv.innerHTML =
          '<p style="color: #999;">📁 Нет тестовых файлов в папке example/</p>';
        return;
      }

      fileListDiv.innerHTML = "";

      for (const file of data.files) {
        const fileItem = document.createElement("div");
        fileItem.className = "test-file-item";
        fileItem.innerHTML = `
          <div class="test-file-info">
            <span class="test-file-name">🎵 ${file.name}</span>
            <span class="test-file-size">(${(file.size / 1024).toFixed(2)} KB)</span>
          </div>
          <div class="test-file-controls">
            <button class="btn-test-play" data-file="${file.path}">▶️</button>
            <button class="btn-test-transcribe" data-file="${file.name}" data-path="${file.path}">🎯 Распознать</button>
          </div>
        `;

        const playBtn = fileItem.querySelector(".btn-test-play");
        const transcribeBtn = fileItem.querySelector(".btn-test-transcribe");

        playBtn.addEventListener("click", () => this.playTestFile(file.path));
        transcribeBtn.addEventListener("click", () =>
          this.transcribeTestFile(file.name, file.path),
        );

        fileListDiv.appendChild(fileItem);
      }
    } catch (error) {
      console.error("Error loading test files:", error);
      const fileListDiv = document.getElementById("testFileList");
      if (fileListDiv) {
        fileListDiv.innerHTML =
          '<p style="color: #ef4444;">❌ Ошибка загрузки списка файлов</p>';
      }
    }
  }

  playTestFile(filePath) {
    const audioPlayer = document.getElementById("testAudioPlayer");
    const audioElement = document.getElementById("testAudio");

    if (!audioPlayer || !audioElement) return;

    audioElement.src = filePath;
    audioElement.load();
    audioPlayer.style.display = "block";

    audioElement.play().catch((err) => {
      console.warn("Auto-play prevented:", err);
      this.addStatusMessage("Нажмите Play для воспроизведения", "info");
    });

    this.addStatusMessage(
      `▶️ Воспроизведение: ${filePath.split("/").pop()}`,
      "info",
    );
  }

  async transcribeTestFile(fileName, filePath) {
    this.addStatusMessage(
      `📤 Отправка файла ${fileName} на транскрипцию...`,
      "info",
    );

    try {
      const response = await fetch(filePath);
      const blob = await response.blob();

      const formData = new FormData();
      const language = document.getElementById("languageSelect")?.value || "ru";

      formData.append("audio", blob, fileName);
      formData.append("language", language);
      this.appendQualityOptions(formData);

      this.resetProgressState();
      this.resetLiveResult();
      this.showProgress();
      this.showLiveResult();

      const transcribeResponse = await this.fetchWithTimeout(
        "/api/transcribe",
        { method: "POST", body: formData },
        60 * 60 * 1000,
      );

      const data = await transcribeResponse.json();

      if (data.success) {
        this.setTranscriptionResult(data.text, "success");
        this.addStatusMessage(
          `✅ Файл "${fileName}" успешно распознан (модель: ${data.model || "?"})`,
          "success",
        );
      } else {
        throw new Error(data.error || data.details || "Unknown error");
      }
    } catch (error) {
      console.error("Test file transcription error:", error);
      this.setTranscriptionResult(`❌ Ошибка: ${error.message}`, "error");
      this.addStatusMessage(`Ошибка распознавания: ${error.message}`, "error");
    } finally {
      this.hideProgress();
    }
  }

  async startRecording() {
    if (!this.checkMicrophoneSupport()) return;

    try {
      this.addStatusMessage("Запрос доступа к микрофону...", "info");

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          sampleSize: 16,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.audioChunks = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/wav")
        ? "audio/wav"
        : "audio/webm";
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const mimeType = this.mediaRecorder.mimeType;
        let audioBlob;

        if (mimeType === "audio/wav") {
          audioBlob = new Blob(this.audioChunks, { type: "audio/wav" });
        } else {
          audioBlob = new Blob(this.audioChunks, { type: "audio/webm" });
        }

        await this.transcribeAudio(audioBlob);

        if (this.stream) {
          this.stream.getTracks().forEach((track) => track.stop());
          this.stream = null;
        }
      };

      this.mediaRecorder.start(1000);
      this.isRecording = true;
      this.startTime = Date.now();

      const recordBtn = document.getElementById("recordBtn");
      const stopBtn = document.getElementById("stopBtn");

      if (recordBtn) recordBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;

      this.startVisualization(this.stream);
      this.updateRecordingTime();

      this.addStatusMessage(
        "🎤 Запись началась (16kHz, 16bit)... Говорите четко",
        "success",
      );
    } catch (error) {
      console.error("Error starting recording:", error);

      let errorMessage = "Ошибка доступа к микрофону: ";
      if (error.name === "NotAllowedError") {
        errorMessage += "Пользователь запретил доступ к микрофону";
      } else if (error.name === "NotFoundError") {
        errorMessage += "Микрофон не найден";
      } else if (error.name === "NotReadableError") {
        errorMessage += "Микрофон занят другим приложением";
      } else if (error.name === "OverconstrainedError") {
        errorMessage +=
          "Микрофон не поддерживает требуемые параметры (16kHz, 16bit)";
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

    this.recordingTimer = setTimeout(() => this.updateRecordingTime(), 1000);
  }

  async transcribeAudio(audioBlob) {
    const formData = new FormData();
    const language = document.getElementById("languageSelect")?.value || "ru";

    formData.append("audio", audioBlob, "recording.wav");
    formData.append("language", language);
    this.appendQualityOptions(formData);

    this.resetProgressState();
    this.resetLiveResult();
    this.showProgress();
    this.showLiveResult();

    try {
      const response = await this.fetchWithTimeout(
        "/api/transcribe",
        { method: "POST", body: formData },
        60 * 60 * 1000,
      );

      const data = await response.json();

      if (data.success) {
        this.setTranscriptionResult(data.text, "success");
        this.addStatusMessage(
          `✅ Транскрипция успешно завершена (модель: ${data.model || "?"})`,
          "success",
        );
      } else {
        throw new Error(data.error || data.details || "Unknown error");
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

    if (!file) {
      if (uploadBtn) uploadBtn.disabled = true;
      if (fileInfo) fileInfo.innerHTML = "";
      return;
    }

    const MAX_SIZE = 500 * 1024 * 1024;
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);

    let warning = "";
    if (file.size > MAX_SIZE) {
      warning = `<br><span style="color: #ef4444;">⚠️ Файл слишком большой (макс. 500 MB)</span>`;
      if (uploadBtn) uploadBtn.disabled = true;
    } else if (file.size > 20 * 1024 * 1024) {
      warning = `<br><span style="color: #f59e0b;">ℹ️ Большой файл — будет обработан по частям (может занять время)</span>`;
      if (uploadBtn) uploadBtn.disabled = false;
    } else {
      if (uploadBtn) uploadBtn.disabled = false;
    }

    if (fileInfo) {
      fileInfo.innerHTML = `
        📁 Файл: ${file.name}<br>
        📦 Размер: ${sizeMB} MB<br>
        🎵 Тип: ${file.type || "audio/*"}
        ${warning}
      `;
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
    this.appendQualityOptions(formData);

    this.resetProgressState();
    this.resetLiveResult();
    this.showProgress();
    this.showLiveResult();

    try {
      const response = await this.fetchWithTimeout(
        "/api/transcribe",
        { method: "POST", body: formData },
        60 * 60 * 1000,
      );

      const data = await response.json();

      if (data.success) {
        this.setTranscriptionResult(data.text, "success");
        this.addStatusMessage(
          `✅ Файл успешно распознан (модель: ${data.model || "?"})`,
          "success",
        );
      } else {
        throw new Error(data.error || data.details || "Unknown error");
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

  async fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(
          `Превышено время ожидания (${Math.round(timeoutMs / 60000)} мин)`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  setTranscriptionResult(text, type) {
    const resultDiv = document.getElementById("transcriptionResult");
    const copyBtn = document.getElementById("copyBtn");

    if (!resultDiv) return;

    if (type === "processing") {
      if (document.getElementById("liveResult")) return;
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

  resetLiveResult() {
    const resultDiv = document.getElementById("transcriptionResult");
    if (!resultDiv) return;

    resultDiv.innerHTML = `
      <div id="liveResult" class="live-result">
        <div class="live-header">
          <span id="liveHeaderText">Ожидание результата...</span>
        </div>
        <div id="liveText" class="live-text"></div>
      </div>
    `;
    this.liveTextParts = [];
  }

  showLiveResult() {
    const resultDiv = document.getElementById("transcriptionResult");
    if (!resultDiv) return;

    if (!document.getElementById("liveResult")) {
      this.resetLiveResult();
    }
  }

  appendLiveResult(text, currentPart, totalParts, startTime, endTime) {
    const container = document.getElementById("liveText");
    const liveHeader = document.getElementById("liveHeaderText");

    if (!container) {
      this.showLiveResult();
    }

    const container2 = document.getElementById("liveText");
    if (!container2) return;

    let timeLabel = "";
    if (startTime !== undefined && endTime !== undefined) {
      const startStr = this.formatTime(startTime);
      const endStr = this.formatTime(endTime);
      timeLabel = `<span class="live-part-time">⏱ ${startStr} – ${endStr}</span>`;
    }

    const partDiv = document.createElement("div");
    partDiv.className = "live-part";
    partDiv.innerHTML = `
      <div class="live-part-header">
        <span class="live-part-label">Часть ${currentPart}/${totalParts}</span>
        ${timeLabel}
      </div>
      <div class="live-part-text">${this.escapeHtml(text)}</div>
    `;
    container2.appendChild(partDiv);

    container2.scrollTop = container2.scrollHeight;

    if (liveHeader) {
      liveHeader.textContent = `Распознано ${currentPart} из ${totalParts} частей`;
    }

    if (!this.liveTextParts) this.liveTextParts = [];
    this.liveTextParts.push({ text, startTime, endTime });
  }

  formatTime(seconds) {
    if (seconds === undefined || seconds === null) return "??:??";
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
    const testSection = document.getElementById("testSection");

    if (method === "microphone") {
      if (micSection) micSection.style.display = "block";
      if (fileSection) fileSection.style.display = "none";
      if (testSection) testSection.style.display = "none";
    } else if (method === "file") {
      if (micSection) micSection.style.display = "none";
      if (fileSection) fileSection.style.display = "block";
      if (testSection) testSection.style.display = "none";
    } else if (method === "test") {
      if (micSection) micSection.style.display = "none";
      if (fileSection) fileSection.style.display = "none";
      if (testSection) testSection.style.display = "block";

      if (testSection && !testSection.hasAttribute("data-loaded")) {
        this.loadTestFiles();
        testSection.setAttribute("data-loaded", "true");
      }
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

    if (container.children.length > 50) {
      container.removeChild(container.children[0]);
    }
  }

  resetProgressState() {
    this.currentProcessingPart = null;
    this.totalParts = null;

    const progressBar = document.querySelector(".progress-bar");
    const progressFill = document.querySelector(".progress-fill");

    if (progressBar) progressBar.style.display = "none";
    if (progressFill) progressFill.style.width = "0%";

    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  showProgress() {
    const progressBar = document.querySelector(".progress-bar");
    const progressFill = document.querySelector(".progress-fill");

    if (!progressBar || !progressFill) return;

    progressBar.style.display = "block";
    progressFill.style.width = "0%";

    let width = 0;
    this.progressInterval = setInterval(() => {
      if (this.totalParts && this.currentProcessingPart) {
        this.updateProgressForParts();
        return;
      }

      if (width < 30) {
        width += 2;
        progressFill.style.width = width + "%";
      }
    }, 1000);
  }

  updateProgressForParts() {
    const progressFill = document.querySelector(".progress-fill");
    if (!progressFill || !this.totalParts) return;

    const basePercent = 30;
    const partPercent =
      ((this.currentProcessingPart || 0) / this.totalParts) *
      (100 - basePercent);
    const totalPercent = basePercent + partPercent;

    progressFill.style.width = Math.min(totalPercent, 99) + "%";
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
      this.progressInterval = null;
    }

    this.currentProcessingPart = null;
    this.totalParts = null;
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.client = new WhisperClient();
});
