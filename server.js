const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// ПУТИ - всё внутри папки whisper
//const WHISPER_DIR = path.join(__dirname, 'whisper');
const WHISPER_DIR = path.join(__dirname, 'whisper150');
const UPLOADS_DIR = path.join(WHISPER_DIR, 'uploads');
const MODELS_DIR = path.join(WHISPER_DIR, 'models');

// Создаем папки если их нет
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log(`📁 Created uploads directory: ${UPLOADS_DIR}`);
}

// Настройка multer - сохраняем файлы в whisper/uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        // Сохраняем как .wav для совместимости с whisper
        cb(null, `${timestamp}-${random}.wav`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        // Принимаем аудио файлы
        if (file.mimetype.startsWith('audio/') || file.originalname.match(/\.(wav|mp3|m4a|webm)$/i)) {
            cb(null, true);
        } else {
            cb(new Error('Only audio files are allowed'));
        }
    }
});

// Конфигурация whisper - теперь все пути внутри папки whisper
const WHISPER_CONFIG = {
    // Рабочая директория - папка whisper
    cwd: WHISPER_DIR,
    // Путь к executable относительно рабочей директории
    executable: 'main.exe', //'whisper-cli.exe',
    // Путь к модели относительно рабочей директории
    model: path.join('models', 'ggml-small-q8_0.bin'), //ggml-large-v3-q5_0.bin
    language: 'ru',
    threads: 4
};

// WebSocket
const clients = new Set();

wss.on('connection', (ws) => {
    console.log('New WebSocket client connected');
    clients.add(ws);
    
    ws.on('close', () => {
        clients.delete(ws);
        console.log('Client disconnected');
    });
});

function broadcastStatus(status, data = null) {
    const message = JSON.stringify({ type: 'status', status, data });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}


// Функция транскрипции (ИСПРАВЛЕННАЯ)
async function transcribeAudio(audioFilename, language = 'ru') {
    return new Promise((resolve, reject) => {
        const audioPath = path.join('uploads', audioFilename);
        const fullAudioPath = path.join(WHISPER_DIR, audioPath);
        
        if (!fs.existsSync(fullAudioPath)) {
            reject(new Error(`Audio file not found: ${fullAudioPath}`));
            return;
        }
        
        const stats = fs.statSync(fullAudioPath);
        if (stats.size < 1000) {
            reject(new Error(`Audio file too small (${stats.size} bytes)`));
            return;
        }
        
        const args = [
            '-m', WHISPER_CONFIG.model,
            '-f', audioPath,
            '-l', language,
            '-t', WHISPER_CONFIG.threads.toString(),
            '--no-timestamps'
        ];
        
        console.log(`\n🚀 Executing whisper:`);
        console.log(`   Command: ${WHISPER_CONFIG.executable} ${args.join(' ')}`);
        
        let transcribedText = '';
        let stderr = '';
        
        const whisperProcess = spawn(WHISPER_CONFIG.executable, args, {
            cwd: WHISPER_CONFIG.cwd,
            shell: true
        });
        
        // ПРОСТОЙ ПАРСИНГ - берем всё, что не является служебной информацией
        whisperProcess.stdout.on('data', (data) => {
            const chunk = data.toString();
            console.log('STDOUT chunk:', chunk);
            
            // Разбиваем на строки и собираем текст
            const lines = chunk.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                
                // Пропускаем только явно служебные строки
                if (trimmed.includes('-->') || 
                    trimmed.startsWith('whisper_') ||
                    trimmed.startsWith('main:') ||
                    trimmed.startsWith('system_info') ||
                    trimmed.match(/^\[?\d{2}:\d{2}:\d{2}/)) {
                    continue;
                }
                
                // Убираем возможные таймкоды в начале
                let cleanLine = trimmed;
                cleanLine = cleanLine.replace(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/, '');
                cleanLine = cleanLine.replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\s*/, '');
                
                if (cleanLine && cleanLine.length > 0) {
                    transcribedText += (transcribedText ? ' ' : '') + cleanLine;
                    console.log(`   📝 Captured: "${cleanLine}"`);
                }
            }
        });
        
        whisperProcess.stderr.on('data', (data) => {
            const chunk = data.toString();
            stderr += chunk;
            // Логируем только важные ошибки, не засоряем лог загрузкой модели
            if (!chunk.includes('Loading') && 
                !chunk.includes('system_info') &&
                !chunk.includes('whisper_model_load') &&
                !chunk.includes('whisper_init')) {
                console.log('STDERR:', chunk.substring(0, 200));
            }
        });
        
        whisperProcess.on('close', (code) => {
            console.log(`Whisper process exited with code ${code}`);
            console.log(`📝 Final transcribed text: "${transcribedText}"`);
            
            // Удаляем временный файл
            try {
                if (fs.existsSync(fullAudioPath)) {
                    fs.unlinkSync(fullAudioPath);
                    console.log(`🗑️ Deleted temp file: ${audioFilename}`);
                }
            } catch (err) {
                console.error('Error deleting temp file:', err);
            }
            
            if (code !== 0) {
                let errorMsg = `Whisper failed with code ${code}`;
                if (stderr) {
                    if (stderr.includes('not found')) {
                        errorMsg = 'Model file not found';
                    } else if (stderr.includes('cannot open')) {
                        errorMsg = 'Cannot open audio file';
                    } else {
                        errorMsg += `: ${stderr.substring(0, 200)}`;
                    }
                }
                reject(new Error(errorMsg));
                return;
            }
            
            if (!transcribedText.trim()) {
                reject(new Error('No transcription result. Audio might be too short or silent.'));
                return;
            }
            
            resolve(transcribedText.trim());
        });
        
        whisperProcess.on('error', (error) => {
            console.error('Process error:', error);
            try {
                if (fs.existsSync(fullAudioPath)) {
                    fs.unlinkSync(fullAudioPath);
                }
            } catch (err) {}
            reject(new Error(`Failed to start whisper: ${error.message}`));
        });
        
        // Таймаут 60 секунд
        const timeout = setTimeout(() => {
            if (!whisperProcess.killed) {
                whisperProcess.kill();
                reject(new Error('Whisper process timeout (60 seconds)'));
            }
        }, 60000);
        
        whisperProcess.on('close', () => {
            clearTimeout(timeout);
        });
    });
}

// API эндпоинты

// Проверка статуса
app.get('/api/status', (req, res) => {
    const modelPath = path.join(WHISPER_DIR, WHISPER_CONFIG.model);
    const executablePath = path.join(WHISPER_DIR, WHISPER_CONFIG.executable);
    const modelExists = fs.existsSync(modelPath);
    const executableExists = fs.existsSync(executablePath);
    
    res.json({
        status: 'running',
        modelLoaded: modelExists,
        executableExists: executableExists,
        config: {
            model: WHISPER_CONFIG.model,
            executable: WHISPER_CONFIG.executable,
            language: WHISPER_CONFIG.language,
            threads: WHISPER_CONFIG.threads,
            workingDirectory: WHISPER_DIR
        }
    });
});

// Транскрипция
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    let audioFilename = null;
    
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file uploaded' });
        }
        
        audioFilename = req.file.filename;
        const language = req.body.language || WHISPER_CONFIG.language;
        
        console.log(`\n📥 Received audio file:`);
        console.log(`   Filename: ${audioFilename}`);
        console.log(`   Size: ${(req.file.size / 1024).toFixed(2)} KB`);
        console.log(`   Language: ${language}`);
        
        broadcastStatus('processing', { message: `Обработка аудио...` });
        
        const transcribedText = await transcribeAudio(audioFilename, language);
        
        console.log(`✅ Transcription complete: ${transcribedText.substring(0, 100)}...`);
        
        res.json({
            success: true,
            text: transcribedText,
            language: language,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Transcription error:', error.message);
        
        // Удаляем файл если он ещё существует
        if (audioFilename) {
            const fullPath = path.join(UPLOADS_DIR, audioFilename);
            if (fs.existsSync(fullPath)) {
                try {
                    fs.unlinkSync(fullPath);
                    console.log(`🗑️ Cleaned up file: ${audioFilename}`);
                } catch (err) {}
            }
        }
        
        res.status(500).json({ 
            error: 'Transcription failed', 
            details: error.message 
        });
    }
});

// Получение списка языков
app.get('/api/languages', (req, res) => {
    const languages = {
        'ru': 'Русский',
        'en': 'English',
        'de': 'Deutsch',
        'fr': 'Français',
        'es': 'Español',
        'it': 'Italiano',
        'pt': 'Português',
        'nl': 'Nederlands',
        'pl': 'Polski',
        'uk': 'Українська',
        'zh': '中文',
        'ja': '日本語',
        'ko': '한국어'
    };
    res.json(languages);
});

// Очистка старых файлов
app.post('/api/cleanup', (req, res) => {
    if (fs.existsSync(UPLOADS_DIR)) {
        const files = fs.readdirSync(UPLOADS_DIR);
        let deleted = 0;
        const now = Date.now();
        
        for (const file of files) {
            const filePath = path.join(UPLOADS_DIR, file);
            const stats = fs.statSync(filePath);
            // Удаляем файлы старше 1 часа
            if (now - stats.mtimeMs > 3600000) {
                try {
                    fs.unlinkSync(filePath);
                    deleted++;
                } catch (err) {}
            }
        }
        
        res.json({ message: `Cleaned up ${deleted} old files` });
    } else {
        res.json({ message: 'Upload directory not found' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Порт
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🎙️  WHISPER SERVER STARTED');
    console.log('='.repeat(60));
    console.log(`\n🌐 Server URL: http://localhost:${PORT}`);
    console.log(`\n📁 Directories:`);
    console.log(`   Whisper dir: ${WHISPER_DIR}`);
    console.log(`   Uploads dir: ${UPLOADS_DIR}`);
    console.log(`   Models dir:  ${MODELS_DIR}`);
    
    console.log(`\n📁 Configuration:`);
    console.log(`   Executable: ${WHISPER_CONFIG.executable}`);
    console.log(`   Model: ${WHISPER_CONFIG.model}`);
    console.log(`   Language: ${WHISPER_CONFIG.language}`);
    console.log(`   Threads: ${WHISPER_CONFIG.threads}`);
    
    console.log(`\n✅ Status:`);
    
    const executablePath = path.join(WHISPER_DIR, WHISPER_CONFIG.executable);
    if (!fs.existsSync(executablePath)) {
        console.log(`   ❌ whisper-cli.exe NOT FOUND`);
        console.log(`   📁 Expected at: ${executablePath}`);
    } else {
        console.log(`   ✓ whisper-cli.exe found`);
    }
    
    const modelPath = path.join(WHISPER_DIR, WHISPER_CONFIG.model);
    if (!fs.existsSync(modelPath)) {
        console.log(`   ❌ Model NOT FOUND`);
        console.log(`   📁 Expected at: ${modelPath}`);
    } else {
        const stats = fs.statSync(modelPath);
        console.log(`   ✓ Model found (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    }
    
    console.log(`\n💡 Ready for transcription!`);
    console.log(`   Audio files are automatically deleted after processing`);
    console.log(`\n📝 To test manually:`);
    console.log(`   cd ${WHISPER_DIR}`);
    console.log(`   ${WHISPER_CONFIG.executable} -m ${WHISPER_CONFIG.model} -f uploads/test.wav -l ru --no-timestamps`);
    console.log('\n' + '='.repeat(60) + '\n');
});