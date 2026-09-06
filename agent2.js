// ==========================================================================
// 🤖 ЛОКАЛЬНЫЙ АГЕНТ "ДЕДА ПИЦЦА" — FINAL v4.0
//
// ГЛАВНЫЙ ПРИОРИТЕТ: ПЕЧАТЬ ЧЕКОВ. Всё остальное — тишина.
//
//  ✅ Проверка статуса смены: ровно ОДИН цикл по таймеру (60 сек),
//     без самозацикливания, пропускается если есть реальные чеки
//  ✅ Приоритетная очередь АТОЛ: чек > служебная проверка
//  ✅ Умная смена: не открыть дважды, просроченную закрыть→открыть,
//     закрытую не закрывать
//  ✅ Фиксы Сбербанка для нескольких терминалов (activeProcesses, блокировка пути)
//  ✅ Лог по умолчанию INFO — фоновые процессы НЕ пишут ничего
// ==========================================================================

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

const ATOL_CONNECTION_TYPE = 'COM';      // 'COM' | 'USB' | 'ETHERNET'
const ATOL_KKT_IP = '192.168.1.91';
const ATOL_KKT_PORT = '5555';
const ATOL_COM_PORT = 'COM3';

const SHIFT_CHECK_INTERVAL_MS = 60000;   // единственный цикл проверок смены — 1 раз в минуту

const executionDir = process.pkg
  ? path.dirname(process.execPath)
  : path.dirname(fileURLToPath(import.meta.url));

const QUEUE_FILE     = path.join(executionDir, 'receipts_queue.json');
const QUEUE_TMP_FILE = path.join(executionDir, 'receipts_queue.tmp.json');

const app = express();
const httpServer = createServer(app);
const localIo = new SocketIOServer(httpServer, { cors: { origin: "*" } });

const originalLog   = console.log;
const originalError = console.error;

let cloudSocket = null;

// =========================================================
// 📜 ЛОГГЕР (по умолчанию INFO — фон молчит)
// =========================================================
const LOG_LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const MIN_LOG_LEVEL = LOG_LEVELS.INFO;   // ← поставьте DEBUG только для диагностики
const LOG_FILE     = path.join(executionDir, 'agent_debug.log');
const MAX_LOG_SIZE = 8 * 1024 * 1024;

let logStream = null;
function getLogStream() {
  if (!logStream) {
    try { logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' }); }
    catch (e) { logStream = null; }
  }
  return logStream;
}

function fmtTs(d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function safeStr(v, max = 600) {
  try {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    let s;
    if (v instanceof Error) s = v.stack || (v.name + ': ' + v.message);
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    if (s.length > max) s = s.slice(0, max) + `…(+${s.length - max} симв.)`;
    return s.replace(/\r?\n/g, '\\n');
  } catch (e) { return '[unserializable]'; }
}

function logRaw(level, scope, message, meta) {
  try {
    if (LOG_LEVELS[level] < MIN_LOG_LEVEL) return;
    const metaStr = meta !== undefined ? ' | ' + safeStr(meta) : '';
    const line = `[${fmtTs()}] [${level.padEnd(5)}] [${scope}] ${message}${metaStr}`;
    (level === 'ERROR' ? originalError : originalLog)(line);

    const st = getLogStream();
    if (st) {
      st.write(line + '\n');
      try {
        const f = fs.statSync(LOG_FILE);
        if (f.size > MAX_LOG_SIZE) { st.end(); fs.renameSync(LOG_FILE, LOG_FILE + '.1'); logStream = null; }
      } catch (e) {}
    }

    if (localIo) localIo.emit('agent_log', {
      level: level.toLowerCase(),
      text: (message + metaStr).slice(0, 500),
      time: new Date().toLocaleTimeString('ru-RU')
    });
    if (cloudSocket && cloudSocket.connected) cloudSocket.emit('agent_remote_log', {
      level: level.toLowerCase(),
      text: (message + metaStr).slice(0, 500),
      time: new Date().toLocaleTimeString('ru-RU')
    });
  } catch (e) {}
}

const logDebug = (scope, msg, meta) => logRaw('DEBUG', scope, msg, meta);
const logInfo  = (scope, msg, meta) => logRaw('INFO',  scope, msg, meta);
const logWarn  = (scope, msg, meta) => logRaw('WARN',  scope, msg, meta);
const logError = (scope, msg, meta) => logRaw('ERROR', scope, msg, meta);

// Гарантия однократного вызова callback'ов
function onceFn(fn, scope, label) {
  let called = false;
  return (...args) => {
    if (called) { logWarn(scope, `Повторный вызов "${label}" проигнорирован`); return; }
    called = true;
    try { fn(...args); }
    catch (e) { logError(scope, `Исключение в callback "${label}": ${e.message}`, { stack: e.stack }); }
  };
}

console.log   = function (...args) { logInfo('CONSOLE', util.format(...args)); };
console.error = function (...args) { logError('CONSOLE', util.format(...args)); };

process.on('uncaughtException', (e) =>
  logError('КРАШ', 'Необработанное исключение (агент продолжает работу): ' + e.message, { stack: e.stack }));
process.on('unhandledRejection', (r) =>
  logWarn('КРАШ', 'Необработанный promise rejection: ' + safeStr(r)));

logInfo('СТАРТ', `======================================================`);
logInfo('СТАРТ', `🤖 АГЕНТ "ДЕДА ПИЦЦА" v4.0 FINAL ЗАПУЩЕН`);
logInfo('СТАРТ', `🌐 Облако: ${CLOUD_SERVER_URL}${SOCKET_PATH}`);
logInfo('СТАРТ', `🖨 АТОЛ: ${ATOL_CONNECTION_TYPE} (${ATOL_CONNECTION_TYPE === 'COM' ? ATOL_COM_PORT : ATOL_KKT_IP})`);
logInfo('СТАРТ', `💾 Лог: ${LOG_FILE} | Клавиши: [S] повтор чеков · [D] дамп состояния`);
logInfo('СТАРТ', `======================================================`);

// ==========================================
// ☁️ ОБЛАКО
// ==========================================
cloudSocket = ioClient(CLOUD_SERVER_URL, { path: SOCKET_PATH, reconnectionDelayMax: 5000 });

cloudSocket.on('connect', () => {
  logInfo('ОБЛАКО', `✅ Соединение установлено`);
  cloudSocket.emit('register_agent');
  localIo.emit('cloud_status', true);
});
cloudSocket.on('disconnect', (reason) => {
  logError('ОБЛАКО', `🚨 Связь потеряна (${reason})`);
  localIo.emit('cloud_status', false);
});
cloudSocket.on('connect_error', (err) => logWarn('ОБЛАКО', `Ошибка подключения: ${err.message}`));

// =========================================================
// ДЕКОДЕРЫ КОДИРОВОК
// =========================================================
function decodeWin1251(buffer) {
  const table = [0x0402,0x0403,0x201A,0x0453,0x201E,0x2026,0x2020,0x2021,0x20AC,0x2030,0x0409,0x2039,0x040A,0x040C,0x040B,0x040F,0x0452,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x0000,0x2122,0x0459,0x203A,0x045A,0x045C,0x045B,0x045F,0x00A0,0x040E,0x045E,0x0408,0x00A4,0x0490,0x00A6,0x00A7,0x0401,0x00A9,0x0404,0x00AB,0x00AC,0x00AD,0x00AE,0x0407,0x00B0,0x00B1,0x0406,0x0456,0x0491,0x00B5,0x00B6,0x00B7,0x0451,0x2116,0x0454,0x00BB,0x0458,0x0405,0x0455,0x0457];
  let res = '';
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    if (c < 128) res += String.fromCharCode(c);
    else if (c >= 128 && c <= 191) res += String.fromCharCode(table[c - 128]);
    else if (c >= 192 && c <= 255) res += String.fromCharCode(c + 0x0390);
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
    else if (c === 240) res += 'Ё'; else if (c === 241) res += 'ё'; else res += ' ';
  }
  return res;
}

// =========================================================
// 🏦 МЕНЕДЖЕР СБЕРБАНКА (параллельные терминалы, все фиксы)
// =========================================================
class SberQueueManager {
  constructor() {
    this.queues = {};
    this.isProcessing = {};
    this.activeProcesses = {};   // ✅ ФИКС №1
    this.pathHolder = {};
    this.warnedShared = {};
    this.opSeq = 0;
  }

  k(kioskId) { return String(kioskId ?? '1'); }

  resolveSberPath(kioskId) {
    const kId = this.k(kioskId);
    const candidates = [`C:\\sc552_${kId}`, `C:\\sc552`, `C:\\sc552_1`];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    logWarn(`СБЕР#${kId}`, `Папки Сбербанка не найдены, использую ${candidates[0]}`);
    return candidates[0];
  }

  snapshot(kId) { return (this.queues[kId] || []).map(t => t.type).join(', ') || '(пусто)'; }

  enqueuePayment(kioskId, amount, callback) {
    const kId = this.k(kioskId);
    if (!this.queues[kId]) { this.queues[kId] = []; this.isProcessing[kId] = false; }
    this.queues[kId].push({ type: 'pay', amount, callback, addedAt: Date.now() });
    logInfo(`СБЕР#${kId}`, `💳 Оплата ${amount} руб. в очереди [${this.snapshot(kId)}]`);
    this.processNext(kId);
  }

  enqueueSettlement(kioskId, callback) {
    const kId = this.k(kioskId);
    if (!this.queues[kId]) { this.queues[kId] = []; this.isProcessing[kId] = false; }
    this.queues[kId].push({ type: 'settlement', callback, addedAt: Date.now() });
    logInfo(`СБЕР#${kId}`, `🧾 Сверка в очереди [${this.snapshot(kId)}]`);
    this.processNext(kId);
  }

  processNext(kId) {
    if (this.isProcessing[kId]) return;
    const q = this.queues[kId];
    if (!q || q.length === 0) return;

    this.isProcessing[kId] = true;
    const task = q[0];

    const onComplete = onceFn((result) => {
      q.shift();
      this.isProcessing[kId] = false;
      logInfo(`СБЕР#${kId}`, `${result && result.success ? '✅' : '❌'} "${task.type}" завершено${result && !result.success ? ': ' + result.error : ''}. Осталось: ${q.length}`);
      try { if (task.callback) task.callback(result); }
      catch (e) { logError(`СБЕР#${kId}`, `Ошибка callback: ${e.message}`); }
      setTimeout(() => this.processNext(kId), 500);
    }, `СБЕР#${kId}`, 'onComplete');

    try {
      if (task.type === 'pay') this.executePayment(kId, task.amount, onComplete);
      else this.executeSettlement(kId, onComplete);
    } catch (e) {
      logError(`СБЕР#${kId}`, `Исключение при старте задачи: ${e.message}`, { stack: e.stack });
      onComplete({ success: false, error: 'Внутренняя ошибка очереди: ' + e.message });
    }
  }

  acquirePath(resolvedPath, opId, kId, grant) {
    const holder = this.pathHolder[resolvedPath];
    if (!holder) { this.pathHolder[resolvedPath] = opId; grant(); return; }
    if (!this.warnedShared[resolvedPath]) {
      this.warnedShared[resolvedPath] = true;
      logWarn('СБЕРБАНК', `⚠️ Несколько терминалов используют одну папку ${resolvedPath}! Операции пойдут последовательно. Создайте C:\\sc552_<N> для каждого киоска!`);
    }
    setTimeout(() => this.acquirePath(resolvedPath, opId, kId, grant), 400);
  }

  releasePath(resolvedPath, opId, kId) {
    if (this.pathHolder[resolvedPath] === opId) delete this.pathHolder[resolvedPath];
  }

  executePayment(kId, amount, done) {
    const opId = `PAY#${++this.opSeq}/T${kId}`;
    const t0 = Date.now();
    const finish = onceFn(done, `СБЕР#${kId}`, 'finish');

    const kopecks = Math.round(Number(amount) * 100);
    if (!Number.isFinite(kopecks) || kopecks <= 0) {
      logError(`СБЕР#${kId}`, `Некорректная сумма "${amount}"`);
      return finish({ success: false, error: `Некорректная сумма оплаты: ${amount}` });
    }

    const SBER_PATH = this.resolveSberPath(kId);
    logInfo(`СБЕР#${kId}`, `💳 ОПЛАТА ${amount} руб. | op=${opId}`);

    if (!fs.existsSync(SBER_PATH)) {
      logError(`СБЕР#${kId}`, `Папка ${SBER_PATH} не найдена!`);
      return finish({ success: false, error: `Папка ${SBER_PATH} не найдена` });
    }

    const exeFile = fs.existsSync(path.join(SBER_PATH, 'sb_pilot.exe')) ? 'sb_pilot.exe' : 'sb_kernel.exe';
    const command = `"${path.join(SBER_PATH, exeFile)}" 1 ${kopecks}`;

    ['e.txt', 'e', 'p.txt', 'p', 'commerr.log'].forEach(f => {
      try { fs.unlinkSync(path.join(SBER_PATH, f)); } catch (e) {}
    });

    this.acquirePath(SBER_PATH, opId, kId, () => {
      const child = exec(command, { cwd: SBER_PATH, timeout: 90000 }, (error, stdout) => {
        this.releasePath(SBER_PATH, opId, kId);
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        if (this.activeProcesses[kId] === child) delete this.activeProcesses[kId];

        try {
          if (error && error.killed) {
            logError(`СБЕР#${kId}`, `⏰ Таймаут оплаты 90 сек (${dt}s)`);
            try { exec(`taskkill /F /PID ${child.pid} /T`, () => {}); } catch (e) {}
            return finish({ success: false, error: 'Время ожидания оплаты истекло.' });
          }

          const resultFile = fs.existsSync(path.join(SBER_PATH, 'e')) ? path.join(SBER_PATH, 'e')
            : (fs.existsSync(path.join(SBER_PATH, 'e.txt')) ? path.join(SBER_PATH, 'e.txt') : null);
          const slipFile = fs.existsSync(path.join(SBER_PATH, 'p')) ? path.join(SBER_PATH, 'p') : null;

          if (resultFile) {
            const rawBuffer = fs.readFileSync(resultFile);
            let rawResult = decodeCP866(rawBuffer);
            if (rawResult.includes('??') || rawResult.includes('  ')) rawResult = decodeWin1251(rawBuffer);

            const firstLine = rawResult.split('\n')[0].trim();
            const [codeStr, ...msgParts] = firstLine.split(',');
            const resultCode = parseInt(codeStr.trim(), 10);
            const bankMessage = msgParts.join(',').trim() || 'Отказ';
            let bankSlip = '';
            if (slipFile) { try { bankSlip = decodeWin1251(fs.readFileSync(slipFile)); } catch (e) {} }

            if (resultCode === 0) {
              logInfo(`СБЕР#${kId}`, `✅ Оплата успешна (${dt}s)`);
              return finish({ success: true, slip: bankSlip });
            }
            logError(`СБЕР#${kId}`, `🚫 Отказ банка: ${bankMessage} (код ${resultCode})`);
            return finish({ success: false, error: `${bankMessage} (Код: ${resultCode})` });
          }

          logError(`СБЕР#${kId}`, `Файл результата не найден после завершения (${dt}s)`);
          finish({ success: false, error: 'Оплата отменена клиентом или терминалом' });
        } catch (e) {
          logError(`СБЕР#${kId}`, `Исключение разбора результата: ${e.message}`);
          finish({ success: false, error: 'Внутренняя ошибка обработки оплаты' });
        }
      });

      this.activeProcesses[kId] = child;
      child.on('spawn', () => logDebug(`СБЕР#${kId}`, `PID=${child.pid} (${opId})`));
    });
  }

  executeSettlement(kId, done) {
    const opId = `SETL#${++this.opSeq}/T${kId}`;
    const t0 = Date.now();
    const finish = onceFn(done, `СБЕР#${kId}`, 'settlementFinish');
    const SBER_PATH = this.resolveSberPath(kId);

    if (!fs.existsSync(SBER_PATH)) return finish({ success: false, error: 'Папка не найдена' });

    ['e.txt', 'e', 'p.txt', 'p'].forEach(f => { try { fs.unlinkSync(path.join(SBER_PATH, f)); } catch (e) {} });
    const exeFile = fs.existsSync(path.join(SBER_PATH, 'sb_pilot.exe')) ? 'sb_pilot.exe' : 'sb_kernel.exe';
    logInfo(`СБЕР#${kId}`, `🧾 Сверка итогов (${opId})...`);

    this.acquirePath(SBER_PATH, opId, kId, () => {
      exec(`"${path.join(SBER_PATH, exeFile)}" 7`, { cwd: SBER_PATH, timeout: 120000 }, () => {
        this.releasePath(SBER_PATH, opId, kId);
        try {
          const resultFile = fs.existsSync(path.join(SBER_PATH, 'e')) ? path.join(SBER_PATH, 'e')
            : (fs.existsSync(path.join(SBER_PATH, 'e.txt')) ? path.join(SBER_PATH, 'e.txt') : null);
          if (resultFile) {
            const buf = fs.readFileSync(resultFile);
            let rawResult = decodeCP866(buf);
            if (rawResult.includes('??') || rawResult.includes('  ')) rawResult = decodeWin1251(buf);
            const [codeStr, ...msgParts] = rawResult.split('\n')[0].trim().split(',');
            if (parseInt(codeStr, 10) === 0) {
              logInfo(`СБЕР#${kId}`, `✅ Сверка завершена (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
              return finish({ success: true });
            }
            return finish({ success: false, error: msgParts.join(',') });
          }
        } catch (e) { logError(`СБЕР#${kId}`, `Ошибка разбора сверки: ${e.message}`); }
        finish({ success: false, error: 'Таймаут сверки.' });
      });
    });
  }

  cancelActivePayment(kioskId) {
    const kId = this.k(kioskId);
    const child = this.activeProcesses[kId];
    if (child && child.pid) {
      logWarn(`СБЕР#${kId}`, `🛑 Отмена оплаты: kill PID ${child.pid}`);
      try { exec(`taskkill /F /PID ${child.pid} /T`, () => {}); } catch (e) {}
    } else {
      logWarn(`СБЕР#${kId}`, `Отмена: активного процесса нет`);
    }
  }

  dumpState() {
    Object.keys(this.queues).forEach(kId => {
      logInfo(`СБЕР#${kId}`, `📊 очередь=[${this.snapshot(kId)}], занята=${!!this.isProcessing[kId]}, PID=${(this.activeProcesses[kId] && this.activeProcesses[kId].pid) || '-'}`);
    });
  }
}

const sberManager = new SberQueueManager();

cloudSocket.on('cancel_sber_pay', (data = {}) => sberManager.cancelActivePayment(data.kioskId));

cloudSocket.on('sber_pay', (payload = {}, callback) => {
  const kId = sberManager.k(payload.kioskId);
  logInfo(`СБЕР#${kId}`, `📨 sber_pay из облака: ${payload.amount} руб.`);
  sberManager.enqueuePayment(payload.kioskId, payload.amount, onceFn((result) => {
    if (typeof callback === 'function') { try { callback(result); } catch (e) {} }
    else logWarn(`СБЕР#${kId}`, `ack недоступен — облако не получит ответ`);
  }, `СБЕР#${kId}`, 'ackToCloud'));
});

cloudSocket.on('sber_settlement', ({ kioskId } = {}, callback) => {
  const kId = sberManager.k(kioskId);
  logInfo(`СБЕР#${kId}`, `📨 sber_settlement из облака`);
  sberManager.enqueueSettlement(kioskId, onceFn((result) => {
    if (typeof callback === 'function') { try { callback(result); } catch (e) {} }
  }, `СБЕР#${kId}`, 'settleAck'));
});

// =========================================================================
// 🖨 ОЧЕРЕДЬ ЧЕКОВ АТОЛ v4 — ПРИОРИТЕТ ЧЕКАМ, НОЛЬ ЦИКЛОВ
// =========================================================================
let currentShiftStatus = { text: 'Проверка...', dotColor: 'dot-yellow pulse', state: 'unknown', number: 0 };

class PersistentReceiptQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.callbacks = new Map();
    this._lastBusyLog = 0;
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
        this.queue = JSON.parse(raw) || [];
        this.queue.forEach(q => { if (!q.status) q.status = 'pending'; });
        const pend  = this.queue.filter(q => q.status === 'pending').length;
        const stuck = this.queue.filter(q => q.status === 'stuck').length;
        if (this.queue.length) logInfo('АТОЛ', `📂 Очередь с диска: всего=${this.queue.length}, pending=${pend}, stuck=${stuck}`);
      }
    } catch (e) {
      logError('АТОЛ', `Ошибка чтения очереди: ${e.message}`);
      this.queue = [];
    }
  }

  saveToDisk() {
    try {
      fs.writeFileSync(QUEUE_TMP_FILE, JSON.stringify(this.queue.filter(q => !q.isEphemeral), null, 2), 'utf8');
      fs.renameSync(QUEUE_TMP_FILE, QUEUE_FILE);
    } catch (e) { logError('АТОЛ', `Ошибка сохранения очереди: ${e.message}`); }
    this.notifyQueueLength();
  }

  notifyQueueLength() {
    const pendingCount = this.queue.filter(q => !q.isEphemeral && q.status === 'pending').length;
    const stuckCount   = this.queue.filter(q => !q.isEphemeral && q.status === 'stuck').length;
    if (localIo) localIo.emit('queue_status', { pending: pendingCount, stuck: stuckCount });
  }

  clearQueue() {
    this.callbacks.clear();
    this.queue = [];
    this.isProcessing = false;
    this.saveToDisk();
    logWarn('АТОЛ', `🗑 Очередь очищена!`);
  }

  retryStuck() {
    let count = 0;
    this.queue.forEach(q => { if (q.status === 'stuck') { q.status = 'pending'; q.attempts = 0; count++; } });
    if (count > 0) {
      logWarn('АТОЛ', `🔄 Перезапуск ${count} застрявших чеков...`);
      this.saveToDisk();
      this.processQueue();
    } else {
      logInfo('АТОЛ', `✅ Застрявших чеков нет.`);
    }
  }

  enqueue(body, callback = null, isEphemeral = false) {
    const taskId = body.uuid || `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const existing = this.queue.find(q => q.taskId === taskId && (q.status === 'pending' || q.status === 'stuck'));
    if (existing) {
      logDebug('АТОЛ', `Дубликат ${taskId} — обновлён только callback`);
      if (callback) this.callbacks.set(taskId, callback);
      return taskId;
    }

    if (callback) this.callbacks.set(taskId, callback);
    this.queue.push({ taskId, body, addedAt: new Date().toISOString(), attempts: 0, isEphemeral, status: 'pending' });

    // ✅ Служебные задачи (проверки статуса) пишутся только в DEBUG — не спамят
    if (isEphemeral) logDebug('АТОЛ', `+ служебная задача ${taskId}`);
    else logInfo('АТОЛ', `➕ ЧЕК ${taskId} добавлен в очередь. Всего: ${this.queue.filter(q => !q.isEphemeral && q.status === 'pending').length + 1}`);

    if (!isEphemeral) this.saveToDisk();
    this.processQueue();
    return taskId;
  }

  // ✅ ПРИОРИТЕТ: сначала настоящие чеки, служебные проверки — в последнюю очередь
  getNextTask() {
    return this.queue.find(q => q.status === 'pending' && !q.isEphemeral)
        || this.queue.find(q => q.status === 'pending');
  }

  async processQueue() {
    if (this.isProcessing) {
      const now = Date.now();
      if (now - this._lastBusyLog > 5000) {   // анти-спам: не чаще 1 раза в 5 сек
        logDebug('АТОЛ', 'Очередь занята');
        this._lastBusyLog = now;
      }
      return;
    }

    const currentItem = this.getNextTask();
    if (!currentItem) return;

    this.isProcessing = true;

    if (!currentItem.isEphemeral) {
      logInfo('АТОЛ', `🖨 Печать чека (${currentItem.taskId}), попытка ${currentItem.attempts + 1}...`);
    }

    this.executePrint(currentItem.body, (result) => {
      const cb = this.callbacks.get(currentItem.taskId);
      if (cb) { try { cb(result); } catch (e) { logError('АТОЛ', `Ошибка callback: ${e.message}`); } }
      this.callbacks.delete(currentItem.taskId);

      if (result.success) {
        if (!currentItem.isEphemeral) logInfo('АТОЛ', `🎉 Чек ${currentItem.taskId} напечатан!`);
        this.queue = this.queue.filter(q => q.taskId !== currentItem.taskId);
        this.saveToDisk();

        setTimeout(() => {
          this.isProcessing = false;
          // ✅ АНТИ-ЦИКЛ: после служебной задачи статус НЕ запрашиваем снова.
          // После реального чека — ОДНА отложенная проверка (debounce-защищённая).
          if (!currentItem.isEphemeral) scheduleShiftCheck(2000, 'после чека');
          this.processQueue();
        }, 400);

      } else {
        if (currentItem.isEphemeral) {
          logDebug('АТОЛ', `Служебная задача снята: ${result.error}`);
          this.queue = this.queue.filter(q => q.taskId !== currentItem.taskId);
          setTimeout(() => { this.isProcessing = false; this.processQueue(); }, 400);
        } else {
          currentItem.attempts += 1;
          const isAutoTask = currentItem.taskId.startsWith('auto_') || currentItem.taskId.startsWith('test');

          if (isAutoTask && currentItem.attempts >= 3) {
            logWarn('АТОЛ', `Авто-задача ${currentItem.taskId} снята (3 неудачи)`);
            this.queue = this.queue.filter(q => q.taskId !== currentItem.taskId);
          } else {
            currentItem.status = 'stuck';
            logError('АТОЛ', `🚨 Сбой чека (${currentItem.taskId}): ${result.error}`);
            logWarn('АТОЛ', `⏸ Чек заморожен. Повтор — клавиша [S] или кнопка GUI.`);
          }

          this.saveToDisk();
          setTimeout(() => { this.isProcessing = false; this.processQueue(); }, 500);
        }
      }
    });
  }

  executePrint(body, callback) {
    try {
      const taskJson = body.request[0];
      const uniqueId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const jsonPath = path.join(os.tmpdir(), `atol_${uniqueId}.json`);
      const psPath   = path.join(os.tmpdir(), `atol_${uniqueId}.ps1`);
      fs.writeFileSync(jsonPath, JSON.stringify(taskJson), 'utf8');

      let connectionSettingsPs = '';
      if (ATOL_CONNECTION_TYPE === 'USB') {
        connectionSettingsPs = '$fptr.setSingleSetting("Model", "500")\n$fptr.setSingleSetting("Port", "27")';
      } else if (ATOL_CONNECTION_TYPE === 'COM') {
        connectionSettingsPs = '$fptr.setSingleSetting("Model", "500")\n$fptr.setSingleSetting("Port", "0")\n$fptr.setSingleSetting("ComFile", "' + ATOL_COM_PORT + '")\n$fptr.setSingleSetting("BaudRate", "115200")';
      } else {
        connectionSettingsPs = '$fptr.setSingleSetting("Model", "500")\n$fptr.setSingleSetting("Port", "2")\n$fptr.setSingleSetting("IPAddress", "' + ATOL_KKT_IP + '")\n$fptr.setSingleSetting("IPPort", "' + ATOL_KKT_PORT + '")';
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

      const t0 = Date.now();
      exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psPath}"`,
        { timeout: 120000, encoding: 'buffer' },
        (error, stdoutBuffer) => {
          const dt = ((Date.now() - t0) / 1000).toFixed(1);
          try { fs.unlinkSync(jsonPath); fs.unlinkSync(psPath); } catch (e) {}

          const stdout = stdoutBuffer ? stdoutBuffer.toString('utf8') : '';
          if (error && error.killed) {
            logError('АТОЛ', `⏰ Таймаут кассы 120 сек (${dt}s)`);
            return callback({ success: false, error: 'Таймаут кассы (120 сек).' });
          }

          const match = stdout.match(/B64_RESULT:(.*)/);
          if (match) {
            try {
              const result = JSON.parse(Buffer.from(match[1].trim(), 'base64').toString('utf8'));
              if (result.error) {
                logError('АТОЛ', `Ошибка кассы: ${result.error.description} (${dt}s)`);
                return callback({ success: false, error: result.error.description });
              }
              return callback({ success: true, fiscalData: result });
            } catch (e) {
              return callback({ success: false, error: 'Ошибка парсинга ответа кассы' });
            }
          }

          logError('АТОЛ', `Касса не вернула ответ (${dt}s)`);
          callback({ success: false, error: 'Касса не вернула ответ' });
        });
    } catch (e) {
      logError('АТОЛ', `Исключение подготовки печати: ${e.message}`);
      callback({ success: false, error: e.message });
    }
  }
}

const receiptQueue = new PersistentReceiptQueue();

// =========================================================
// 🕓 СТАТУС СМЕНЫ: ЕДИНСТВЕННЫЙ ЦИКЛ, БЕЗ ВОЗМОЖНОСТИ ЗациклИТЬСЯ
//
// Правила:
//  1. Максимум одна проверка одновременно (inFlight)
//  2. Максимум одна запланированная (shiftCheckTimer) — повторные
//     вызовы "сливаются" в одну
//  3. Если в очереди есть РЕАЛЬНЫЕ ЧЕКИ — проверка уступает им
//     и просто пропускается (следующий тик таймера попробует снова)
//  4. Изнутри обработки очереди проверка себя НЕ порождает
// =========================================================
let shiftCheckInFlight = false;
let shiftCheckTimer = null;
let _lastShiftStateLog = '';   // чтобы не писать одинаковую строку статуса подряд

function queueShiftStatusCheck(source = 'план') {

  // Правило 3: чеки важнее
  const hasRealWork = receiptQueue.queue.some(q => !q.isEphemeral && q.status === 'pending');
  if (hasRealWork) {
    logDebug('АТОЛ', `Проверка смены отложена — в очереди реальные чеки (${source})`);
    return;
  }
  if (shiftCheckInFlight) { logDebug('АТОЛ', `Проверка смены уже идёт (${source})`); return; }
  shiftCheckInFlight = true;

  const statusTask = {
    uuid: `status_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    request: [{ type: 'getShiftStatus' }]
  };

  receiptQueue.enqueue(statusTask, (res) => {
    shiftCheckInFlight = false;

    if (res.success && res.fiscalData && res.fiscalData.shiftStatus) {
      const { state, number } = res.fiscalData.shiftStatus;
      if (state === 'opened')      currentShiftStatus = { text: `Открыта (#${number})`, dotColor: 'dot-green', state, number };
      else if (state === 'closed') currentShiftStatus = { text: 'Закрыта', dotColor: 'dot-red', state, number };
      else                         currentShiftStatus = { text: `Истекла (#${number})`, dotColor: 'dot-yellow pulse', state, number };

      // В консоль — только если статус ИЗМЕНИЛСЯ (нет повторов одинаковых строк)
      const signature = `${currentShiftStatus.text}`;
      if (signature !== _lastShiftStateLog) {
        logInfo('АТОЛ', `🔄 Смена: ${currentShiftStatus.text}`);
        _lastShiftStateLog = signature;
      } else {
        logDebug('АТОЛ', `Смена: ${currentShiftStatus.text} (без изменений)`);
      }
    } else {
      currentShiftStatus = { text: 'Нет связи', dotColor: 'dot-red', state: 'unknown', number: 0 };
      if (_lastShiftStateLog !== 'Нет связи') {
        logWarn('АТОЛ', `🔄 Смена: нет связи с кассой`);
        _lastShiftStateLog = 'Нет связи';
      }
    }
    if (localIo) localIo.emit('shift_status', currentShiftStatus);
  }, true);
}

// Слияние частых запросов в одну проверку (debounce)
function scheduleShiftCheck(delayMs = 0, source = 'план') {
  if (shiftCheckTimer) return;   // уже запланирована — второй раз не планируем
  shiftCheckTimer = setTimeout(() => {
    shiftCheckTimer = null;
    queueShiftStatusCheck(source);
  }, delayMs);
}

// ⏱ ЕДИНСТВЕННЫЙ цикл проверок: раз в SHIFT_CHECK_INTERVAL_MS
setTimeout(() => scheduleShiftCheck(0, 'старт'), 5000);
setInterval(() => scheduleShiftCheck(0, 'план'), SHIFT_CHECK_INTERVAL_MS);

// =========================================================
// 🕓 УМНОЕ УПРАВЛЕНИЕ СМЕНОЙ
// =========================================================
function checkShiftStateOnce(callback) {
  const statusTask = {
    uuid: `statuschk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    request: [{ type: 'getShiftStatus' }]
  };
  receiptQueue.enqueue(statusTask, (res) => {
    if (res.success && res.fiscalData && res.fiscalData.shiftStatus) {
      const { state, number } = res.fiscalData.shiftStatus;
      callback({ ok: true, state, number });
    } else {
      callback({ ok: false, error: (res && res.error) || 'Нет связи с кассой' });
    }
  }, true);
}

function openShiftSmart(operatorName = 'Оператор', source = 'СМЕНА') {

  function doOpen() {
    logInfo(source, `☀️ Открываю смену (оператор: ${operatorName})...`);
    receiptQueue.enqueue(
      { uuid: `open_${source.toLowerCase()}_${Date.now()}`, request: [{ type: 'openShift', operator: { name: operatorName } }] },
      (res) => {
        if (res.success) logInfo(source, `🎉 Смена открыта!`);
        else logError(source, `💥 Не удалось открыть смену: ${res.error}`);
        scheduleShiftCheck(1500, 'после открытия');
      },
      false
    );
  }

  logInfo(source, `🔍 Проверяю состояние смены перед открытием...`);

  checkShiftStateOnce((info) => {
    if (!info.ok) {
      logError(source, `❌ Статус смены недоступен (${info.error}). Пробую открыть...`);
      return doOpen();
    }

    switch (info.state) {
      case 'opened':
        logInfo(source, `✅ Смена УЖЕ ОТКРЫТА (#${info.number}) — открытие не требуется.`);
        return;

      case 'expired':
        logWarn(source, `⚠️ Смена #${info.number} просрочена — закрываю (Z), затем открою новую...`);
        return receiptQueue.enqueue(
          { uuid: `reclose_${Date.now()}`, request: [{ type: 'closeShift', operator: { name: operatorName } }] },
          (res) => {
            if (res.success) logInfo(source, `✅ Просроченная смена закрыта.`);
            else logError(source, `❌ Не удалось закрыть просроченную: ${res.error}`);
            setTimeout(doOpen, 1000);
          },
          false
        );

      case 'closed':
        logInfo(source, `🔓 Смена закрыта — открываю новую...`);
        return doOpen();

      default:
        logWarn(source, `❓ Статус "${info.state}" — пытаюсь открыть...`);
        return doOpen();
    }
  });
}

function closeShiftSmart(operatorName = 'Оператор', source = 'СМЕНА') {
  logInfo(source, `🔍 Проверяю состояние смены перед закрытием...`);

  checkShiftStateOnce((info) => {
    if (!info.ok) {
      logError(source, `❌ Нет связи с кассой (${info.error}) — закрытие невозможно.`);
      currentShiftStatus = { text: 'Нет связи', dotColor: 'dot-red', state: 'unknown', number: 0 };
      if (localIo) localIo.emit('shift_status', currentShiftStatus);
      return;
    }
    if (info.state === 'closed') {
      logInfo(source, `ℹ️ Смена уже ЗАКРЫТА — закрытие не требуется.`);
      return;
    }
    logInfo(source, `🌙 Закрываю смену #${info.number}...`);
    receiptQueue.enqueue(
      { uuid: `close_${source.toLowerCase()}_${Date.now()}`, request: [{ type: 'closeShift', operator: { name: operatorName } }] },
      (res) => {
        if (res.success) logInfo(source, `🎉 Смена закрыта, Z-отчёт напечатан!`);
        else logError(source, `💥 Ошибка закрытия: ${res.error}`);
        scheduleShiftCheck(1500, 'после закрытия');
      },
      false
    );
  });
}

// ==========================================
// ☁️ ХЕНДЛЕРЫ ОБЛАКА: ПЕЧАТЬ ЧЕКОВ (главная задача!)
// ==========================================
cloudSocket.on('atol_print', (body, callback) => {
  logInfo('АТОЛ', `📨 ЧЕК из облака (uuid=${body && body.uuid})`);
  receiptQueue.enqueue(body, onceFn(callback || (() => {}), 'АТОЛ', 'atolPrintAck'), false);
});

function printTestCheck() {
  logInfo('АТОЛ', `⌨️ Тестовый чек...`);
  receiptQueue.enqueue({
    uuid: `test_${Date.now()}`,
    request: [{ type: 'sell', taxationType: 'usnIncome', operator: { name: 'Администратор' },
      items: [{ type: 'position', name: 'Тестовая печать', price: 10, quantity: 1, amount: 10, department: 1, paymentMethod: 'fullPayment', paymentObject: 'commodity', tax: { type: 'none' }, measurementUnit: 'piece' }],
      payments: [{ type: 'electronically', sum: 10 }], total: 10 }]
  }, (res) => {
    if (res.success) logInfo('АТОЛ', `🎉 Тестовый чек напечатан!`);
    else logError('АТОЛ', `💥 Сбой тестового чека: ${res.error}`);
  }, false);
}

receiptQueue.processQueue();

// =========================================================
// ⏰ АВТО-РАСПИСАНИЕ (локальная дата + умная смена)
// =========================================================
function todayLocal() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let lastAutoOpenDate = '';
let lastAutoCloseDate = '';

setInterval(() => {
  const now = new Date();
  const todayStr = todayLocal();
  const hours = now.getHours();

  if (hours >= 10 && hours < 18 && lastAutoOpenDate !== todayStr) {
    lastAutoOpenDate = todayStr;
    logInfo('АВТОМАТИКА', `☀️ Рабочее время — проверяю смену...`);
    openShiftSmart('Автоматика', 'АВТО');
  }

  if (hours >= 19 && lastAutoCloseDate !== todayStr) {
    lastAutoCloseDate = todayStr;
    logInfo('АВТОМАТИКА', `🌙 Вечерняя сверка Сбербанка...`);

    sberManager.enqueueSettlement('1', () => {
      if (fs.existsSync('C:\\sc552_2')) setTimeout(() => { logInfo('АВТОМАТИКА', `🧾 Сверка терминала #2`); sberManager.enqueueSettlement('2'); }, 3000);
      if (fs.existsSync('C:\\sc552_3')) setTimeout(() => { logInfo('АВТОМАТИКА', `🧾 Сверка терминала #3`); sberManager.enqueueSettlement('3'); }, 6000);
    });

    setTimeout(() => {
      logInfo('АВТОМАТИКА', `🖨 Вечернее закрытие смены АТОЛ...`);
      closeShiftSmart('Автоматика', 'АВТО');
    }, 15000);
  }
}, 30000);

// =========================================================
// 🖥 ЛОКАЛЬНЫЙ GUI
// =========================================================
const GUI_HTML = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Агент Деда Пицца</title>
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #064e3b; color: #fff; font-family: sans-serif; height: 100vh; display: flex; flex-direction: column; gap: 16px; padding: 24px; user-select: none; overflow: hidden; }
    .glass { background: rgba(255,255,255,0.08); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.16); border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; flex-shrink: 0; }
    .logo { width: 48px; height: 48px; border-radius: 50%; background: #eab308; color: #064e3b; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 900; }
    .title { font-size: 20px; font-weight: 800; color: #facc15; }
    .badges { display: flex; gap: 10px; }
    .badge { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); padding: 8px 16px; border-radius: 12px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot-red { background: #ef4444; } .dot-green { background: #22c55e; } .dot-yellow { background: #eab308; } .pulse { animation: p 1.5s infinite; }
    @keyframes p { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.9); } }
    .controls-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; flex-shrink: 0; }
    .card { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .card-icon { font-size: 36px; margin-bottom: 8px; }
    .card-title { font-size: 18px; font-weight: 800; color: #facc15; margin-bottom: 4px; }
    .btn-row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; width: 100%; margin-top: 10px; }
    .terminal-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 100%; }
    .btn-gold { background: #facc15; color: #064e3b; font-weight: 800; border: none; border-radius: 10px; padding: 10px 4px; font-size: 13px; cursor: pointer; }
    .btn-gold:hover { background: #fde047; } .btn-gold:active { transform: scale(0.96); }
    .btn-red { background: #f87171 !important; color: #450a0a !important; }
    .btn-dark { background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.25); border-radius: 10px; padding: 8px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .btn-dark:hover { background: rgba(255,255,255,0.2); }
    .console-panel { flex-grow: 1; display: flex; flex-direction: column; padding: 16px 20px; min-height: 0; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .panel-title { font-size: 14px; font-weight: 800; color: #facc15; }
    .panel-hint { font-size: 11px; opacity: 0.7; }
    .logs-box { flex-grow: 1; overflow-y: auto; background: rgba(0,0,0,0.35); border-radius: 12px; padding: 12px; font-family: Consolas, 'Courier New', monospace; font-size: 12px; line-height: 1.45; display: flex; flex-direction: column; gap: 2px; }
    .log-line { white-space: pre-wrap; word-break: break-word; }
    .log-time { color: #6ee7b7; margin-right: 6px; }
    .lv-info { color: #d1fae5; } .lv-error { color: #fecaca; } .lv-warn { color: #fde68a; } .lv-debug { color: #c7d2fe; }
    .footer-hint { flex-shrink: 0; font-size: 11px; opacity: 0.7; text-align: center; }
  </style>
</head>
<body>
  <div class="glass header">
    <div style="display:flex;align-items:center;gap:14px;">
      <div class="logo">🍕</div>
      <div class="title">Агент «Деда Пицца» v4.0</div>
    </div>
    <div class="badges">
      <div class="badge"><span class="dot dot-red" id="cloudDot"></span><span id="cloudText">Облако: ...</span></div>
      <div class="badge"><span class="dot dot-yellow pulse" id="shiftDot"></span><span id="shiftText">Смена: ...</span></div>
      <div class="badge">🖨 <span id="queueText">Чеки: ...</span></div>
    </div>
  </div>

  <div class="controls-grid">
    <div class="glass card">
      <div class="card-icon">🖨</div>
      <div class="card-title">Касса АТОЛ</div>
      <div class="btn-row">
        <button class="btn-gold" onclick="fnTest()">Тестовый чек</button>
        <button class="btn-gold" onclick="fnOpenShift()">Открыть смену</button>
        <button class="btn-gold" onclick="fnCloseShift()">Закрыть смену</button>
      </div>
      <div class="btn-row">
        <button class="btn-dark" onclick="fnRetry()">🔁 Повторить застрявшие [S]</button>
        <button class="btn-dark" onclick="fnClear()">🗑 Очистить очередь</button>
      </div>
    </div>

    <div class="glass card">
      <div class="card-icon">💳</div>
      <div class="card-title">Сбербанк — терминалы</div>
      <div class="terminal-buttons" style="margin-top:10px;">
        <button class="btn-gold" onclick="fnSettle(1)">Сверка #1</button>
        <button class="btn-gold" onclick="fnSettle(2)">Сверка #2</button>
        <button class="btn-gold" onclick="fnSettle(3)">Сверка #3</button>
        <button class="btn-gold btn-red" onclick="fnCancel(1)">Отмена #1</button>
        <button class="btn-gold btn-red" onclick="fnCancel(2)">Отмена #2</button>
        <button class="btn-gold btn-red" onclick="fnCancel(3)">Отмена #3</button>
      </div>
    </div>
  </div>

  <div class="glass console-panel">
    <div class="panel-head">
      <div class="panel-title">📜 Живой лог агента</div>
      <div class="panel-hint">[S] повтор застрявших · [D] дамп · файл: agent_debug.log</div>
    </div>
    <div class="logs-box" id="logs"></div>
  </div>

  <div class="footer-hint">Локальная панель агента · порт ${LOCAL_GUI_PORT}</div>

  <script>
    var socket = io();
    var logsBox = document.getElementById('logs');
    var MAX_LINES = 400;

    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function addLog(l) {
      var d = document.createElement('div');
      d.className = 'log-line lv-' + (l.level || 'info');
      d.innerHTML = '<span class="log-time">' + escapeHtml(l.time || '') + '</span>' + escapeHtml(l.text || '');
      logsBox.appendChild(d);
      while (logsBox.childNodes.length > MAX_LINES) logsBox.removeChild(logsBox.firstChild);
      logsBox.scrollTop = logsBox.scrollHeight;
    }

    function setDot(dotId, cls, textId, txt) {
      document.getElementById(dotId).className = 'dot ' + cls;
      document.getElementById(textId).textContent = txt;
    }

    socket.on('agent_log', addLog);
    socket.on('cloud_status', function (ok) {
      setDot('cloudDot', ok ? 'dot-green' : 'dot-red', 'cloudText', ok ? 'Облако: онлайн' : 'Облако: офлайн');
    });
    socket.on('shift_status', function (s) {
      document.getElementById('shiftText').textContent = 'Смена: ' + s.text;
      document.getElementById('shiftDot').className = 'dot ' + s.dotColor;
    });
    socket.on('queue_status', function (q) {
      document.getElementById('queueText').textContent =
        'Чеки: ' + q.pending + ' в ожидании / ' + q.stuck + ' застряло';
    });

    function emit(ev, d) { socket.emit(ev, d || {}); }
    function fnTest()       { emit('test_check'); }
    function fnOpenShift()  { emit('open_shift'); }
    function fnCloseShift() { emit('close_shift'); }
    function fnRetry()      { emit('retry_stuck'); }
    function fnClear()      { emit('clear_queue'); }
    function fnSettle(k)    { emit('sber_settlement_local', { kioskId: k }); }
    function fnCancel(k)    { emit('cancel_sber_local', { kioskId: k }); }
  <\/script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(GUI_HTML));

localIo.on('connection', (socket) => {
  logInfo('GUI', `🖥 Клиент подключился (${socket.id})`);
  socket.emit('cloud_status', !!(cloudSocket && cloudSocket.connected));
  socket.emit('shift_status', currentShiftStatus);
  receiptQueue.notifyQueueLength();

  socket.on('test_check',  () => printTestCheck());
  socket.on('clear_queue', () => receiptQueue.clearQueue());
  socket.on('retry_stuck', () => receiptQueue.retryStuck());

  socket.on('open_shift', () => {
    logInfo('GUI', `☀️ Ручное открытие смены...`);
    openShiftSmart('Оператор GUI', 'GUI');
  });

  socket.on('close_shift', () => {
    logInfo('GUI', `🌙 Ручное закрытие смены...`);
    closeShiftSmart('Оператор GUI', 'GUI');
  });

  socket.on('sber_settlement_local', ({ kioskId } = {}) => {
    const kId = sberManager.k(kioskId);
    logInfo('GUI', `🧾 Ручная сверка терминала #${kId}`);
    sberManager.enqueueSettlement(kId, (res) => logInfo('GUI', `Сверка #${kId}: ${res.success ? '✅' : '❌ ' + res.error}`));
  });

  socket.on('cancel_sber_local', ({ kioskId } = {}) => {
    logInfo('GUI', `🛑 Отмена оплаты терминала #${sberManager.k(kioskId)}`);
    sberManager.cancelActivePayment(kioskId);
  });
});

try {
  httpServer.listen(LOCAL_GUI_PORT, () => logInfo('GUI', `🖥 Панель: http://localhost:${LOCAL_GUI_PORT}`));
  httpServer.on('error', (e) => logError('GUI', `Порт ${LOCAL_GUI_PORT}: ${e.message}`));
} catch (e) {
  logError('GUI', `Ошибка веб-сервера: ${e.message}`);
}

// =========================================================
// ⌨️ КЛАВИШИ И ДИАГНОСТИКА
// =========================================================
function dumpAllState() {
  logInfo('ДИАГНОСТИКА', '========== ДАМП СОСТОЯНИЯ ==========');
  sberManager.dumpState();
  logInfo('АТОЛ', `Чеки: ${JSON.stringify(receiptQueue.queue.map(q => ({ id: q.taskId, status: q.status, attempts: q.attempts })))}`);
  logInfo('АТОЛ', `isProcessing=${receiptQueue.isProcessing} | Смена: ${currentShiftStatus.text} | Облако: ${(cloudSocket && cloudSocket.connected) ? 'онлайн' : 'офлайн'} | ПроверкаСменыИдёт=${shiftCheckInFlight}`);
  logInfo('ДИАГНОСТИКА', '====================================');
}

try {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); }
  process.stdin.on('keypress', (ch, key) => {
    if (!key) return;
    const name = (key.name || '').toLowerCase();
    if (key.ctrl && name === 'c') process.exit(0);
    if (name === 's') { logWarn('КЛАВИАТУРА', '[S] перезапуск застрявших чеков'); receiptQueue.retryStuck(); }
    if (name === 'd') { logInfo('КЛАВИАТУРА', '[D] дамп состояния'); dumpAllState(); }
  });
} catch (e) {}

// Пульс — ТОЛЬКО в DEBUG (в штатном режиме не пишет ничего)
setInterval(() => {
  const sberPart = Object.keys(sberManager.queues)
    .map(k => `#${k}:${(sberManager.queues[k] || []).length}`).join(' ') || '-';
  const pend = receiptQueue.queue.filter(q => q.status === 'pending' && !q.isEphemeral).length;
  const stuck = receiptQueue.queue.filter(q => q.status === 'stuck').length;
  logDebug('ПУЛЬС', `alive | СБЕР: ${sberPart} | Чеки: ${pend} pending / ${stuck} stuck | Облако: ${(cloudSocket && cloudSocket.connected) ? '✅' : '❌'}`);
}, 60000);