```markdown
# 🎙️ Whisper Server - Сервер распознавания речи

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()

Сервер для транскрипции аудио с использованием моделей Whisper. Поддерживает запись через микрофон в браузере, загрузку файлов и прослушивание тестовых аудиофайлов.

## 📋 Содержание

- [Возможности](#-возможности)
- [Требования](#-требования)
- [Быстрый старт](#-быстрый-старт)
- [Установка](#-установка)
  - [1. Установка Node.js зависимостей](#1-установка-nodejs-зависимостей)
  - [2. Установка FFmpeg](#2-установка-ffmpeg)
  - [3. Установка Whisper CLI](#3-установка-whisper-cli)
  - [4. Загрузка модели Whisper](#4-загрузка-модели-whisper)
  - [5. Создание SSL сертификатов](#5-создание-ssl-сертификатов)
- [Настройка](#-настройка)
- [Запуск](#-запуск)
- [API Документация](#-api-документация)
- [WebSocket События](#-websocket-события)
- [Клиентское приложение](#-клиентское-приложение)
- [HTTPS Настройка](#-https-настройка)
- [Устранение проблем](#-устранение-проблем)
- [Производительность](#-производительность)
- [Лицензия](#-лицензия)

## ✨ Возможности

- 🎤 **Запись с микрофона** - прямая запись аудио в браузере с визуализацией
- 📁 **Тестовые файлы** - выбор из предустановленных аудиофайлов с возможностью прослушивания
- 📤 **Загрузка файлов** - поддержка форматов WAV, MP3, M4A, WebM, OGG
- 🔄 **Автоматическая конвертация** - преобразование аудио в 16kHz/16bit mono WAV через FFmpeg
- 🌐 **Мультиязычность** - поддержка 13 языков (русский, английский, немецкий и др.)
- 📡 **WebSocket уведомления** - статус обработки аудио в реальном времени
- 🗑️ **Автоочистка** - автоматическое удаление временных файлов
- 🔒 **HTTPS поддержка** - работа с микрофоном через защищенное соединение
- 🎨 **Современный UI** - адаптивный дизайн с визуализатором звука

## 📦 Требования

- **Node.js** 14.x или выше
- **FFmpeg** (для конвертации аудио)
- **Whisper CLI** (main.exe или whisper-cli.exe)
- **Модель Whisper** (ggml-*.bin)
- **Микрофон** (для записи)
- **SSL сертификаты** (для HTTPS)

## 🚀 Быстрый старт

```bash
# Клонирование репозитория
git clone https://github.com/yourusername/whisper-server.git
cd whisper-server

# Установка зависимостей
npm install

# Установка FFmpeg (Windows)
choco install ffmpeg

# Запуск сервера
npm start

# Открыть в браузере
# https://localhost:3000
```

## 📥 Установка

### 1. Установка Node.js зависимостей

```bash
npm install express multer cors ws
npm install -D nodemon
```

### 2. Установка FFmpeg

FFmpeg необходим для конвертации аудио из формата WebM (который отправляет браузер) в WAV (который понимает Whisper).

**Windows:**

*Способ 1: Через Chocolatey (рекомендуется)*

```powershell
# Запустите PowerShell от имени администратора
choco install ffmpeg
```

*Способ 2: Ручная установка*

1. Скачайте FFmpeg с официального сайта: https://www.gyan.dev/ffmpeg/builds/
2. Выберите "ffmpeg-release-full.7z"
3. Распакуйте архив в `C:\ffmpeg`
4. Добавьте `C:\ffmpeg\bin` в системную переменную PATH:
   - Правый клик на "Мой компьютер" → Свойства
   - Дополнительные параметры системы → Переменные среды
   - В разделе "Системные переменные" найдите "Path"
   - Добавьте `C:\ffmpeg\bin`
   - Нажмите "ОК" и перезапустите терминал

*Способ 3: Автоматическая установка (PowerShell администратор)*

```powershell
# Скачивание и установка FFmpeg
$ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.7z"
$outputPath = "$env:TEMP\ffmpeg.7z"
Invoke-WebRequest -Uri $ffmpegUrl -OutFile $outputPath

# Распаковка (требуется 7-Zip)
& "C:\Program Files\7-Zip\7z.exe" x $outputPath -oC:\

# Переименование
Rename-Item -Path "C:\ffmpeg-*" -NewName "ffmpeg" -Force

# Добавление в PATH
$env:Path += ";C:\ffmpeg\bin"
[Environment]::SetEnvironmentVariable("Path", $env:Path, [EnvironmentVariableTarget]::Machine)

Write-Host "FFmpeg установлен!" -ForegroundColor Green
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**macOS:**

```bash
brew install ffmpeg
```

**Проверка установки FFmpeg:**

```bash
ffmpeg -version
```

### 3. Установка Whisper CLI

Whisper CLI - это исполняемый файл для распознавания речи.

**Windows:**

1. Скачайте последнюю версию whisper.cpp с официального репозитория: https://github.com/ggerganov/whisper.cpp/releases
2. Найдите файл `main.exe` или `whisper-cli.exe` в архиве
3. Скопируйте `main.exe` в папку `whisper150/` вашего проекта

Структура:

```text
whisper150/
├── main.exe          # Whisper CLI
├── models/           # Папка с моделями
└── uploads/          # Временные файлы
```

**Linux/macOS:**

```bash
# Клонирование репозитория
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp

# Сборка
make

# Копирование исполняемого файла
cp main /path/to/whisper-server/whisper150/
```

### 4. Загрузка модели Whisper

Модели Whisper доступны в репозитории ggml.

Рекомендуемые модели:

| Модель | Размер | Точность | Скорость | Рекомендация |
|--------|--------|----------|----------|--------------|
| ggml-tiny-q8_0.bin | 75 MB | 70-75% | Очень быстро | Для тестирования |
| ggml-base-q8_0.bin | 142 MB | 75-80% | Быстро | Для простых задач |
| ggml-small-q8_0.bin | 252 MB | 80-85% | Средне | Рекомендуется |
| ggml-medium-q5_0.bin | 1.5 GB | 85-90% | Медленно | Для высокого качества |
| ggml-large-v3-q5_0.bin | 2.9 GB | 90-95% | Очень медленно | Для проф. использования |

**Скачивание модели:**

*Способ 1: Через браузер*

1. Перейдите на https://huggingface.co/ggerganov/whisper.cpp/tree/main
2. Найдите нужную модель (например, `ggml-small-q8_0.bin`)
3. Скачайте файл
4. Поместите его в папку `whisper150/models/`

*Способ 2: Через командную строку (Windows)*

```powershell
# Скачивание модели small (252 MB)
$modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin"
$outputPath = "whisper150/models/ggml-small-q8_0.bin"

Invoke-WebRequest -Uri $modelUrl -OutPath $outputPath
```

*Способ 3: Через wget (Linux/macOS)*

```bash
# Скачивание модели small
wget -O whisper150/models/ggml-small-q8_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin
```

### 5. Создание SSL сертификатов

Для работы микрофона в браузере требуется HTTPS. Самоподписанные сертификаты подходят для тестирования в локальной сети.

**Windows (PowerShell от администратора):**

*Способ 1: Создание самоподписанного сертификата*

```powershell
# Перейдите в папку проекта
cd C:\Projects\js\whishper-server

# Создайте папку для сертификатов (опционально)
New-Item -ItemType Directory -Force -Path certs

# Создайте самоподписанный сертификат
$cert = New-SelfSignedCertificate `
    -DnsName "localhost", "127.0.0.1" `
    -CertStoreLocation "cert:\LocalMachine\My" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -Type SSLServerAuthentication `
    -NotAfter (Get-Date).AddYears(1)

# Экспорт сертификата в PEM формат
$password = ConvertTo-SecureString -String "temp" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "cert.pfx" -Password $password

# Конвертация PFX в PEM (требуется openssl)
openssl pkcs12 -in cert.pfx -nocerts -out key.pem -nodes -passin pass:temp
openssl pkcs12 -in cert.pfx -nokeys -out cert.pem -nodes -passin pass:temp

# Удалите временный PFX файл
Remove-Item cert.pfx
```

*Способ 2: Создание через OpenSSL (если установлен)*

```bash
# Создание приватного ключа
openssl genrsa -out key.pem 2048

# Создание запроса на сертификат
openssl req -new -key key.pem -out cert.csr -subj "/CN=localhost"

# Создание сертификата
openssl x509 -req -days 365 -in cert.csr -signkey key.pem -out cert.pem

# Удаление временного CSR файла
del cert.csr
```

*Способ 3: Создание сертификата для IP адреса (для доступа по сети)*

```powershell
# Создание конфигурационного файла
@"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_ext

[dn]
CN = 192.168.1.100

[v3_ext]
subjectAltName = @alt_names

[alt_names]
IP.1 = 192.168.1.100
IP.2 = 127.0.0.1
DNS.1 = localhost
"@ | Out-File -FilePath openssl-san.cnf -Encoding ASCII

# Создание сертификата
openssl req -new -newkey rsa:2048 -nodes -keyout key.pem -out cert.csr -config openssl-san.cnf
openssl x509 -req -in cert.csr -signkey key.pem -out cert.pem -days 365 -extensions v3_ext -extfile openssl-san.cnf

# Очистка временных файлов
Remove-Item cert.csr, openssl-san.cnf
```

**Linux/macOS:**

```bash
# Создание приватного ключа
openssl genrsa -out key.pem 2048

# Создание сертификата
openssl req -new -x509 -key key.pem -out cert.pem -days 365 -subj "/CN=localhost"

# Для IP адреса
openssl req -new -x509 -key key.pem -out cert.pem -days 365 \
  -subj "/CN=192.168.1.100" \
  -addext "subjectAltName = IP:192.168.1.100, IP:127.0.0.1, DNS:localhost"
```

**Установка сертификата в доверенные (чтобы не было предупреждения браузера):**

*Windows:*

```powershell
# Установка сертификата в доверенные корневые центры
Import-Certificate -FilePath "cert.pem" -CertStoreLocation Cert:\LocalMachine\Root
```

*macOS:*

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain cert.pem
```

*Linux:*

```bash
sudo cp cert.pem /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

## ⚙️ Настройка

### Конфигурация сервера

Отредактируйте `server.js`:

```javascript
const WHISPER_CONFIG = {
    cwd: path.join(__dirname, 'whisper150'),  // Путь к Whisper
    executable: 'main.exe',                   // Исполняемый файл
    model: path.join('models', 'ggml-small-q8_0.bin'), // Модель
    language: 'ru',                           // Язык по умолчанию
    threads: 4                                // Количество потоков
};

const PORT = process.env.PORT || 3000;        // Порт сервера
```

### Структура проекта

Убедитесь, что структура папок правильная:

```text
whisper-server/
├── key.pem                   # SSL приватный ключ
├── cert.pem                  # SSL сертификат
├── server.js                 # Основной сервер
├── package.json              # Зависимости
├── public/                   # Статические файлы
│   ├── index.html           # Главная страница
│   ├── client.js            # Клиентский JavaScript
│   └── style.css            # Стили
├── example/                  # Тестовые аудиофайлы
│   ├── nobad.wav
│   └── test.wav
└── whisper150/              # Директория Whisper
    ├── main.exe             # Whisper CLI
    ├── models/              # Папка с моделями
    │   └── ggml-small-q8_0.bin
    └── uploads/             # Временные файлы (создается автоматически)
```

### Настройка брандмауэра Windows

```powershell
# Разрешить входящие соединения на порту 3000
New-NetFirewallRule -DisplayName "Whisper Server" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

## 🚀 Запуск

**Режим разработки (с автоматической перезагрузкой)**

```bash
npm run dev
```

**Production режим**

```bash
npm start
# или
node server.js
```

**С переменными окружения**

```bash
# Windows (CMD)
set PORT=8080 && node server.js

# Windows (PowerShell)
$env:PORT=8080; node server.js

# Linux/macOS
PORT=8080 node server.js
```

### Проверка работоспособности

После запуска сервера вы должны увидеть:

```text
============================================================
🎙️  WHISPER SERVER STARTED (HTTPS)
============================================================

🌐 HTTPS Server URL: https://localhost:3000

📁 Configuration:
   Whisper dir: C:\Projects\js\whishper-server\whisper150
   Model: models\ggml-small-q8_0.bin
   Language: ru
   Threads: 4

✅ Status:
   ✓ main.exe found
   ✓ Model found (252.21 MB)
   ✅ FFmpeg found - audio conversion available

💡 Ready for transcription!
```

## 📡 API Документация

[Предыдущая документация API остается без изменений...]

## 🔌 WebSocket События

[Предыдущая документация WebSocket остается без изменений...]

## 💻 Клиентское приложение

[Предыдущая документация клиента остается без изменений...]

## 🔒 HTTPS Настройка

[Предыдущая документация HTTPS остается без изменений...]

## 🐛 Устранение проблем

### 1. Ошибка доступа к микрофону

**Проблема:** "❌ Ваш браузер не поддерживает доступ к микрофону"

**Решение:**
- Используйте HTTPS вместо HTTP (https://localhost:3000)
- Разрешите доступ к микрофону в настройках браузера
- Проверьте физическое подключение микрофона
- Для тестов используйте https://localhost:3000 (не http://)

### 2. Ошибка EACCES: permission denied

**Проблема:** `Error: listen EACCES: permission denied 0.0.0.0:80`

**Решение:**
- Используйте порт выше 1024 (например, 3000)
- Или запустите с правами администратора для порта 80

### 3. Whisper не распознает аудио

**Проблема:** `error: failed to open file as WAV`

**Решение:**
- Установите FFmpeg для конвертации аудио
- Проверьте, что FFmpeg доступен в командной строке: `ffmpeg -version`
- Убедитесь, что в папке `whisper150/uploads/` есть права на запись

### 4. FFmpeg не найден

**Проблема:** `FFmpeg not found`

**Решение:**

```bash
# Проверьте установку
ffmpeg -version

# Windows - добавьте в PATH
setx PATH "%PATH%;C:\ffmpeg\bin"

# Перезапустите терминал после установки
```

### 5. SSL сертификат не доверенный

**Проблема:** Браузер показывает предупреждение безопасности

**Решение:**
- Нажмите "Advanced" → "Proceed to site" (для тестирования)
- Или установите сертификат в доверенные (см. раздел "Установка сертификата в доверенные")

### 6. Нет результата транскрипции

**Проверка вручную:**

```bash
cd whisper150
main.exe -m models\ggml-small-q8_0.bin -f uploads\test.wav -l ru --no-timestamps
```

### 7. WebSocket отключается

**Решение:**
- Проверьте файрволл (порт 3000 должен быть открыт)
- Убедитесь, что используете `wss://` для HTTPS соединения
- Добавьте heartbeat механизм в WebSocket

## 📊 Производительность

[Таблица производительности остается без изменений...]

## 🛠️ Расширенная настройка

[Расширенная настройка остается без изменений...]

## 📝 Лицензия

MIT License - свободное использование, модификация и распространение.

## 🤝 Поддержка

При возникновении проблем:
- Проверьте логи сервера в консоли
- Запустите ручную транскрипцию для теста
- Проверьте права доступа к файлам
- Убедитесь, что все пути корректны
- Проверьте установку FFmpeg: `ffmpeg -version`
- Проверьте SSL сертификаты: `openssl verify cert.pem`

## 📞 Контакты

**Автор:** Ваше Имя

**Email:** your.email@example.com

**GitHub:** https://github.com/yourusername/whisper-server

## 🙏 Благодарности

- [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) - порт Whisper на C++
- [FFmpeg](https://ffmpeg.org/) - конвертация аудио
- [Express.js](https://expressjs.com/) - веб-фреймворк
- [Node.js](https://nodejs.org/) - среда выполнения
```