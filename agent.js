// ============================================================
// 🍕 ЛОКАЛЬНЫЙ АГЕНТ "ДЕДА ПИЦЦА" — ИТОГОВАЯ СБОРКА (ФИНАЛ)
//  • Главный приоритет — печать чеков АТОЛ
//  • Сбер: изолированная очередь на каждый терминал (без гонок)
//  • Авто-открытие/закрытие смены с проверкой "уже открыта?"
//  • Классификация ошибок для киоска (лента, недостаточно средств...)
//  • Журнал оплат — защита от двойного списания при обрыве связи
//  • Подробный лог без спама
// ============================================================
import { io as ioClient } from 'socket.io-client';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import { createServer } from 'http';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';
import util from 'util';
import { fileURLToPath } from 'url';

// ==========================================
// ⚙️ НАСТРОЙКИ
// ==========================================
const CLOUD_SERVER_URL = 'https://quok.art';
const SOCKET_PATH = '/pizza/socket.io';
const LOCAL_GUI_PORT = 3030;

const ATOL_CONNECTION_TYPE = 'COM';   // 'COM' | 'USB' | 'TCP'
const ATOL_KKT_IP = '192.168.1.91';
const ATOL_KKT_PORT = '5555';
const ATOL_COM_PORT = 'COM3';

const SBER_PAY_TIMEOUT_MS = 90000;
const SBER_SETTLEMENT_TIMEOUT_MS = 120000;
const ATOL_PRINT_TIMEOUT_MS = 120000;

const AUTO_OPEN_HOUR_START = 10;   // окно авто-открытия смены: с 10:00
const AUTO_OPEN_HOUR_END = 18;     // по 17:59
const AUTO_CLOSE_HOUR = 19;        // авто-закрытие с 19:00
const AUTO_TICK_MS = 30000;        // такт планировщика
const STATUS_CHECK_MS = 60000;     // тихая плановая проверка смены
const AUTO_RETRY_BACKOFF_MS = 5 * 60000; // повтор неудачной автоматики через 5 мин

const VERBOSE = false; // true → добавляются DEBUG-логи очереди (спамно, только для отладки)

const executionDir = process.pkg
  ? path.dirname(process.execPath)
  : path.dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = path.join(executionDir, 'receipts_queue.json');
const QUEUE_TMP_FILE = path.join(executionDir, 'receipts_queue.tmp.json');

// ==========================================
// 📝 ЛОГЕР: подробно по событиям, тихо по периодике
// ==========================================
const originalLog = console.log;
const originalError = console.error;

let cloudSocket = null;
let localIo = null;

function timestamp() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function log(level, category, ...args) {
  const text = util.format(...args);
  originalLog(`${timestamp()} [${level}] [${category}] ${text}`);
  const payload = { level: String(level).toLowerCase(), text: `[${category}] ${text}`, time: timestamp() };
  try {
    if (localIo) localIo.emit('agent_log', payload);
    if (cloudSocket && cloudSocket.connected) cloudSocket.emit('agent_remote_log', payload);
  } catch (e) { /* лог не должен ронять агента */ }
}
const logInfo  = (...a) => log('INFO', ...a);
const logWarn  = (...a) => log('WARN', ...a);
const logError = (...a) => log('ERROR', ...a);
const logDebug = (...a) => { if (VERBOSE) log('DEBUG', ...a); };

// перехват случайных console.* из библиотек
console.log   = (...a) => log('INFO', 'STDOUT', util.format(...a));
console.error = (...a) => log('ERROR', 'STDERR', util.format(...a));

// 💡 любая непойманная ошибка больше не убивает агента молча
process.on('uncaughtException', (e) => logError('АГЕНТ', '💥 Необработанная ошибка (агент продолжает работу):', e.stack || e));
process.on('unhandledRejection', (e) => logError('АГЕНТ', '💥 Необработанный промис:', (e && e.stack) || e));

logInfo('АГЕНТ', '======================================================');
logInfo('АГЕНТ', '🤖 ЛОКАЛЬНЫЙ АГЕНТ "ДЕДА ПИЦЦА" ЗАПУСКАЕТСЯ...');
logInfo('АГЕНТ', `🌐 Облако: ${CLOUD_SERVER_URL}${SOCKET_PATH}`);
logInfo('АГЕНТ', `🖨 АТОЛ: режим ${ATOL_CONNECTION_TYPE}${ATOL_CONNECTION_TYPE === 'COM' ? ' (' + ATOL_COM_PORT + ')' : ''}`);
logInfo('АГЕНТ', '⌨️  Клавиши: [S] повтор stuck-чеков, [T] тест-чек, [O] открыть смену, [C] закрыть, [X] очистить очередь');
logInfo('АГЕНТ', '======================================================');

// ==========================================
// 🌐 HTTP + ЛОКАЛЬНЫЙ GUI
// ==========================================
const app = express();
const httpServer = createServer(app);
localIo = new SocketIOServer(httpServer, { cors: { origin: '*' } });

// ==========================================
// ☁️ СОКЕТ ОБЛАКА
// ==========================================
let everConnected = false;
let lastConnErrLog = 0;

cloudSocket = ioClient(CLOUD_SERVER_URL, {
  path: SOCKET_PATH,
  reconnection: true,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

cloudSocket.on('connect', () => {
  logInfo('ОБЛАКО', everConnected ? '✅ Связь с облаком восстановлена' : '✅ Соединение с облаком установлено');
  everConnected = true;
  cloudSocket.emit('register_agent');
  if (localIo) localIo.emit('cloud_status', true);
});

cloudSocket.on('disconnect', (reason) => {
  logWarn('ОБЛАКО', `🚨 Связь с облаком потеряна (${reason}). Ждём автопереподключение...`);
  if (localIo) localIo.emit('cloud_status', false);
});

cloudSocket.on('connect_error', (err) => {
  const now = Date.now();
  if (now - lastConnErrLog >= 30000) {   // 🔇 троттлинг: не спамим каждым "xhr poll error"
    lastConnErrLog = now;
    logWarn('ОБЛАКО', `Ошибка соединения: ${err.message}. ("xhr poll error" = временная недоступность облака/интернета — переподключимся сами.)`);
  }
});

// безопасная обёртка ack: если облако прислало событие без колбэка — не падаем
function safeAck(callback, label) {
  if (typeof callback === 'function') return callback;
  return (result) => logWarn('ОБЛАКО', `${label}: ack-колбэк не получен, результат только в логе: ${JSON.stringify(result).slice(0, 300)}`);
}

// ==========================================
// ДЕКОДЕРЫ КОДИРОВОК
// ==========================================
function decodeWin1251(buffer) {
  const table = [0x0402,0x0403,0x201A,0x0453,0x201E,0x2026,0x2020,0x2021,0x20AC,0x2030,0x0409,0x2039,0x040A,0x040C,0x040B,0x040F,0x0452,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x0000,0x2122,0x0459,0x203A,0x045A,0x045C,0x045B,0x045F,0x00A0,0x040E,0x045E,0x0408,0x00A4,0x0490,0x00A6,0x00A7,0x0401,0x00A9,0x0404,0x00AB,0x00AC,0x00AD,0x00AE,0x0407,0x00B0,0x00B1,0x0406,0x0456,0x0491,0x00B5,0x00B6,0x00B7,0x0451,0x2116,0x0454,0x00BB,0x0458,0x0405,0x0455,0x0457];
  let res = '';
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    if (c < 128) res += String.fromCharCode(c);
    else if (c <= 191) res += String.fromCharCode(table[c - 128]);
    else res += String.fromCharCode(c + 0x0390);
  }
  return res;
}

function decodeCP866(buffer) {
  let res = '';
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    if (c < 128) res += String.fromCharCode(c);
    else if (c >= 128 && c <= 175) res += String.fromCharCode(c - 128 + 1040);
    else if (c >= 224 && c <= 239) res += String.fromCharCode(c - 224 + 1088);
    else if (c === 240) res += 'Ё';
    else if (c === 241) res += 'ё';
    else res += ' ';
  }
  return res;
}

// ==========================================
// 🏷 КЛАССИФИКАЦИЯ ОШИБОК
// (агент видит текст от АТОЛ/банка и превращает его в код
//  для понятного сообщения на экране киоска)
// ==========================================
function classifyAtolError(description = '') {
  const d = String(description).toLowerCase();
  if (d.includes('лент') || d.includes('бумаг') || d.includes('paper')) return 'PAPER_OUT';
  if (d.includes('крышк') || d.includes('cover')) return 'PRINTER_COVER';
  if (d.includes('перегрев') || d.includes('температур') || d.includes('overheat')) return 'OVERHEAT';
  if (d.includes('connection') || d.includes('нет связи') || d.includes('связь с ккт') || d.includes('порт')) return 'NO_CONNECTION';
  if (d.includes('таймаут') || d.includes('timeout')) return 'TIMEOUT';
  if (d.includes('смен')) return 'SHIFT_ERROR';
  if (d.includes('фн') || d.includes('фискальн')) return 'FN_ERROR';
  return 'PRINTER_ERROR';
}

function classifySberError(message = '') {
  const d = String(message).toLowerCase();
  if (d.includes('недостаточно средств') || d.includes('insufficient')) return 'INSUFFICIENT_FUNDS';
  if (d.includes('лимит')) return 'LIMIT_EXCEEDED';
  if (d.includes('отмен') || d.includes('cancel')) return 'CANCELLED';
  if (d.includes('время ожидания') || d.includes('таймаут') || d.includes('timeout')) return 'TIMEOUT';
  if (d.includes('нет связи') || d.includes('связь')) return 'NO_CONNECTION';
  if (d.includes('изъят') || d.includes('заблокир')) return 'CARD_RETAINED';
  return 'BANK_DECLINED';
}

// ==========================================
// 💳 ПУТИ ЭКВАЙРИНГА (СТРОГО ПО КИОСКАМ)
// ==========================================
function getSberPath(kioskId = '1') {
  const kId = String(kioskId || '1');
  const primary = `C:\\sc552_${kId}`;
  if (fs.existsSync(primary)) return primary;
  // ⚠️ Общий fallback разрешён ТОЛЬКО киоску №1.
  // Раньше любой киоск мог упасть на общую C:\sc552 — и два терминала
  // одновременно писали e.txt/p.txt в одну папку → гонка и битые результаты.
  if (kId === '1' && fs.existsSync('C:\\sc552')) return 'C:\\sc552';
  logWarn(`СБЕР#${kId}`, `Папка эквайринга не найдена, ожидалась: ${primary}`);
  return primary;
}

// ==========================================
// 💳 МЕНЕДЖЕР ОЧЕРЕДЕЙ СБЕР (ИЗОЛЯЦИЯ ПО КИОСКАМ)
// ==========================================
class SberQueueManager {
  constructor() {
    this.queues = {};           // kId -> задачи
    this.isProcessing = {};     // kId -> bool
    this.activeProcesses = {};  // kId -> childProcess  ← ФИКС: инициализация карты
    this.manualKill = {};       // kId -> процесс убит вручную
  }

  enqueuePayment(kioskId, amount, callback) {
    const kId = String(kioskId || '1');
    if (!this.queues[kId]) { this.queues[kId] = []; this.isProcessing[kId] = false; }
    this.queues[kId].push({ type: 'pay', amount, callback, addedAt: Date.now() });
    logInfo(`СБЕР#${kId}`, `📥 Платёж ${amount} руб. в очереди (позиция ${this.queues[kId].length})`);
    this.processNext(kId);
  }

  enqueueSettlement(kioskId, callback) {
    const kId = String(kioskId || '1');
    if (!this.queues[kId]) { this.queues[kId] = []; this.isProcessing[kId] = false; }
    this.queues[kId].push({ type: 'settlement', callback, addedAt: Date.now() });
    logInfo(`СБЕР#${kId}`, '📥 Сверка итогов в очереди');
    this.processNext(kId);
  }

  processNext(kId) {
    if (this.isProcessing[kId]) { logDebug(`СБЕР#${kId}`, 'Очередь занята — задача подождёт'); return; }
    const q = this.queues[kId];
    if (!q || q.length === 0) return;
    this.isProcessing[kId] = true;
    const task = q[0];
    const startedAt = Date.now();

    const onComplete = (result) => {
      q.shift();
      this.isProcessing[kId] = false;
      const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
      try { if (task.callback) task.callback(result); }
      catch (e) { logError(`СБЕР#${kId}`, 'Ошибка ack-колбэка:', e.message); }
      logDebug(`СБЕР#${kId}`, `Задача завершена за ${dur}с, осталось: ${q.length}`);
      setTimeout(() => this.processNext(kId), 500);
    };

    if (task.type === 'pay') this.executePayment(kId, task.amount, onComplete);
    else this.executeSettlement(kId, onComplete);
  }

  cancelActivePayment(kioskId) {
    const kId = String(kioskId || '1');
    logWarn(`СБЕР#${kId}`, '⛔ Получена команда отмены оплаты');
    // выкидываем ещё не начавшиеся платежи
    if (this.queues[kId]) {
      const before = this.queues[kId].length;
      this.queues[kId] = this.queues[kId].filter(t => t.type !== 'pay');
      if (this.queues[kId].length < before) logInfo(`СБЕР#${kId}`, `Из очереди удалено платежей: ${before - this.queues[kId].length}`);
    }
    // ФИКС: убиваем по той же карте, куда пишет executePayment
    const p = this.activeProcesses[kId];
    if (p && p.pid) {
      this.manualKill[kId] = true;
      try {
        exec(`taskkill /F /PID ${p.pid} /T`, () => {});
        logWarn(`СБЕР#${kId}`, `Процесс ${p.pid} остановлен (taskkill)`);
      } catch (e) {}
      delete this.activeProcesses[kId];
    } else {
      logInfo(`СБЕР#${kId}`, 'Активного процесса оплаты нет — отменять нечего');
    }
  }

  executePayment(kId, amount, callback) {
    const SBER_PATH = getSberPath(kId);
    logInfo(`СБЕР#${kId}`, `💳 ЗАПУСК ОПЛАТЫ: ${amount} руб. (${SBER_PATH})`);

    if (!fs.existsSync(SBER_PATH)) {
      logError(`СБЕР#${kId}`, `Папка ${SBER_PATH} не найдена`);
      return callback({ success: false, error: `Папка ${SBER_PATH} не найдена`, errorCode: 'NO_CONNECTION' });
    }

    ['e.txt', 'e', 'p.txt', 'p', 'commerr.log'].forEach(f => { try { fs.unlinkSync(path.join(SBER_PATH, f)); } catch (e) {} });

    const exeFile = fs.existsSync(path.join(SBER_PATH, 'sb_pilot.exe')) ? 'sb_pilot.exe' : 'sb_kernel.exe';
    const rub = Math.round(Number(amount || 0) * 100);
    const command = `"${path.join(SBER_PATH, exeFile)}" 1 ${rub}`;
    logDebug(`СБЕР#${kId}`, `Команда: ${command}`);
    const startedAt = Date.now();

    const childProcess = exec(command, { cwd: SBER_PATH, timeout: SBER_PAY_TIMEOUT_MS }, (error) => {
      delete this.activeProcesses[kId];
      const dur = ((Date.now() - startedAt) / 1000).toFixed(1);

      if (error && error.killed) {
        const wasManual = this.manualKill[kId];
        this.manualKill[kId] = false;
        const msg = wasManual ? 'Оплата отменена по запросу' : 'Время ожидания оплаты истекло (90 сек)';
        logWarn(`СБЕР#${kId}`, `🚨 ${msg} (${dur}с)`);
        return callback({ success: false, error: msg, errorCode: wasManual ? 'CANCELLED' : 'TIMEOUT' });
      }

      try {
        const resultFile = fs.existsSync(path.join(SBER_PATH, 'e')) ? path.join(SBER_PATH, 'e')
          : (fs.existsSync(path.join(SBER_PATH, 'e.txt')) ? path.join(SBER_PATH, 'e.txt') : null);
        const slipFile = fs.existsSync(path.join(SBER_PATH, 'p')) ? path.join(SBER_PATH, 'p') : null;

        if (resultFile) {
          const rawBuffer = fs.readFileSync(resultFile);
          let rawResult = decodeCP866(rawBuffer);
          if (rawResult.includes('??') || rawResult.includes('  ')) rawResult = decodeWin1251(rawBuffer);

          const firstLine = rawResult.split('\n')[0].trim();
          const [codeStr, ...msgParts] = firstLine.split(',');
          const resultCode = parseInt(String(codeStr).trim(), 10);
          const bankMessage = msgParts.join(',').trim() || 'Отказ';
          const bankSlip = slipFile ? decodeWin1251(fs.readFileSync(slipFile)) : '';
          logDebug(`СБЕР#${kId}`, `Ответ банка: "${firstLine}"`);

          if (resultCode === 0) {
            logInfo(`СБЕР#${kId}`, `✅ Оплата прошла успешно (${dur}с)`);
            return callback({ success: true, slip: bankSlip });
          }
          // 💡 КЛЮЧЕВОЕ: классифицируем отказ банка для киоска
          // («Недостаточно средств» → INSUFFICIENT_FUNDS и т.д.)
          const errorCode = classifySberError(bankMessage);
          logError(`СБЕР#${kId}`, `🚨 Отказ банка: ${bankMessage} (код ${resultCode}) → ${errorCode}`);
          return callback({ success: false, error: `${bankMessage} (Код: ${resultCode})`, errorCode, bankCode: resultCode });
        }
        logError(`СБЕР#${kId}`, 'Файл результата e/e.txt не найден после завершения процесса');
      } catch (e) {
        logError(`СБЕР#${kId}`, 'Ошибка парсинга результата:', e.message);
      }
      callback({ success: false, error: 'Оплата отменена клиентом или терминалом', errorCode: 'CANCELLED' });
    });

    this.activeProcesses[kId] = childProcess;
    logInfo(`СБЕР#${kId}`, `Процесс запущен (PID ${childProcess.pid}), лимит ожидания ${SBER_PAY_TIMEOUT_MS / 1000}с`);
  }

  executeSettlement(kId, callback) {
    const SBER_PATH = getSberPath(kId);
    if (!fs.existsSync(SBER_PATH)) {
      logError(`СБЕР#${kId}`, `Папка не найдена: ${SBER_PATH}`);
      return callback({ success: false, error: `Папка ${SBER_PATH} не найдена` });
    }
    ['e.txt', 'e', 'p.txt', 'p'].forEach(f => { try { fs.unlinkSync(path.join(SBER_PATH, f)); } catch (e) {} });

    const exeFile = fs.existsSync(path.join(SBER_PATH, 'sb_pilot.exe')) ? 'sb_pilot.exe' : 'sb_kernel.exe';
    logInfo(`СБЕР#${kId}`, `🧾 Сверка итогов запущена...`);
    const startedAt = Date.now();

    exec(`"${path.join(SBER_PATH, exeFile)}" 7`, { cwd: SBER_PATH, timeout: SBER_SETTLEMENT_TIMEOUT_MS }, (error) => {
      delete this.activeProcesses[kId];
      const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (error && error.killed) {
        logError(`СБЕР#${kId}`, 'Таймаут сверки итогов');
        return callback({ success: false, error: 'Таймаут сверки' });
      }
      try {
        const resultFile = fs.existsSync(path.join(SBER_PATH, 'e')) ? path.join(SBER_PATH, 'e')
          : (fs.existsSync(path.join(SBER_PATH, 'e.txt')) ? path.join(SBER_PATH, 'e.txt') : null);
        if (resultFile) {
          let rawResult = decodeCP866(fs.readFileSync(resultFile));
          if (rawResult.includes('??') || rawResult.includes('  ')) rawResult = decodeWin1251(fs.readFileSync(resultFile));
          const [codeStr, ...msgParts] = rawResult.split('\n')[0].split(',');
          if (parseInt(String(codeStr).trim(), 10) === 0) {
            logInfo(`СБЕР#${kId}`, `✅ Сверка итогов завершена (${dur}с)`);
            return callback({ success: true });
          }
          const msg = msgParts.join(',').trim() || 'Ошибка сверки';
          logError(`СБЕР#${kId}`, `🚨 Сверка не прошла: ${msg}`);
          return callback({ success: false, error: msg });
        }
      } catch (e) { logError(`СБЕР#${kId}`, 'Ошибка парсинга сверки:', e.message); }
      callback({ success: false, error: 'Таймаут сверки' });
    });
  }
}

const sberManager = new SberQueueManager();

// ==========================================
// 📓 ЖУРНАЛ ОПЛАТ — защита от двойного списания
// Если связь моргнула ПОСЛЕ успешной оплаты, повторный запрос
// с тем же orderId вернёт сохранённый результат, а не спишет снова.
// Требование: киоск присылает стабильный orderId при повторах.
// ==========================================
const paymentJournal = new Map();
const PAYMENT_JOURNAL_MAX = 300;

// ==========================================
// 🖨 ОЧЕРЕДЬ ЧЕКОВ АТОЛ
// Две дорожки: ЧЕКИ (приоритет, персистентны) и СЛУЖЕБНЫЕ (getShiftStatus)
// ==========================================
class PersistentReceiptQueue {
  constructor() {
    this.queue = [];          // чеки — сохраняются на диск
    this.serviceQueue = [];   // служебные — не сохраняются
    this.isProcessing = false;
    this.callbacks = new Map();
    this.busyLogged = false;
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
        this.queue = JSON.parse(raw) || [];
        this.queue.forEach(q => { if (!q.status) q.status = 'pending'; });
        if (this.queue.length) {
          logInfo('ОЧЕРЕДЬ', `Загружено чеков с диска: ${this.queue.length}` +
            (this.stuckCount() ? ` (застрявших: ${this.stuckCount()})` : ''));
        }
      }
    } catch (e) { this.queue = []; logError('ОЧЕРЕДЬ', 'Не удалось прочитать файл очереди:', e.message); }
  }

  saveToDisk() {
    try {
      fs.writeFileSync(QUEUE_TMP_FILE, JSON.stringify(this.queue, null, 2), 'utf8');
      fs.renameSync(QUEUE_TMP_FILE, QUEUE_FILE);
    } catch (e) { logError('ОЧЕРЕДЬ', 'Ошибка сохранения очереди:', e.message); }
    this.notifyQueueLength();
  }

  notifyQueueLength() {
    if (localIo) localIo.emit('queue_status', { pending: this.pendingCount(), stuck: this.stuckCount() });
  }

  pendingCount() { return this.queue.filter(q => q.status === 'pending').length; }
  stuckCount() { return this.queue.filter(q => q.status === 'stuck').length; }
  hasPendingReceipts() { return this.queue.some(q => q.status === 'pending'); }
  isBusy() { return this.isProcessing; }

  clearQueue() {
    this.queue = [];
    this.serviceQueue = [];
    this.isProcessing = false;
    this.saveToDisk();
    logWarn('ОЧЕРЕДЬ', '🗑 Очередь полностью очищена');
  }

  retryStuck() {
    let count = 0;
    this.queue.forEach(q => { if (q.status === 'stuck') { q.status = 'pending'; q.attempts = 0; count++; } });
    if (count > 0) {
      logInfo('ОЧЕРЕДЬ', `🔄 Ручной перезапуск ${count} застрявших чеков`);
      this.saveToDisk();
      this.processQueue();
    } else {
      logInfo('ОЧЕРЕДЬ', '✅ Застрявших чеков нет');
    }
  }

  enqueue(body, callback = null, isEphemeral = false) {
    const taskId = (body && body.uuid) ? body.uuid : `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    if (callback) this.callbacks.set(taskId, callback);
    const item = { taskId, body, addedAt: new Date().toISOString(), attempts: 0, status: 'pending', isEphemeral };

    if (isEphemeral) {
      this.serviceQueue.push(item);
      logDebug('ОЧЕРЕДЬ', `Служебная задача ${taskId} добавлена`);
    } else {
      this.queue.push(item);
      logInfo('ОЧЕРЕДЬ', `📥 Чек ${taskId} добавлен в очередь (в ожидании: ${this.pendingCount()}, stuck: ${this.stuckCount()})`);
      this.saveToDisk();
    }
    this.processQueue();
  }

  removeItem(item) {
    this.queue = this.queue.filter(q => q !== item);
    this.serviceQueue = this.serviceQueue.filter(q => q !== item);
  }

  processQueue() {
    if (this.isProcessing) {
      // 🔇 "занята" логируем один раз и только в DEBUG — никакого спама
      if (!this.busyLogged) { logDebug('ОЧЕРЕДЬ', 'Очередь занята — задача подождёт'); this.busyLogged = true; }
      return;
    }
    // 🥇 ГЛАВНЫЙ ПРИОРИТЕТ — ЧЕКИ. Служебные задачи идут только когда чеков нет.
    const item = this.queue.find(q => q.status === 'pending') || this.serviceQueue[0];
    if (!item) { this.busyLogged = false; return; }

    this.isProcessing = true;
    const startedAt = Date.now();
    if (!item.isEphemeral) logInfo('АТОЛ', `🖨 Печать чека ${item.taskId} (попытка ${item.attempts + 1})...`);
    else logDebug('АТОЛ', `Служебная задача: ${item.body.request[0].type}`);

    this.executePrint(item.body, (result) => {
      const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
      const cb = this.callbacks.get(item.taskId);
      if (cb) { try { cb(result); } catch (e) { logError('ОЧЕРЕДЬ', 'Ошибка ack-колбэка:', e.message); } this.callbacks.delete(item.taskId); }

      if (result.success) {
        if (!item.isEphemeral) logInfo('АТОЛ', `🎉 Чек ${item.taskId} напечатан (${dur}с)`);
        this.removeItem(item);
        if (!item.isEphemeral) this.saveToDisk();

        setTimeout(() => {
          this.isProcessing = false;
          if (!this.hasPendingReceipts()) refreshShiftStatus('после задачи', true);
          this.processQueue();
        }, 400);

      } else if (item.isEphemeral) {
        this.removeItem(item);
        logWarn('АТОЛ', `Служебная задача не удалась: ${result.error}`);
        setTimeout(() => { this.isProcessing = false; this.processQueue(); }, 300);

      } else {
        item.attempts += 1;
        const isAutoTask = item.taskId.startsWith('auto_') || item.taskId.startsWith('test');
        if (isAutoTask && item.attempts >= 3) {
          logWarn('АТОЛ', `Авто-задача ${item.taskId} снята после 3 неудач`);
          this.removeItem(item);
          this.saveToDisk();
        } else {
          item.status = 'stuck';
          // 💡 errorCode попадает в лог: сразу видно — лента, связь или ФН
          logError('АТОЛ', `🚨 Сбой чека ${item.taskId} (${dur}с) [${result.errorCode || 'UNKNOWN'}]: ${result.error}`);
          logWarn('ОЧЕРЕДЬ', `⏸ Чек заморожен (stuck). Осталось чеков: ${this.pendingCount()}. Ручной повтор — клавиша [S]`);
          this.saveToDisk();
        }
        // сразу к следующему чеку — печать не останавливается
        setTimeout(() => { this.isProcessing = false; this.processQueue(); }, 500);
      }
    });
  }

  executePrint(body, callback) {
    try {
      const taskJson = body.request[0];
      const taskType = taskJson && taskJson.type ? taskJson.type : 'unknown';
      const uniqueId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const jsonPath = path.join(os.tmpdir(), `atol_${uniqueId}.json`);
      const psPath = path.join(os.tmpdir(), `atol_${uniqueId}.ps1`);
      fs.writeFileSync(jsonPath, JSON.stringify(taskJson), 'utf8');

      let connectionSettingsPs = '';
      if (ATOL_CONNECTION_TYPE === 'USB') {
        connectionSettingsPs = `$fptr.setSingleSetting("Model", "500")\n$fptr.setSingleSetting("Port", "27")`;
      } else if (ATOL_CONNECTION_TYPE === 'COM') {
        connectionSettingsPs = `$fptr.setSingleSetting("Model", "500")\n$fptr.setSingleSetting("Port", "0")\n$fptr.setSingleSetting("ComFile", "${ATOL_COM_PORT}")\n$fptr.setSingleSetting("BaudRate", "115200")`;
      } else {
        connectionSettingsPs = `$fptr.setSingleSetting("Model", "500")\n$fptr.setSingleSetting("Port", "2")\n$fptr.setSingleSetting("IPAddress", "${ATOL_KKT_IP}")\n$fptr.setSingleSetting("IPPort", "${ATOL_KKT_PORT}")`;
      }

      const psScript = `
$ErrorActionPreference = "Stop"
try {
    $fptr = New-Object -ComObject AddIn.Fptr10
    ${connectionSettingsPs}
    $fptr.applySingleSettings()
    $fptr.open()
    if (!$fptr.isOpened()) { throw "CONNECTION_FAILED" }
    $json = [System.IO.File]::ReadAllText('${jsonPath}', [System.Text.Encoding]::UTF8)
    $fptr.setParam(65645, $json)
    $fptr.processJson()
    $errCode = $fptr.errorCode()
    if ($errCode -ne 0) {
        $errDesc = $fptr.errorDescription().Replace('"', '\\"') -replace "\\r\\n|\\n|\\r", " "
        Write-Output "B64_RESULT:$([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('{"error":{"description":"' + $errDesc + '"}}')))"
        $fptr.close()
        exit
    }
    $result = $fptr.getParamString(65645)
    $fptr.close()
    if ([string]::IsNullOrWhiteSpace($result)) { $result = '{"success":true}' }
    Write-Output "B64_RESULT:$([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($result)))"
} catch {
    $errMsg = $_.Exception.Message.Replace('"', '\\"') -replace "\\r\\n|\\n|\\r", " "
    Write-Output "B64_RESULT:$([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('{"error":{"description":"' + $errMsg + '"}}')))"
}
`;
      fs.writeFileSync(psPath, psScript, 'utf8');
      logDebug('АТОЛ', `Задача ${taskType} → PowerShell (${psPath})`);

      exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psPath}"`,
        { timeout: ATOL_PRINT_TIMEOUT_MS, encoding: 'buffer' },
        (error, stdoutBuffer) => {
          try { fs.unlinkSync(jsonPath); fs.unlinkSync(psPath); } catch (e) {}
          const stdout = stdoutBuffer ? stdoutBuffer.toString('utf8') : '';

          if (error && error.killed) {
            logError('АТОЛ', `Таймаут кассы (${ATOL_PRINT_TIMEOUT_MS / 1000}с) на задаче ${taskType}`);
            return callback({ success: false, error: 'Таймаут кассы (120 сек).', errorCode: 'TIMEOUT' });
          }

          const match = stdout.match(/B64_RESULT:(.*)/);
          if (match) {
            try {
              const result = JSON.parse(Buffer.from(match[1].trim(), 'base64').toString('utf8'));
              if (result.error) {
                // 💡 КЛЮЧЕВОЕ: «Закончилась бумага» → PAPER_OUT и т.д.
                const errorCode = classifyAtolError(result.error.description);
                logError('АТОЛ', `Касса вернула ошибку (${taskType}): ${result.error.description} → ${errorCode}`);
                return callback({ success: false, error: result.error.description, errorCode });
              }
              return callback({ success: true, fiscalData: result });
            } catch (e) {
              logError('АТОЛ', 'Ошибка парсинга ответа кассы:', e.message);
              return callback({ success: false, error: 'Ошибка парсинга ответа кассы', errorCode: 'UNKNOWN' });
            }
          }
          logError('АТОЛ', `Касса не вернула ответ (${taskType}). Хвост вывода: ${stdout.slice(-300).replace(/\s+/g, ' ')}`);
          callback({ success: false, error: 'Касса не вернула ответ', errorCode: 'NO_CONNECTION' });
        });
    } catch (e) {
      logError('АТОЛ', 'Ошибка подготовки печати:', e.message);
      callback({ success: false, error: e.message, errorCode: 'UNKNOWN' });
    }
  }
}

const receiptQueue = new PersistentReceiptQueue();
receiptQueue.processQueue();

// ==========================================
// 📊 СТАТУС СМЕНЫ (тихие проверки, лог только при изменении)
// ==========================================
let shiftStatus = { state: 'unknown', number: 0, text: 'Проверка...' };
let lastLoggedShiftKey = '';

function applyShiftStatus(ss) {
  if (!ss) return;
  shiftStatus = {
    state: ss.state,
    number: ss.number || 0,
    text: ss.state === 'opened' ? `Открыта (#${ss.number})` : ss.state === 'closed' ? 'Закрыта' : `Истекла (#${ss.number})`
  };
  const key = shiftStatus.state + '#' + shiftStatus.number;
  if (key !== lastLoggedShiftKey) {
    logInfo('АТОЛ', `Статус смены: ${shiftStatus.text}`);
    lastLoggedShiftKey = key;
  }
  if (localIo) localIo.emit('shift_status', shiftStatus);
}

function refreshShiftStatus(reason = '', force = false) {
  // 🔇 пока печатаются чеки — плановые проверки пропускаем
  if (!force && (receiptQueue.isBusy() || receiptQueue.hasPendingReceipts())) {
    logDebug('АТОЛ', `Проверка смены отложена (${reason}) — идёт печать`);
    return;
  }
  receiptQueue.enqueue({ uuid: `status_${Date.now()}`, request: [{ type: 'getShiftStatus' }] }, (res) => {
    if (res.success && res.fiscalData && res.fiscalData.shiftStatus) {
      applyShiftStatus(res.fiscalData.shiftStatus);
    } else {
      shiftStatus = { state: 'unknown', number: 0, text: 'Нет связи' };
      if ('offline' !== lastLoggedShiftKey) {
        logWarn('АТОЛ', `Статус смены недоступен: ${res.error || 'нет ответа'}`);
        lastLoggedShiftKey = 'offline';
      }
      if (localIo) localIo.emit('shift_status', shiftStatus);
    }
  }, true);
}

// ==========================================
// 🌅 ОТКРЫТИЕ/ЗАКРЫТИЕ СМЕНЫ С ПРОВЕРКОЙ "УЖЕ ОТКРЫТА?"
// ==========================================
function ensureShiftOpened(reason, onDone) {
  const done = (ok) => { if (typeof onDone === 'function') onDone(ok); };
  logInfo('АВТОМАТИКА', `Проверяем состояние смены перед открытием (${reason})...`);

  receiptQueue.enqueue({ uuid: `status_${Date.now()}`, request: [{ type: 'getShiftStatus' }] }, (res) => {
    if (!res.success || !res.fiscalData || !res.fiscalData.shiftStatus) {
      logWarn('АВТОМАТИКА', `Не удалось получить статус смены: ${res.error || 'нет ответа'}`);
      return done(false);
    }
    applyShiftStatus(res.fiscalData.shiftStatus);

    // 💡 ГЛАВНОЕ: если смена уже открыта — НЕ открываем повторно
    if (res.fiscalData.shiftStatus.state === 'opened') {
      logInfo('АВТОМАТИКА', `✅ Смена УЖЕ ОТКРЫТА (#${res.fiscalData.shiftStatus.number}) — открытие не требуется`);
      return done(true);
    }

    logInfo('АВТОМАТИКА', `Смена не открыта (${res.fiscalData.shiftStatus.state}) — открываем...`);
    receiptQueue.enqueue({
      uuid: `auto_open_${Date.now()}`,
      request: [{ type: 'openShift', operator: { name: 'Автоматика' } }]
    }, (r) => {
      if (r.success) { logInfo('АВТОМАТИКА', '✅ Смена открыта'); done(true); }
      else { logError('АВТОМАТИКА', `Открытие не удалось [${r.errorCode || 'UNKNOWN'}]: ${r.error}`); done(false); }
      refreshShiftStatus('после открытия', true);
    }, false);
  }, true);
}

function ensureShiftClosed(reason, onDone) {
  const done = (ok) => { if (typeof onDone === 'function') onDone(ok); };
  logInfo('АВТОМАТИКА', `Проверяем состояние смены перед закрытием (${reason})...`);

  receiptQueue.enqueue({ uuid: `status_${Date.now()}`, request: [{ type: 'getShiftStatus' }] }, (res) => {
    if (!res.success || !res.fiscalData || !res.fiscalData.shiftStatus) {
      logWarn('АВТОМАТИКА', `Не удалось получить статус смены: ${res.error || 'нет ответа'}`);
      return done(false);
    }
    applyShiftStatus(res.fiscalData.shiftStatus);

    if (res.fiscalData.shiftStatus.state === 'closed') {
      logInfo('АВТОМАТИКА', '✅ Смена уже закрыта — закрывать не требуется');
      return done(true);
    }

    logInfo('АВТОМАТИКА', '🖨 Закрываем смену (Z-отчёт)...');
    receiptQueue.enqueue({
      uuid: `auto_close_${Date.now()}`,
      request: [{ type: 'closeShift', operator: { name: 'Автоматика' } }]
    }, (r) => {
      if (r.success) { logInfo('АВТОМАТИКА', '✅ Смена закрыта'); done(true); }
      else { logError('АВТОМАТИКА', `Закрытие не удалось [${r.errorCode || 'UNKNOWN'}]: ${r.error}`); done(false); }
      refreshShiftStatus('после закрытия', true);
    }, false);
  }, true);
}

// ==========================================
// ⏰ АВТО-РАСПИСАНИЕ: один цикл в день, без спама, повтор при неудаче
// ==========================================
let autoOpenDoneDate = '';
let autoCloseDoneDate = '';
let autoOpenBlockedUntil = 0;
let autoCloseBlockedUntil = 0;

setInterval(() => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const h = now.getHours();

  if (h >= AUTO_OPEN_HOUR_START && h < AUTO_OPEN_HOUR_END &&
      autoOpenDoneDate !== today && Date.now() >= autoOpenBlockedUntil) {
    ensureShiftOpened('авто по расписанию', (ok) => {
      if (ok) { autoOpenDoneDate = today; logInfo('АВТОМАТИКА', 'Утренний цикл завершён'); }
      else { autoOpenBlockedUntil = Date.now() + AUTO_RETRY_BACKOFF_MS; logWarn('АВТОМАТИКА', 'Авто-открытие не удалось — повтор через 5 минут'); }
    });
  }

  if (h >= AUTO_CLOSE_HOUR && autoCloseDoneDate !== today && Date.now() >= autoCloseBlockedUntil) {
    logInfo('АВТОМАТИКА', '🌙 Вечерний цикл: сверка итогов Сбера + закрытие смены');
    sberManager.enqueueSettlement('1', () => {
      if (fs.existsSync('C:\\sc552_2')) setTimeout(() => sberManager.enqueueSettlement('2'), 3000);
      if (fs.existsSync('C:\\sc552_3')) setTimeout(() => sberManager.enqueueSettlement('3'), 6000);
    });
    setTimeout(() => {
      ensureShiftClosed('авто по расписанию', (ok) => {
        if (ok) { autoCloseDoneDate = today; logInfo('АВТОМАТИКА', 'Вечерний цикл завершён'); }
        else { autoCloseBlockedUntil = Date.now() + AUTO_RETRY_BACKOFF_MS; logWarn('АВТОМАТИКА', 'Авто-закрытие не удалось — повтор через 5 минут'); }
      });
    }, 15000);
  }
}, AUTO_TICK_MS);

// ==========================================
// ☁️ ОБРАБОТЧИКИ КОМАНД ИЗ ОБЛАКА
// ==========================================
cloudSocket.on('sber_pay', (data = {}, callback) => {
  const kId = String(data.kioskId || '1');
  const key = data.orderId || data.uuid || null;

  // 📓 Повтор запроса с тем же orderId → возвращаем сохранённый результат
  if (key && paymentJournal.has(key)) {
    logWarn(`СБЕР#${kId}`, `🔁 Повтор запроса оплаты ${key} — возвращаю сохранённый результат (двойное списание предотвращено)`);
    return safeAck(callback, 'sber_pay')(paymentJournal.get(key));
  }

  logInfo(`СБЕР#${kId}`, `📥 Запрос оплаты из облака: ${data.amount} руб.`);
  sberManager.enqueuePayment(kId, data.amount, (result) => {
    if (key) {
      paymentJournal.set(key, result);
      if (paymentJournal.size > PAYMENT_JOURNAL_MAX) {
        paymentJournal.delete(paymentJournal.keys().next().value);
      }
    }
    safeAck(callback, 'sber_pay')(result);
  });
});

cloudSocket.on('sber_settlement', (data = {}, callback) => {
  sberManager.enqueueSettlement(data.kioskId, safeAck(callback, 'sber_settlement'));
});

cloudSocket.on('cancel_sber_pay', (data = {}) => sberManager.cancelActivePayment(data.kioskId));

cloudSocket.on('atol_print', (body, callback) => {
  logInfo('АТОЛ', `📥 Запрос на печать чека из облака (${body && body.uuid ? body.uuid : 'без uuid'})`);
  receiptQueue.enqueue(body, safeAck(callback, 'atol_print'), false);
});

// ==========================================
// 🧪 ТЕСТОВЫЙ ЧЕК
// ==========================================
function printTestCheck() {
  logInfo('АТОЛ', '⌨️ Ручной тестовый чек...');
  receiptQueue.enqueue({
    uuid: `test_${Date.now()}`,
    request: [{
      type: 'sell', taxationType: 'usnIncome', operator: { name: 'Администратор' },
      items: [{ type: 'position', name: 'Тестовая печать', price: 10, quantity: 1, amount: 10, department: 1, paymentMethod: 'fullPayment', paymentObject: 'commodity', tax: { type: 'none' }, measurementUnit: 'piece' }],
      payments: [{ type: 'electronically', sum: 10 }], total: 10
    }]
  }, (res) => {
    if (res.success) { logInfo('АТОЛ', '🎉 Тестовый чек напечатан'); refreshShiftStatus('после теста', true); }
    else logError('АТОЛ', `💥 Сбой тестового чека [${res.errorCode || 'UNKNOWN'}]:`, res.error);
  }, false);
}

// ==========================================
// 🖥 GUI (панель + обработчики)
// ==========================================
const GUI_HTML = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Агент Деда Пицца</title>
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #064e3b; color: #fff; font-family: 'Segoe UI', sans-serif; height: 100vh; display: flex; flex-direction: column; gap: 14px; padding: 20px; user-select: none; overflow: hidden; }
    .glass { background: rgba(255,255,255,0.08); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.16); border-radius: 18px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 14px 22px; flex-shrink: 0; }
    .logo { width: 46px; height: 46px; border-radius: 50%; background: #eab308; display: flex; align-items: center; justify-content: center; font-size: 22px; }
    .title { font-size: 19px; font-weight: 800; color: #facc15; }
    .subtitle { font-size: 12px; opacity: 0.7; }
    .badges { display: flex; gap: 10px; flex-wrap: wrap; }
    .badge { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); padding: 8px 14px; border-radius: 12px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot-red { background: #ef4444; } .dot-green { background: #22c55e; } .dot-yellow { background: #eab308; } .dot-blue { background: #60a5fa; }
    .pulse { animation: p 1.5s infinite; }
    @keyframes p { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
    .controls-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; flex-shrink: 0; }
    .card { padding: 16px; text-align: center; }
    .card-icon { font-size: 30px; margin-bottom: 6px; }
    .card-title { font-size: 15px; font-weight: 800; color: #facc15; margin-bottom: 10px; }
    .terminal-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .btn-gold { background: #facc15; color: #064e3b; font-weight: 800; border: none; border-radius: 10px; padding: 10px 4px; font-size: 13px; cursor: pointer; }
    .btn-gold:hover { background: #fde047; } .btn-gold:active { transform: scale(0.96); }
    .console-panel { flex-grow: 1; display: flex; flex-direction: column; padding: 14px 18px; min-height: 0; }
    .console-title { font-size: 12px; font-weight: 800; color: #a7f3d0; letter-spacing: 1px; margin-bottom: 8px; }
    .logbox { flex: 1; overflow-y: auto; font-family: Consolas, monospace; font-size: 12px; line-height: 1.55; background: rgba(0,0,0,0.28); border-radius: 12px; padding: 10px 12px; }
    .line { white-space: pre-wrap; word-break: break-word; }
    .line .t { color: #6ee7b7; opacity: 0.75; }
    .line.info { color: #d1fae5; } .line.warn { color: #fde047; } .line.error { color: #fca5a5; } .line.debug { color: #93c5fd; }
  </style>
</head>
<body>
  <div class="header glass">
    <div style="display:flex; align-items:center; gap:14px;">
      <div class="logo">🍕</div>
      <div>
        <div class="title">АГЕНТ «ДЕДА ПИЦЦА»</div>
        <div class="subtitle">АТОЛ + Сбер-эквайринг • quok.art</div>
      </div>
    </div>
    <div class="badges">
      <div class="badge"><span class="dot dot-yellow pulse" id="dotCloud"></span><span id="txtCloud">Облако…</span></div>
      <div class="badge"><span class="dot dot-yellow pulse" id="dotShift"></span><span id="txtShift">Смена…</span></div>
      <div class="badge"><span class="dot dot-blue" id="dotQueue"></span><span id="txtQueue">Чеков: 0</span></div>
    </div>
  </div>

  <div class="controls-grid">
    <div class="card glass">
      <div class="card-icon">🧾</div>
      <div class="card-title">КАССА АТОЛ</div>
      <div class="terminal-buttons">
        <button class="btn-gold" onclick="emit('gui_test_check')">Тест-чек</button>
        <button class="btn-gold" onclick="emit('gui_open_shift')">Открыть</button>
        <button class="btn-gold" onclick="emit('gui_close_shift')">Закрыть</button>
      </div>
    </div>
    <div class="card glass">
      <div class="card-icon">💳</div>
      <div class="card-title">СБЕР • СВЕРКА</div>
      <div class="terminal-buttons">
        <button class="btn-gold" onclick="emit('gui_sber_settlement', 1)">Терминал 1</button>
        <button class="btn-gold" onclick="emit('gui_sber_settlement', 2)">Терминал 2</button>
        <button class="btn-gold" onclick="emit('gui_sber_settlement', 3)">Терминал 3</button>
      </div>
    </div>
    <div class="card glass">
      <div class="card-icon">🛠️</div>
      <div class="card-title">ОЧЕРЕДЬ ЧЕКОВ</div>
      <div class="terminal-buttons">
        <button class="btn-gold" onclick="emit('gui_retry_stuck')">Повтор (S)</button>
        <button class="btn-gold" onclick="emit('gui_clear_queue')">Очистить</button>
        <button class="btn-gold" onclick="document.getElementById('logbox').innerHTML=''">Лог</button>
      </div>
    </div>
  </div>

  <div class="console-panel glass">
    <div class="console-title">СИСТЕМНЫЙ ЛОГ</div>
    <div class="logbox" id="logbox"></div>
  </div>

<script>
  var socket = io();
  var logbox = document.getElementById('logbox');
  function emit(ev, data) { socket.emit(ev, data); }
  function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  socket.on('agent_log', function (d) {
    var div = document.createElement('div');
    div.className = 'line ' + (d.level || 'info');
    div.innerHTML = '<span class="t">' + d.time + '</span> ' + escapeHtml(d.text);
    logbox.appendChild(div);
    while (logbox.childNodes.length > 400) logbox.removeChild(logbox.firstChild);
    logbox.scrollTop = logbox.scrollHeight;
  });
  socket.on('cloud_status', function (ok) {
    document.getElementById('dotCloud').className = 'dot ' + (ok ? 'dot-green' : 'dot-red pulse');
    document.getElementById('txtCloud').textContent = ok ? 'Облако: онлайн' : 'Облако: офлайн';
  });
  socket.on('shift_status', function (s) {
    var color = s.state === 'opened' ? 'dot-green' : (s.state === 'closed' ? 'dot-red' : 'dot-yellow pulse');
    document.getElementById('dotShift').className = 'dot ' + color;
    document.getElementById('txtShift').textContent = 'Смена: ' + (s.text || '…');
  });
  socket.on('queue_status', function (q) {
    document.getElementById('txtQueue').textContent = 'Чеков: ' + (q.pending || 0) + (q.stuck ? ' | stuck: ' + q.stuck : '');
  });
</script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(GUI_HTML));

httpServer.listen(LOCAL_GUI_PORT, () => logInfo('GUI', `🖥 Панель агента: http://localhost:${LOCAL_GUI_PORT}`));
httpServer.on('error', (e) => logError('GUI', `Не удалось занять порт ${LOCAL_GUI_PORT}: ${e.message}`));

localIo.on('connection', (socket) => {
  logInfo('GUI', `Панель подключилась (${socket.id})`);
  socket.emit('cloud_status', !!(cloudSocket && cloudSocket.connected));
  socket.emit('shift_status', shiftStatus);
  socket.emit('queue_status', { pending: receiptQueue.pendingCount(), stuck: receiptQueue.stuckCount() });

  socket.on('gui_test_check', () => printTestCheck());
  socket.on('gui_open_shift', () => ensureShiftOpened('панель'));
  socket.on('gui_close_shift', () => ensureShiftClosed('панель'));
  socket.on('gui_retry_stuck', () => receiptQueue.retryStuck());
  socket.on('gui_clear_queue', () => receiptQueue.clearQueue());
  socket.on('gui_sber_settlement', (kioskId) => {
    const kId = String(kioskId || '1');
    logInfo(`СБЕР#${kId}`, 'Ручная сверка итогов (панель)');
    sberManager.enqueueSettlement(kId, (r) => {
      if (r.success) logInfo(`СБЕР#${kId}`, '✅ Сверка завершена');
      else logError(`СБЕР#${kId}`, 'Сверка не удалась:', r.error);
    });
  });
  socket.on('disconnect', () => logDebug('GUI', 'Панель отключилась'));
});

// ==========================================
// ⌨️ ГОРЯЧИЕ КЛАВИШИ
// ==========================================
try {
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', (str, key) => {
      if (key && key.ctrl && key.name === 'c') { logWarn('АГЕНТ', 'Выход (Ctrl+C)'); process.exit(0); }
      
      const k = String(str || '').toLowerCase();
      
      // Управление очередью и АТОЛ:
      if (k === 's') receiptQueue.retryStuck();
      else if (k === 't') printTestCheck();
      else if (k === 'o') ensureShiftOpened('клавиша O');
      else if (k === 'c') ensureShiftClosed('клавиша C');
      else if (k === 'x') receiptQueue.clearQueue();
      
      // 💡 Сверка итогов СБЕРБАНКА по цифрам 1, 2 и 3:
      else if (k === '1') {
        logInfo('СБЕР#1', '⌨️ Ручной запуск сверки (клавиша 1)...');
        sberManager.enqueueSettlement('1', () => {});
      }
      else if (k === '2') {
        logInfo('СБЕР#2', '⌨️ Ручной запуск сверки (клавиша 2)...');
        sberManager.enqueueSettlement('2', () => {});
      }
      else if (k === '3') {
        logInfo('СБЕР#3', '⌨️ Ручной запуск сверки (клавиша 3)...');
        sberManager.enqueueSettlement('3', () => {});
      }
    });
    
    logInfo('АГЕНТ', '💡 Дополнительные клавиши: [1], [2], [3] — Сверка итогов Сбербанка');
  } else {
    logWarn('АГЕНТ', 'stdin не TTY — горячие клавиши отключены (используйте панель GUI)');
  }
} catch (e) { logWarn('АГЕНТ', 'Горячие клавиши недоступны:', e.message); }

// ==========================================
// 🚀 СТАРТ
// ==========================================
setInterval(() => refreshShiftStatus('плановая проверка'), STATUS_CHECK_MS); // тихая, раз в минуту
setTimeout(() => refreshShiftStatus('старт агента', true), 3000);

logInfo('АГЕНТ', '✅ Агент готов к работе. Приоритет: печать чеков.');
// ==========================================
// 🚀 СТАРТ
// ==========================================
setInterval(() => refreshShiftStatus('плановая проверка'), STATUS_CHECK_MS); // тихая, раз в минуту
setTimeout(() => refreshShiftStatus('старт агента', true), 3000);

logInfo('АГЕНТ', '✅ Агент готов к работе. Приоритет: печать чеков.');