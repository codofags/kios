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

// =========================================================
// 🛡 ЗАЩИТА ОТ ПАДЕНИЙ (ANTI-CRASH GUARD)
// =========================================================
process.on('uncaughtException', (err) => {
  console.error('💥 [ПЕРЕХВАЧЕНА ОШИБКА]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 [НЕОБРАБОТАННЫЙ ПРОМИС]:', reason?.message || reason);
});

// =========================================================
// ⚡️ ОТКЛЮЧЕНИЕ СПЯЩЕГО РЕЖИМА WINDOWS И USB
// =========================================================
function disableWindowsSleep() {
  try {
    exec('powercfg /change standby-timeout-ac 0', () => {});
    exec('powercfg /change hibernate-timeout-ac 0', () => {});
    exec('powercfg /change monitor-timeout-ac 0', () => {});
    exec('powercfg /SETACVALUEINDEX SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba4d5a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0', () => {});
    exec('powercfg /SETACTIVE SCHEME_CURRENT', () => {});
    exec('w32tm /resync', () => {});
    console.log('⚡ [ПИТАНИЕ] Спящий режим Windows и энергосбережение USB заблокированы!');
  } catch (e) {}
}
disableWindowsSleep();

// =========================================================
// 💾 НАДЁЖНЫЙ ТРАНЗАКЦИОННЫЙ ДВИЖОК ХРАНЕНИЯ (БЕЗ C++ И СБОЕВ)
// =========================================================
const executionDir = process.pkg 
  ? path.dirname(process.execPath) 
  : path.dirname(fileURLToPath(import.meta.url));

const DB_FILE = path.join(executionDir, 'pizzeria_db.json');
const DB_TMP_FILE = path.join(executionDir, 'pizzeria_db.tmp');

class CrashResilientDB {
  constructor() {
    this.data = {
      print_queue: [],
      sber_transactions: []
    };
    this.init();
  }

  save() {
    try {
      const payload = JSON.stringify(this.data, null, 2);
      const fd = fs.openSync(DB_TMP_FILE, 'w');
      fs.writeSync(fd, payload, 0, 'utf8');
      fs.fsyncSync(fd); // Сбрасываем физический буфер диска
      fs.closeSync(fd);
      fs.renameSync(DB_TMP_FILE, DB_FILE); // Атомарная замена файла
    } catch (e) {
      console.error('🚨 [DB] Ошибка сохранения базы:', e.message);
    }
  }

  init() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(raw);
        console.log(`💾 [БАЗА ДАННЫХ] Загружена: ${DB_FILE}`);
      } else {
        this.save();
        console.log(`💾 [БАЗА ДАННЫХ] Создана новая база: ${DB_FILE}`);
      }
    } catch (e) {
      console.warn('⚠️ [БАЗА ДАННЫХ] Ошибка чтения, создаем новую:', e.message);
      this.save();
    }
    this.recoverAfterCrash();
  }

  recoverAfterCrash() {
    this.data.print_queue = this.data.print_queue.filter(q => !q.isEphemeral);
    this.data.print_queue.forEach(q => {
      if (q.status === 'printing') q.status = 'pending';
    });
    this.save();
  }

  addPrintTask(taskId, body, isEphemeral = false) {
    this.data.print_queue = this.data.print_queue.filter(q => q.taskId !== taskId);
    this.data.print_queue.push({
      taskId,
      body,
      status: 'pending',
      attempts: 0,
      isEphemeral,
      createdAt: new Date().toISOString()
    });
    if (!isEphemeral) this.save();
  }

  getNextPendingPrintTask() {
    return this.data.print_queue.find(q => q.status === 'pending') || null;
  }

  markPrintSuccess(taskId) {
    this.data.print_queue = this.data.print_queue.filter(q => q.taskId !== taskId);
    this.save();
  }

  markPrintFailed(taskId, error) {
    const task = this.data.print_queue.find(q => q.taskId === taskId);
    if (task) {
      task.status = 'stuck';
      task.attempts += 1;
      task.lastError = String(error);
      this.save();
    }
  }

  deletePrintTask(taskId) {
    this.data.print_queue = this.data.print_queue.filter(q => q.taskId !== taskId);
    this.save();
  }

  retryStuckPrintTasks() {
    let count = 0;
    this.data.print_queue.forEach(q => {
      if (q.status === 'stuck') {
        q.status = 'pending';
        q.attempts = 0;
        count++;
      }
    });
    if (count > 0) this.save();
    return count;
  }

  clearPrintQueue() {
    this.data.print_queue = [];
    this.save();
  }

  getPrintQueueCount() {
    const pending = this.data.print_queue.filter(q => q.status === 'pending' && !q.isEphemeral).length;
    const stuck = this.data.print_queue.filter(q => q.status === 'stuck' && !q.isEphemeral).length;
    return { pending, stuck };
  }

  logSberTransaction(kioskId, amount, status, bankSlip = null, error = null) {
    this.data.sber_transactions.push({
      kioskId: String(kioskId),
      amount: Number(amount),
      status,
      bankSlip,
      error,
      timestamp: new Date().toISOString()
    });
    if (this.data.sber_transactions.length > 500) this.data.sber_transactions.shift();
    this.save();
  }
}

const db = new CrashResilientDB();

// ==========================================
// ⚙️ НАСТРОЙКИ ОБЛАКА И ЛОКАЛЬНОГО GUI
// ==========================================
const CLOUD_SERVER_URL = 'https://quok.art';
const SOCKET_PATH = '/pizza/socket.io'; 
const LOCAL_GUI_PORT = 3030; 

const ATOL_CONNECTION_TYPE = 'COM'; 
const ATOL_KKT_IP = '192.168.1.91';
const ATOL_KKT_PORT = '5555';
const ATOL_COM_PORT = 'COM3';       

const app = express();
const httpServer = createServer(app);
const localIo = new SocketIOServer(httpServer, { cors: { origin: "*" } });

const originalLog = console.log;
const originalError = console.error;

let cloudSocket;

function broadcastLog(level, ...args) {
  const msg = util.format(...args);
  const time = new Date().toLocaleTimeString('ru-RU');
  if (localIo) localIo.emit('agent_log', { level, text: msg, time });
  if (cloudSocket && cloudSocket.connected) cloudSocket.emit('agent_remote_log', { level, text: msg, time });
}

console.log = function(...args) {
  originalLog.apply(console, args);
  broadcastLog('info', ...args);
};

console.error = function(...args) {
  originalError.apply(console, args);
  broadcastLog('error', ...args);
};

console.log(`\n======================================================`);
console.log(`🤖 ЛОКАЛЬНЫЙ АГЕНТ "ДЕДА ПИЦЦА" ЗАПУСКАЕТСЯ...`);
console.log(`🌐 Подключение к облаку: ${CLOUD_SERVER_URL}${SOCKET_PATH}`);
console.log(`🖨 Подключение АТОЛ: Режим ${ATOL_CONNECTION_TYPE} (Порт: ${ATOL_COM_PORT})`);
console.log(`💳 Пин-пады Сбербанка: 5 изолированных параллельных очередей`);
console.log(`⏰ Смены: 10:00 (Открытие) | 19:00 (Закрытие) по времени МСК`);
console.log(`======================================================\n`);

cloudSocket = ioClient(CLOUD_SERVER_URL, {
  path: SOCKET_PATH,
  reconnectionDelayMax: 5000, 
});

cloudSocket.on('connect', () => {
  console.log('✅ [ОБЛАКО] Соединение установлено!');
  cloudSocket.emit('register_agent'); 
  localIo.emit('cloud_status', true);
});

cloudSocket.on('disconnect', () => {
  console.error('🚨 [ОБЛАКО] Связь потеряна. Ожидаем восстановления интернета...');
  localIo.emit('cloud_status', false);
});

// =========================================================
// ДЕКОДЕРЫ
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

function getSberPath(kioskId = '1') {
  const kId = String(kioskId);
  const pathsToTry = [`C:\\sc552_${kId}`, `C:\\sc552`, `C:\\sc552_1`];
  for (const p of pathsToTry) if (fs.existsSync(p)) return p;
  return `C:\\sc552_${kId}`;
}

// =========================================================
// 🌐 ТИХАЯ СИНХРОНИЗАЦИЯ ВРЕМЕНИ (МСК / UTC+3 БЕЗ СПАМА)
// =========================================================
let timeOffsetMs = 0;
let currentTimeStatus = { text: 'Проверка...', dotColor: 'dot-yellow pulse', isSynced: false };

async function checkAndSyncTime() {
  try {
    const response = await fetch('https://ya.ru', { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    const dateHeader = response.headers.get('date');
    if (dateHeader) {
      const internetUtc = new Date(dateHeader).getTime();
      timeOffsetMs = internetUtc - Date.now();
      const diffMinutes = Math.round(timeOffsetMs / 60000);

      const accurateMskDate = new Date(Date.now() + timeOffsetMs + (3 * 3600000));
      const mskTimeStr = accurateMskDate.toISOString().slice(11, 16);

      if (Math.abs(diffMinutes) > 2) {
        exec('tzutil /s "Russian Standard Time"', () => {});
        exec('w32tm /resync /force', () => {});
        currentTimeStatus = { text: `МСК: ${mskTimeStr} (${diffMinutes > 0 ? '+' : ''}${diffMinutes}м)`, dotColor: 'dot-yellow pulse', isSynced: false };
      } else {
        currentTimeStatus = { text: `МСК: ${mskTimeStr} (ОК)`, dotColor: 'dot-green', isSynced: true };
      }
      if (localIo) localIo.emit('time_status', currentTimeStatus);
      return;
    }
  } catch (e) {}

  currentTimeStatus = { text: `ПК: ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`, dotColor: 'dot-gray', isSynced: false };
  if (localIo) localIo.emit('time_status', currentTimeStatus);
}

// Запускаем тихий опрос времени раз при старте и раз в 30 минут (без спама)
setTimeout(checkAndSyncTime, 2000);
setInterval(checkAndSyncTime, 30 * 60 * 1000);

function getAccurateMskNow() {
  const mskDate = new Date(Date.now() + timeOffsetMs + (3 * 3600000));
  return {
    hours: mskDate.getUTCHours(),
    minutes: mskDate.getUTCMinutes(),
    todayStr: mskDate.toISOString().slice(0, 10)
  };
}

// =========================================================
// 💳 ПАРАЛЛЕЛЬНЫЙ МЕНЕДЖЕР 5 ПИН-ПАДОВ СБЕРБАНКА
// =========================================================
class SberQueueManager {
  constructor() {
    this.queues = {};          
    this.activeProcesses = {}; 
    this.isProcessing = {};    
  }

  enqueuePayment(kioskId, amount, callback) {
    const kId = String(kioskId || '1');
    if (!this.queues[kId]) { 
      this.queues[kId] = []; 
      this.isProcessing[kId] = false; 
    }
    this.queues[kId].push({ type: 'pay', amount, callback, addedAt: Date.now() });
    console.log(`📥 [СБЕРБАНК #${kId}] Запрос на ${amount} руб. добавлен. В очереди: ${this.queues[kId].length} шт.`);
    this.processNext(kId);
  }

  enqueueSettlement(kioskId, callback) {
    const kId = String(kioskId || '1');
    if (!this.queues[kId]) { 
      this.queues[kId] = []; 
      this.isProcessing[kId] = false; 
    }
    this.queues[kId].push({ type: 'settlement', callback, addedAt: Date.now() });
    console.log(`📥 [СБЕРБАНК #${kId}] Сверка итогов добавлена в очередь терминала.`);
    this.processNext(kId);
  }

  processNext(kId) {
    if (this.isProcessing[kId]) return;
    if (!this.queues[kId] || this.queues[kId].length === 0) return;

    this.isProcessing[kId] = true;
    const currentTask = this.queues[kId][0];

    const onComplete = (result) => {
      this.queues[kId].shift();
      this.isProcessing[kId] = false;
      try { 
        if (currentTask.callback) currentTask.callback(result); 
      } catch (e) {
        console.error(`⚠️ [СБЕРБАНК #${kId}] Ошибка callback:`, e.message);
      }
      setTimeout(() => this.processNext(kId), 500);
    };

    if (currentTask.type === 'pay') this.executePayment(kId, currentTask.amount, onComplete);
    else if (currentTask.type === 'settlement') this.executeSettlement(kId, onComplete);
  }

  cancelActivePayment(kioskId) {
    const kId = String(kioskId || '1');
    if (this.activeProcesses[kId]) {
      try {
        const p = this.activeProcesses[kId];
        if (p && p.pid) exec(`taskkill /F /PID ${p.pid} /T`, () => {});
      } catch (e) {}
      delete this.activeProcesses[kId];
    }
  }

  executePayment(kId, amount, callback) {
    const SBER_PATH = getSberPath(kId);
    console.log(`\n💳 [СБЕРБАНК #${kId}] ЗАПУСК ОПЛАТЫ: ${amount} руб.`);

    if (!fs.existsSync(SBER_PATH)) {
      console.error(`🚨 [СБЕРБАНК #${kId}] Папка ${SBER_PATH} не найдена!`);
      db.logSberTransaction(kId, amount, 'failed', null, `Папка ${SBER_PATH} не найдена`);
      return callback({ success: false, error: `Папка Сбербанка ${SBER_PATH} не найдена` });
    }

    ['e.txt', 'e', 'p.txt', 'p', 'commerr.log'].forEach(f => {
      try { fs.unlinkSync(path.join(SBER_PATH, f)); } catch (e) {}
    });

    const exeFile = fs.existsSync(path.join(SBER_PATH, 'sb_pilot.exe')) ? 'sb_pilot.exe' : 'sb_kernel.exe';
    const command = `"${path.join(SBER_PATH, exeFile)}" 1 ${Math.round(Number(amount || 0) * 100)}`;
    const startTime = Date.now();

    console.log(`⏳ [Терминал #${kId}] Ожидание карты...`);

    const childProcess = exec(command, { cwd: SBER_PATH, timeout: 90000 }, (error) => {
      if (this.activeProcesses) delete this.activeProcesses[kId];

      if (error && error.killed) {
        console.error(`🚨 [СБЕРБАНК #${kId}] Таймаут ожидания карты (90 сек).`);
        db.logSberTransaction(kId, amount, 'failed', null, 'Timeout 90s');
        return callback({ success: false, error: 'Время ожидания оплаты истекло.' });
      }

      try {
        let resultPath = fs.existsSync(path.join(SBER_PATH, 'e')) 
          ? path.join(SBER_PATH, 'e') 
          : (fs.existsSync(path.join(SBER_PATH, 'e.txt')) ? path.join(SBER_PATH, 'e.txt') : null);
        let slipFile = fs.existsSync(path.join(SBER_PATH, 'p')) 
          ? path.join(SBER_PATH, 'p') 
          : (fs.existsSync(path.join(SBER_PATH, 'p.txt')) ? path.join(SBER_PATH, 'p.txt') : null);

        if (resultPath) {
          const fileStats = fs.statSync(resultPath);
          // Защита от считывания старых файлов
          if (fileStats.mtimeMs < startTime - 1000) {
            console.error(`🚨 [СБЕРБАНК #${kId}] Старый файл ответа! Игнорируем.`);
            db.logSberTransaction(kId, amount, 'failed', null, 'Stale result file');
            return callback({ success: false, error: 'Устаревший ответ терминала' });
          }

          let rawResult = decodeCP866(fs.readFileSync(resultPath)); 
          if (rawResult.includes('??') || rawResult.includes('  ')) rawResult = decodeWin1251(fs.readFileSync(resultPath)); 
          
          const [codeStr, ...msgParts] = rawResult.split('\n')[0].trim().split(',');
          const resultCode = parseInt(codeStr.trim(), 10);
          const bankSlip = slipFile ? decodeWin1251(fs.readFileSync(slipFile)) : '';

          if (resultCode === 0) {
            console.log(`✅ [Терминал #${kId}] Оплата ${amount} руб. прошла успешно!`);
            db.logSberTransaction(kId, amount, 'success', bankSlip, null);
            return callback({ success: true, slip: bankSlip });
          } else {
            console.error(`🚨 [Терминал #${kId}] Отказ банка: ${msgParts.join(',')}`);
            db.logSberTransaction(kId, amount, 'failed', null, msgParts.join(','));
            return callback({ success: false, error: msgParts.join(',') });
          }
        }
      } catch (e) {
        console.error(`⚠️ [СБЕРБАНК #${kId}] Ошибка парсинга:`, e.message);
      }

      db.logSberTransaction(kId, amount, 'cancelled', null, 'Cancelled');
      callback({ success: false, error: 'Оплата отменена клиентом или терминалом' });
    });

    if (!this.activeProcesses) this.activeProcesses = {};
    this.activeProcesses[kId] = childProcess;
  }

  executeSettlement(kId, callback) {
    const SBER_PATH = getSberPath(kId);
    if (!fs.existsSync(SBER_PATH)) {
      console.error(`🚨 [СБЕРБАНК #${kId}] Папка ${SBER_PATH} не найдена`);
      return callback({ success: false, error: `Папка не найдена` });
    }

    ['e.txt', 'e', 'p.txt', 'p'].forEach(f => { try { fs.unlinkSync(path.join(SBER_PATH, f)); } catch (e) {} });

    const exeFile = fs.existsSync(path.join(SBER_PATH, 'sb_pilot.exe')) ? 'sb_pilot.exe' : 'sb_kernel.exe';
    console.log(`🧾 [СБЕРБАНК #${kId}] Запуск сверки итогов...`);

    exec(`"${path.join(SBER_PATH, exeFile)}" 7`, { cwd: SBER_PATH, timeout: 120000 }, () => {
      try {
        let resultFile = fs.existsSync(path.join(SBER_PATH, 'e')) ? path.join(SBER_PATH, 'e') : (fs.existsSync(path.join(SBER_PATH, 'e.txt')) ? path.join(SBER_PATH, 'e.txt') : null);
        if (resultFile) {
          let rawResult = decodeCP866(fs.readFileSync(resultFile)); 
          if (rawResult.includes('??') || rawResult.includes('  ')) rawResult = decodeWin1251(fs.readFileSync(resultFile)); 
          const [codeStr, ...msgParts] = rawResult.split('\n')[0].split(',');
          if (parseInt(codeStr, 10) === 0) {
            console.log(`✅ [Терминал #${kId}] Сверка итогов успешно завершена!`);
            return callback({ success: true });
          } else return callback({ success: false, error: msgParts.join(',') });
        }
      } catch (e) {}
      callback({ success: false, error: 'Таймаут сверки.' });
    });
  }
}

const sberManager = new SberQueueManager();

cloudSocket.on('cancel_sber_pay', (data = {}) => sberManager.cancelActivePayment(data?.kioskId));
cloudSocket.on('sber_pay', (payload = {}, callback) => {
  const { amount = 0, kioskId = '1' } = payload;
  sberManager.enqueuePayment(kioskId, amount, callback);
});
cloudSocket.on('sber_settlement', (payload = {}, callback) => {
  const { kioskId = '1' } = payload;
  sberManager.enqueueSettlement(kioskId, callback);
});

// =========================================================
// 🖨 УМНАЯ ОЧЕРЕДЬ ЧЕКОВ АТОЛ (С ЗАЩИТОЙ ОТ СПАМА)
// =========================================================
let currentShiftStatus = { text: 'Проверка...', dotColor: 'dot-yellow pulse', state: 'unknown', number: 0 };

class ReceiptQueueEngine {
  constructor() {
    this.isProcessing = false;
    this.callbacks = new Map();
  }

  notifyQueueLength() {
    const counts = db.getPrintQueueCount();
    if (localIo) localIo.emit('queue_status', counts);
  }

  clearQueue() {
    db.clearPrintQueue();
    this.isProcessing = false;
    this.notifyQueueLength();
    console.log('🗑 [ОЧЕРЕДЬ ЧЕКОВ] Очередь полностью очищена вручную!');
  }

  retryStuck() {
    const revived = db.retryStuckPrintTasks();
    if (revived > 0) {
      console.log(`🔄 [ОЧЕРЕДЬ ЧЕКОВ] Перезапущено ${revived} чеков со статусом ошибки.`);
      this.notifyQueueLength();
      this.processQueue();
    } else {
      console.log('✅ В очереди нет застрявших чеков.');
    }
  }

  enqueue(body, callback = null, isEphemeral = false) {
    const taskId = body.uuid || `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    if (callback) this.callbacks.set(taskId, callback);

    db.addPrintTask(taskId, body, isEphemeral);
    this.notifyQueueLength();

    if (!isEphemeral) {
      const counts = db.getPrintQueueCount();
      console.log(`📥 [ОЧЕРЕДЬ ЧЕКОВ] Чек ${taskId} записан. В очереди: ${counts.pending} шт.`);
    }

    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessing) return;

    const task = db.getNextPendingPrintTask();
    if (!task) return;

    this.isProcessing = true;

    if (!task.isEphemeral) {
      console.log(`\n🖨 [АТОЛ] Печать задачи (${task.taskId})...`);
    }

    this.executePrint(task.body, (result) => {
      const cb = this.callbacks.get(task.taskId);
      if (cb) {
        try { cb(result); } catch (e) {}
        this.callbacks.delete(task.taskId);
      }

      if (result.success) {
        if (!task.isEphemeral) console.log(`🎉 [АТОЛ] Задача ${task.taskId} выполнена!`);
        db.markPrintSuccess(task.taskId);
        this.notifyQueueLength();

        setTimeout(() => {
          this.isProcessing = false;
          queueShiftStatusCheck();
          this.processQueue();
        }, 400);

      } else {
        if (task.isEphemeral) {
          db.deletePrintTask(task.taskId);
          this.notifyQueueLength();
          setTimeout(() => {
            this.isProcessing = false;
            this.processQueue();
          }, 400);
        } else {
          db.markPrintFailed(task.taskId, result.error);
          this.notifyQueueLength();

          console.error(`🚨 [АТОЛ] Сбой печати (${task.taskId}): ${result.error}`);
          console.warn(`⏸ Чек заморожен (статус stuck). Для повтора нажмите 'S' или кнопку в панели.`);

          setTimeout(() => {
            this.isProcessing = false;
            this.processQueue();
          }, 500);
        }
      }
    });
  }

  executePrint(body, callback) {
    try {
      const taskJson = body.request[0];
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
    Write-Output "B64_RESULT:$([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($result)))"
}
`;
      fs.writeFileSync(psPath, psScript, 'utf8');

      exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psPath}"`, { timeout: 120000, encoding: 'buffer' }, (error, stdoutBuffer) => {
        try { fs.unlinkSync(jsonPath); fs.unlinkSync(psPath); } catch (e) {}
        const stdout = stdoutBuffer ? stdoutBuffer.toString('utf8') : '';
        if (error && error.killed) return callback({ success: false, error: 'Таймаут кассы (120 сек).' });

        const match = stdout.match(/B64_RESULT:(.*)/);
        if (match) {
          try {
            const result = JSON.parse(Buffer.from(match[1].trim(), 'base64').toString('utf8'));
            if (result.error) return callback({ success: false, error: result.error.description });
            return callback({ success: true, fiscalData: result });
          } catch (e) { return callback({ success: false, error: 'Ошибка парсинга ответа кассы' }); }
        } else return callback({ success: false, error: 'Касса не вернула ответ' });
      });
    } catch (e) { callback({ success: false, error: e.message }); }
  }
}

const receiptQueue = new ReceiptQueueEngine();

function queueShiftStatusCheck() {
  const statusTask = { uuid: `status_${Date.now()}`, request: [{ type: 'getShiftStatus' }] };
  receiptQueue.enqueue(statusTask, (res) => {
    if (res.success && res.fiscalData && res.fiscalData.shiftStatus) {
      const { state, number } = res.fiscalData.shiftStatus;
      if (state === 'opened') currentShiftStatus = { text: `Открыта (#${number})`, dotColor: 'dot-green' };
      else if (state === 'closed') currentShiftStatus = { text: 'Закрыта', dotColor: 'dot-red' };
      else currentShiftStatus = { text: `Истекла (#${number})`, dotColor: 'dot-yellow pulse' };
    } else currentShiftStatus = { text: 'Нет связи', dotColor: 'dot-red' };
    localIo.emit('shift_status', currentShiftStatus);
  }, true);
}

cloudSocket.on('atol_print', (body, callback) => {
  receiptQueue.enqueue(body, callback, false);
});

function printTestCheck() {
  console.log(`\n⌨️ Отправляем тестовый чек в кассу АТОЛ...`);
  receiptQueue.enqueue({
    uuid: `test_${Date.now()}`,
    request: [{ type: 'sell', taxationType: 'usnIncome', operator: { name: 'Администратор' }, items: [{ type: 'position', name: 'Тестовая печать', price: 10, quantity: 1, amount: 10, department: 1, paymentMethod: 'fullPayment', paymentObject: 'commodity', tax: { type: 'none' }, measurementUnit: 'piece' }], payments: [{ type: 'electronically', sum: 10 }], total: 10 }]
  }, (res) => {
    if (res.success) {
      console.log('🎉 Тестовый чек распечатан!');
      queueShiftStatusCheck();
    } else {
      console.error('💥 Сбой печати:', res.error);
    }
  }, false);
}

receiptQueue.processQueue();
setTimeout(queueShiftStatusCheck, 3000);
setInterval(queueShiftStatusCheck, 60000);

// =========================================================
// ⏰ ТИХОЕ АВТОМАТИЧЕСКОЕ РАСПИСАНИЕ СМЕН (ТОЛЬКО ТЕРМИНАЛ #1)
// =========================================================
let lastAutoOpenDate = '';
let lastAutoCloseDate = '';

function executeAutoOpen() {
  console.log(`\n☀️ [АВТОМАТИКА] Открытие смены в АТОЛ (10:00 МСК)...`);
  receiptQueue.enqueue({
    uuid: `auto_open_${Date.now()}`,
    request: [{ type: 'openShift', operator: { name: 'Автоматика' } }]
  }, () => queueShiftStatusCheck(), false);
}

function executeAutoClose() {
  console.log(`\n🌙 [АВТОМАТИКА] Вечерний цикл: сверка Терминала #1 и закрытие смены АТОЛ (19:00 МСК)...`);
  sberManager.enqueueSettlement('1', () => {});

  setTimeout(() => {
    console.log(`🖨 [АВТОМАТИКА] Печать Z-отчета (Закрытие смены) на кассе АТОЛ...`);
    receiptQueue.enqueue({
      uuid: `auto_close_${Date.now()}`,
      request: [{ type: 'closeShift', operator: { name: 'Автоматика' } }]
    }, () => queueShiftStatusCheck(), false);
  }, 10000);
}

cloudSocket.on('server_trigger_open_shift', () => executeAutoOpen());
cloudSocket.on('server_trigger_close_shift', () => executeAutoClose());

// Тихий таймер: проверяет время раз в 30 секунд без вывода логов
setInterval(() => {
  try {
    const mskTime = getAccurateMskNow();
    const hours = mskTime.hours;
    const minutes = mskTime.minutes;
    const todayStr = mskTime.todayStr;

    if (hours === 10 && minutes === 0 && lastAutoOpenDate !== todayStr) {
      lastAutoOpenDate = todayStr;
      executeAutoOpen();
    }

    if (hours === 19 && minutes === 0 && lastAutoCloseDate !== todayStr) {
      lastAutoCloseDate = todayStr;
      executeAutoClose();
    }
  } catch (err) {}
}, 30000);

// =========================================================
// 🖥 ГРАФИЧЕСКИЙ ИНТЕРФЕЙС
// =========================================================
const GUI_HTML = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Агент Деда Пицца</title>
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #064e3b; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; height: 100vh; display: flex; flex-direction: column; gap: 16px; padding: 24px; user-select: none; overflow: hidden; }
    .glass { background: rgba(255, 255, 255, 0.08); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 20px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25); }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; flex-shrink: 0; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo { width: 48px; height: 48px; border-radius: 50%; background: #eab308; color: #064e3b; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 900; }
    .title { font-size: 20px; font-weight: 800; color: #facc15; }
    .status-group { display: flex; gap: 12px; align-items: center; }
    .badge { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); padding: 8px 16px; border-radius: 12px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot-red { background: #ef4444; } .dot-green { background: #22c55e; } .dot-yellow { background: #eab308; } .dot-blue { background: #60a5fa; } .pulse { animation: pulseAnim 1.5s infinite; }
    @keyframes pulseAnim { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.9); } }
    .controls-grid { display: grid; grid-template-columns: 1.4fr 0.6fr; gap: 16px; flex-shrink: 0; }
    .card { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .card-icon { font-size: 36px; margin-bottom: 8px; }
    .card-title { font-size: 18px; font-weight: 800; color: #facc15; margin-bottom: 4px; }
    .card-desc { font-size: 12px; color: #a7f3d0; margin-bottom: 14px; }
    .terminal-buttons { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; width: 100%; }
    .btn-gold { background: #facc15; color: #064e3b; font-weight: 800; border: none; border-radius: 10px; padding: 10px 4px; font-size: 12px; cursor: pointer; transition: 0.15s; }
    .btn-gold:hover { background: #fde047; }
    .console-panel { flex-grow: 1; display: flex; flex-direction: column; padding: 16px 20px; min-height: 0; }
    .console-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 16px; font-weight: 800; color: #facc15; }
    .btn-group { display: flex; gap: 8px; }
    .btn-small { background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: white; padding: 4px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; }
    .btn-red { color: #f87171; border-color: rgba(248,113,113,0.3); }
    #console-box { flex-grow: 1; background: #000000; border-radius: 12px; padding: 14px; font-family: 'Consolas', monospace; font-size: 13px; line-height: 1.5; overflow-y: auto; }
    .log-line { margin-bottom: 2px; } .log-info { color: #4ade80; } .log-error { color: #f87171; } .log-time { color: #94a3b8; margin-right: 8px; }
  </style>
</head>
<body>
  
  <div class="glass header">
    <div class="brand">
      <div class="logo">ДП</div>
      <div>
        <div class="title">Панель Локального Агента</div>
        <div style="font-size:12px; color:#a7f3d0;">Сервисный узел (Автономная база + 5 Терминалов)</div>
      </div>
    </div>
    <div class="status-group">
      <div class="badge"><span id="cloud-indicator" class="dot dot-red pulse"></span><span>Облако</span></div>
      <div class="badge"><span id="time-indicator" class="dot dot-yellow pulse"></span><span id="time-text">МСК: Проверка...</span></div>
      <div class="badge"><span id="shift-indicator" class="dot dot-yellow pulse"></span><span id="shift-text">Смена: Проверка...</span></div>
      <div class="badge"><span class="dot dot-yellow"></span><span id="queue-text">Очередь: 0 шт.</span></div>
      <div class="badge"><span class="dot dot-blue"></span><span>АТОЛ: COM3</span></div>
    </div>
  </div>

  <div class="controls-grid">
    <div class="glass card">
      <div class="card-icon">💳</div>
      <div class="card-title">Сверка Итогов Сбербанка</div>
      <div class="card-desc">Закрыть смену на любом из 5 подключенных пин-падов:</div>
      <div class="terminal-buttons">
        <button onclick="socket.emit('trigger_sber', '1')" class="btn-gold">Терм. 1 [F1]</button>
        <button onclick="socket.emit('trigger_sber', '2')" class="btn-gold">Терм. 2 [F2]</button>
        <button onclick="socket.emit('trigger_sber', '3')" class="btn-gold">Терм. 3 [F3]</button>
        <button onclick="socket.emit('trigger_sber', '4')" class="btn-gold">Терм. 4 [F4]</button>
        <button onclick="socket.emit('trigger_sber', '5')" class="btn-gold">Терм. 5 [F5]</button>
      </div>
    </div>

    <div class="glass card" style="cursor:pointer;" onclick="socket.emit('trigger_atol')">
      <div class="card-icon">🖨</div>
      <div class="card-title">Тестовый Чек [A]</div>
      <div class="card-desc">Проверить связь с АТОЛ</div>
      <button class="btn-gold" style="width: 100%; padding: 10px;">Напечатать чек</button>
    </div>
  </div>

  <div class="glass console-panel">
    <div class="console-header">
      <span>🖥 Консоль Логов</span>
      <div class="btn-group">
        <button onclick="socket.emit('retry_stuck')" class="btn-small" style="color:#facc15; border-color:rgba(250,204,21,0.3);">🔄 Повторить ошибки [S]</button>
        <button onclick="socket.emit('clear_queue')" class="btn-small btn-red">🗑 Сбросить очередь</button>
        <button onclick="document.getElementById('console-box').innerHTML=''" class="btn-small">Очистить лог</button>
      </div>
    </div>
    <div id="console-box"></div>
  </div>

  <script>
    const socket = io('http://localhost:${LOCAL_GUI_PORT}');
    const box = document.getElementById('console-box');
    const cloudIndicator = document.getElementById('cloud-indicator');
    const shiftIndicator = document.getElementById('shift-indicator');
    const shiftText = document.getElementById('shift-text');
    const timeIndicator = document.getElementById('time-indicator');
    const timeText = document.getElementById('time-text');
    const queueText = document.getElementById('queue-text');

    socket.on('agent_log', (d) => {
      const el = document.createElement('div'); el.className = 'log-line';
      el.innerHTML = \`<span class="log-time">[\${d.time}]</span><span class="\${d.level==='error'?'log-error':'log-info'}">\${d.text}</span>\`;
      box.appendChild(el); box.scrollTop = box.scrollHeight;
    });

    socket.on('cloud_status', c => document.getElementById('cloud-indicator').className = 'dot ' + (c?'dot-green':'dot-red pulse'));
    socket.on('shift_status', d => { document.getElementById('shift-text').innerText = 'Смена: ' + d.text; document.getElementById('shift-indicator').className = 'dot ' + d.dotColor; });
    socket.on('time_status', d => { document.getElementById('time-text').innerText = d.text; document.getElementById('time-indicator').className = 'dot ' + d.dotColor; });
    socket.on('queue_status', d => {
      let text = 'Очередь: ' + d.pending + ' шт.';
      if (d.stuck > 0) text += ' (Ошибок: ' + d.stuck + ')';
      document.getElementById('queue-text').innerText = text;
    });
  </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(GUI_HTML));
localIo.on('connection', (socket) => {
  socket.emit('cloud_status', cloudSocket.connected);
  socket.emit('shift_status', currentShiftStatus);
  socket.emit('time_status', currentTimeStatus);
  receiptQueue.notifyQueueLength();
  
  socket.on('trigger_sber', (kioskId) => sberManager.enqueueSettlement(kioskId, () => {}));
  socket.on('trigger_atol', () => printTestCheck());
  socket.on('clear_queue', () => { receiptQueue.clearQueue(); setTimeout(queueShiftStatusCheck, 1000); });
  socket.on('retry_stuck', () => receiptQueue.retryStuck());
});

httpServer.listen(LOCAL_GUI_PORT, () => {
  console.log(`🎨 [GUI] Графическая панель: http://localhost:${LOCAL_GUI_PORT}`);
  try { exec(`start http://localhost:${LOCAL_GUI_PORT}`); } catch(e) {}
});

// Горячие клавиши (F1..F5, A, S)
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('keypress', (str, key) => {
  if (!key) return;
  if (key.ctrl && key.name === 'c') process.exit();
  
  if (key.name === 'space' || key.name === 'f1') sberManager.enqueueSettlement('1', () => {});
  if (key.name === 'f2' || str === '2') sberManager.enqueueSettlement('2', () => {});
  if (key.name === 'f3' || str === '3') sberManager.enqueueSettlement('3', () => {});
  if (key.name === 'f4' || str === '4') sberManager.enqueueSettlement('4', () => {});
  if (key.name === 'f5' || str === '5') sberManager.enqueueSettlement('5', () => {});
  if (key.name === 'a') printTestCheck();
  if (key.name === 's') receiptQueue.retryStuck();
});