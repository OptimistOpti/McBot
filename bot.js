const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
app.use(express.json());

// ── Состояние бота ────────────────────────────────────────────────────────────
let bot = null;
let botStatus = 'offline'; // offline | connecting | online | error
let botInfo = {};
let lastError = '';
let chatLog = [];

const SECRET = process.env.SECRET_TOKEN || 'changeme';

// ── Middleware: проверка токена ────────────────────────────────────────────────
function auth(req, res, next) {
    const token = req.headers['x-token'] || req.query.token;
    if (token !== SECRET) {
        return res.status(401).json({ error: 'Неверный токен' });
    }
    next();
}

// ── Запуск бота ───────────────────────────────────────────────────────────────
function startBot(host, port, username, version) {
    if (bot) {
        stopBot();
    }

    botStatus = 'connecting';
    botInfo = { host, port, username, version };
    lastError = '';
    chatLog = [];

    console.log(`[Bot] Подключение к ${host}:${port} как ${username} (${version})`);

    try {
        bot = mineflayer.createBot({
            host,
            port: parseInt(port) || 25565,
            username,
            version,
            auth: 'offline',
            hideErrors: false,
            checkTimeoutInterval: 30000,
        });

        bot.on('spawn', () => {
            botStatus = 'online';
            console.log(`[Bot] ✅ Бот в игре: ${username}`);
        });

        bot.on('error', (err) => {
            lastError = err.message;
            botStatus = 'error';
            console.error(`[Bot] ❌ Ошибка: ${err.message}`);
        });

        bot.on('end', (reason) => {
            botStatus = 'offline';
            lastError = reason || 'Соединение закрыто';
            console.log(`[Bot] Отключён: ${reason}`);
            bot = null;
        });

        bot.on('kicked', (reason) => {
            lastError = `Кик: ${reason}`;
            botStatus = 'offline';
            console.log(`[Bot] Кикнут: ${reason}`);
            bot = null;
        });

        // Логируем чат
        bot.on('message', (msg) => {
            const text = msg.toString();
            chatLog.push({ time: new Date().toISOString(), text });
            if (chatLog.length > 50) chatLog.shift();
            console.log(`[Chat] ${text}`);
        });

        // Anti-AFK: приседание каждые 4 минуты
        setInterval(() => {
            if (bot && botStatus === 'online') {
                bot.setControlState('sneak', true);
                setTimeout(() => {
                    if (bot) bot.setControlState('sneak', false);
                }, 500);
            }
        }, 4 * 60 * 1000);

    } catch (err) {
        botStatus = 'error';
        lastError = err.message;
        bot = null;
    }
}

function stopBot() {
    if (bot) {
        try { bot.quit('AFK бот остановлен'); } catch (e) {}
        bot = null;
    }
    botStatus = 'offline';
}

// ── API роуты ─────────────────────────────────────────────────────────────────

// Статус (без токена — для проверки что сервер живой)
app.get('/', (req, res) => {
    res.json({ ok: true, status: botStatus });
});

// Запустить бота
app.post('/start', auth, (req, res) => {
    const { host, port, username, version } = req.body;
    if (!host || !username) {
        return res.status(400).json({ error: 'Нужны host и username' });
    }
    startBot(host, port || 25565, username, version || '1.21.1');
    res.json({ ok: true, message: `Запускаю бота на ${host}:${port || 25565}` });
});

// Остановить бота
app.post('/stop', auth, (req, res) => {
    stopBot();
    res.json({ ok: true, message: 'Бот остановлен' });
});

// Статус бота
app.get('/status', auth, (req, res) => {
    res.json({
        status: botStatus,
        info: botInfo,
        error: lastError,
        online: botStatus === 'online',
    });
});

// Написать в чат
app.post('/chat', auth, (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Нужен message' });
    }
    if (!bot || botStatus !== 'online') {
        return res.status(400).json({ error: 'Бот не в игре' });
    }
    try {
        bot.chat(message);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Последние сообщения чата
app.get('/chatlog', auth, (req, res) => {
    res.json({ messages: chatLog });
});

// ── Запуск сервера ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Server] Запущен на порту ${PORT}`);
});
