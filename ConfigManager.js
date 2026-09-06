import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Определяем путь к папке, где запущен файл/exe
const executionDir = process.pkg 
  ? path.dirname(process.execPath) 
  : path.dirname(fileURLToPath(import.meta.url));

const DATA_FILE = path.join(executionDir, 'data.json');

const defaultData = {
  categories: ['Пицца', 'Супы', 'Салаты', 'Вторые блюда', 'Десерты', 'Напитки'],
  tags: ['🌿 Без мяса', '🌶 Острая', '🧸 Детям', '🔥 Хит', '🆕 Новинка'],
  menu: []
};

class ConfigManager {
  constructor() {
    this.data = this.loadData();
  }

  loadData() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
        return JSON.parse(rawData);
      }
    } catch (error) {
      console.error('🚨 Ошибка чтения data.json. Загрузка дефолтных данных.', error);
    }
    this.saveData(defaultData);
    return defaultData;
  }

  saveData(data) {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('🚨 Ошибка записи в data.json', error);
    }
  }

  getAll() {
    return this.data;
  }

  updateMenu(newMenu) {
    this.data.menu = newMenu;
    this.saveData(this.data);
  }

  updateCategories(newCategories) {
    this.data.categories = newCategories;
    this.saveData(this.data);
  }

  updateTags(newTags) {
    this.data.tags = newTags;
    this.saveData(this.data);
  }
}

// СОЗДАЕМ И ЭКСПОРТИРУЕМ ОБЪЕКТ ПО УМОЛЧАНИЮ (DEFAULT EXPORT)
const configManager = new ConfigManager();
export default configManager;