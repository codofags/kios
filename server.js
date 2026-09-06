import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import configManager from './ConfigManager.js';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7 
});

let orders = [];
let orderCounter = 1;
let agentSocket = null; // 💡 Хранилище подключения нашего Windows-Агента

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const executionDir = process.pkg ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));
let publicPath = path.join(executionDir, 'dist');
if (!fs.existsSync(publicPath)) publicPath = path.join(executionDir, 'build');

if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.get(/(.*)/, (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

// =================================================================
// 💳 МОСТ К ЛОКАЛЬНОМУ АГЕНТУ (СБЕРБАНК И АТОЛ)
// =================================================================

// 1. Команда на оплату картой (пересылаем Агенту в пиццерию)
app.post('/api/sber/pay', (req, res) => {
  if (!agentSocket) {
    return res.json({ success: false, error: 'Касса в пиццерии выключена или не в сети (Агент не подключен).' });
  }
  
  console.log(`📡 [ОБЛАКО] Отправляем команду оплаты Агенту...`);
  // Ждем ответа от Агента (callback)
  agentSocket.emit('sber_pay', req.body, (response) => {
    res.json(response);
  });
});

// 2. Команда на печать чека (пересылаем Агенту в пиццерию)
app.post('/api/atol/print', (req, res) => {
  if (!agentSocket) {
    return res.json({ success: false, error: 'Связь с кассой в пиццерии потеряна.' });
  }

  console.log(`📡 [ОБЛАКО] Отправляем команду печати Агенту...`);
  agentSocket.emit('atol_print', req.body, (response) => {
    res.json(response);
  });
});


// =================================================================
// 📱 АЛЬФА-БАНК СБП (РАБОТАЕТ ПРЯМО В ОБЛАКЕ)
// =================================================================
const ALFA_API_URL = 'https://alfa.rbsuat.com/payment/rest'; 
const ALFA_LOGIN = 'test_api'; 
const ALFA_PASSWORD = 'password'; 

app.post('/api/alfa/generate-qr', async (req, res) => {
  const { amount, orderId, kioskId = '1' } = req.body;
  const kopecks = Math.round(Number(amount || 0) * 100);

  try {
    const regParams = new URLSearchParams({
      userName: ALFA_LOGIN, password: ALFA_PASSWORD,
      orderNumber: `K${kioskId}-${orderId}-${Date.now()}`, amount: kopecks, returnUrl: 'http://localhost'
    });
    const regRes = await fetch(`${ALFA_API_URL}/register.do`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: regParams });
    const regData = await regRes.json();
    if (regData.errorCode) throw new Error(regData.errorMessage);

    const qrParams = new URLSearchParams({ userName: ALFA_LOGIN, password: ALFA_PASSWORD, mdOrder: regData.orderId });
    const qrRes = await fetch(`${ALFA_API_URL}/sbp/c2b/qr/dynamic/get.do`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qrParams });
    const qrData = await qrRes.json();
    if (qrData.errorCode) throw new Error(qrData.errorMessage);

    res.json({ success: true, payload: qrData.payload, bankOrderId: regData.orderId });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/alfa/status/:bankOrderId', async (req, res) => {
  try {
    const statusParams = new URLSearchParams({ userName: ALFA_LOGIN, password: ALFA_PASSWORD, orderId: req.params.bankOrderId });
    const statusRes = await fetch(`${ALFA_API_URL}/getOrderStatusExtended.do`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: statusParams });
    const statusData = await statusRes.json();
    res.json({ success: true, isPaid: statusData.actionCode === 0 });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =================================================================
// 🚚 FOODSOUL (ВЕБХУКИ ДОСТАВКИ)
// =================================================================
const FOODSOUL_TOKEN = 'ВАШ_СЕКРЕТНЫЙ_ТОКЕН'; 
const FOODSOUL_ID = 'ВАШ_ID'; 

app.post('/api/foodsoul/callback', (req, res) => {
  const data = req.body;
  const incomingSign = data.sign; 
  const requestDate = data.date; 

  const hashString = `${FOODSOUL_ID}${requestDate}${FOODSOUL_TOKEN}`;
  const mySign = crypto.createHash('md5').update(hashString).digest('hex');

  if (FOODSOUL_TOKEN !== 'ВАШ_СЕКРЕТНЫЙ_ТОКЕН' && incomingSign !== mySign) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const newOrder = {
    orderId: `ФС-${data.order_id || Date.now()}`, source: 'delivery', status: 'new', orderType: 'takeaway', totalAmount: data.total_sum || 0,
    items: data.items ? data.items.map(item => ({ name: item.name, quantity: item.count, price: item.price })) : [],
    timestamp: new Date().toISOString()
  };
  orders.push(newOrder);
  io.emit('orders_updated', orders); 
  res.status(200).json({ success: true });
});

app.get('/api/foodsoul/menu', (req, res) => {
  const { menu, categories } = configManager.getAll();
  res.json({
    fs_catalog: {
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      categories: categories.map((cat, index) => ({ id: index + 1, name: cat })),
      offers: menu.map(item => ({ id: item.id, categoryId: categories.indexOf(item.category) + 1, name: item.name, price: item.price, picture: item.image }))
    }
  });
});

// =================================================================
// 🔌 SOCKET.IO
// =================================================================
io.on('connection', (socket) => {
  
  // 💡 РЕГИСТРАЦИЯ ЛОКАЛЬНОГО АГЕНТА ИЗ ПИЦЦЕРИИ
  socket.on('register_agent', () => {
    agentSocket = socket;
    console.log(`\n================================`);
    console.log(`🔗 АГЕНТ РЕСТОРАНА УСПЕШНО ПОДКЛЮЧЕН!`);
    console.log(`================================\n`);
  });

  socket.on('disconnect', () => {
    if (agentSocket === socket) {
      agentSocket = null;
      console.log(`\n🚨 ВНИМАНИЕ: АГЕНТ РЕСТОРАНА ОТКЛЮЧИЛСЯ!\n`);
    }
  });

  const currentData = configManager.getAll();
  socket.emit('orders_updated', orders);
  socket.emit('menu_updated', currentData.menu);
  socket.emit('categories_updated', currentData.categories);
  socket.emit('tags_updated', currentData.tags);

  socket.on('get_initial_data', () => {
    const data = configManager.getAll();
    socket.emit('menu_updated', data.menu);
    socket.emit('categories_updated', data.categories);
    socket.emit('tags_updated', data.tags);
  });

  socket.on('update_menu', (newMenu) => { configManager.updateMenu(newMenu); io.emit('menu_updated', newMenu); });
  socket.on('update_categories', (newCategories) => { configManager.updateCategories(newCategories); io.emit('categories_updated', newCategories); });
  socket.on('update_tags', (newTags) => { configManager.updateTags(newTags); io.emit('tags_updated', newTags); });

  socket.on('save_new_order', (orderData, cb) => {
    const order = { ...orderData, orderId: orderCounter++ };
    orders.push(order);
    io.emit('orders_updated', orders);
    if (cb) cb({ success: true, orderId: order.orderId });
  });

  socket.on('update_order_status', ({ orderId, status }) => {
    const order = orders.find(o => o.orderId === orderId);
    if (order) {
      order.status = status;
      if (status === 'completed') orders = orders.filter(o => o.orderId !== orderId);
      io.emit('orders_updated', orders);
    }
  });
  socket.on('clear_orders', () => { orders = []; orderCounter = 1; io.emit('orders_updated', orders); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n===========================================`);
  console.log(`☁️ ОБЛАЧНЫЙ СЕРВЕР "ДЕДА ПИЦЦА" ЗАПУЩЕН!`);
  console.log(`🌐 Порт: ${PORT}`);
  console.log(`===========================================\n`);
});