const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 1001;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Секретный ключ для подписи токена
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://protokol_db_user:cHHaJl1IUJFjFrpuPWko41lsjjkEaukW@dpg-d0nki98dl3ps73acg24g-a/protokol_db',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.post('/auth/telegram', express.json({ limit: '1mb' }), async (req, res) => {
  const { id, first_name, photo_url, auth_date, hash } = req.body;

  // Формируем строку проверки
  const dataCheckString = Object.keys(req.body)
    .filter(k => k !== 'hash')
    .sort()
    .map(k => `${k}=${req.body[k]}`)
    .join('\n');

  // Генерируем секретный ключ
  const secretKey = crypto.createHmac('sha256', 'WebAppData')
                          .update(process.env.BOT_TOKEN)
                          .digest();

  // Считаем хэш
  const calculatedHash = crypto.createHmac('sha256', secretKey)
                               .update(dataCheckString)
                               .digest('hex');

  if (calculatedHash !== hash) {
    return res.status(401).json({ error: 'Неверный хэш' });
  }

  // Проверяем, истёк ли срок действия данных (в течение 1 часа)
  const timestamp = Math.floor(Date.now() / 1000);
  if (timestamp - auth_date > 86400) { // 24 часа
    return res.status(401).json({ error: 'Срок действия данных истёк' });
  }

  try {
    // Ищем пользователя
    let result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [id]);
    if (result.rows.length === 0) {
      // Регистрация нового пользователя
      result = await pool.query(
        'INSERT INTO users (telegram_id, username, avatar) VALUES ($1, $2, $3) RETURNING *',
        [id, first_name, photo_url]
      );
    }

    const user = result.rows[0];

    // Генерируем JWT
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar } });
  } catch (err) {
    console.error('Ошибка авторизации:', err);
    res.status(500).json({ error: 'Ошибка авторизации' });
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Защита существующих маршрутов
const authenticateJWT = require('./middleware/authMiddleware');

app.get('/api/reports', authenticateJWT, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reports ORDER BY date DESC');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения отчетов:', err);
    res.status(500).json({ error: 'Не удалось загрузить отчеты' });
  }
});
app.post('/api/reports', authenticateJWT, async (req, res) => {
  const { amount, date, paymentMethod, status, selfPaid, comment, fileName, fileSize, fileType, fileData } = req.body;

  if (!amount || !date || !paymentMethod) {
    return res.status(400).json({ error: 'Обязательные поля: amount, date, paymentMethod' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO reports 
      (amount, date, payment_method, status, self_paid, comment, file_name, file_size, file_type, file_data) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
      RETURNING *`,
      [
        amount, 
        date, 
        paymentMethod, 
        status || 'not_ordered', 
        selfPaid || false, 
        comment || '', 
        fileName || '', 
        fileSize || '', 
        fileType || '', 
        fileData || ''
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка создания отчета:', err);
    res.status(500).json({ error: 'Не удалось сохранить отчет' });
  }
});

app.put('/api/reports/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  const { amount, date, paymentMethod, status, selfPaid, comment, fileName, fileSize, fileType, fileData } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE reports 
      SET amount = $1, date = $2, payment_method = $3, status = $4, self_paid = $5, 
          comment = $6, file_name = $7, file_size = $8, file_type = $9, file_data = $10,
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = $11 
      RETURNING *`,
      [
        amount, 
        date, 
        paymentMethod, 
        status, 
        selfPaid, 
        comment, 
        fileName, 
        fileSize, 
        fileType, 
        fileData, 
        id
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Отчёт не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Ошибка обновления отчета:', err);
    res.status(500).json({ error: 'Не удалось обновить отчет' });
  }
});

app.delete('/api/reports/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await pool.query('DELETE FROM reports WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Отчёт не найден' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('Ошибка удаления отчета:', err);
    res.status(500).json({ error: 'Не удалось удалить отчет' });
  }
});

// Инициализация базы данных
// Проверка и создание таблиц reports и users
async function initializeDatabase() {
  try {
    // Создание таблицы reports (если ещё не создана)
    const reportsExist = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'reports'
      )
    `);

    if (!reportsExist.rows[0].exists) {
      await pool.query(`
        CREATE TABLE reports (
          id SERIAL PRIMARY KEY,
          amount DECIMAL(10, 2) NOT NULL,
          date DATE NOT NULL,
          payment_method VARCHAR(20) NOT NULL,
          status VARCHAR(20) DEFAULT 'not_ordered',
          self_paid BOOLEAN DEFAULT FALSE,
          comment TEXT,
          file_name VARCHAR(255),
          file_size VARCHAR(50),
          file_type VARCHAR(100),
          file_data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Таблица reports успешно создана');
    } else {
      console.log('Таблица reports уже существует');
    }

    // Создание таблицы users (если ещё не создана)
    const usersExist = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      )
    `);

    if (!usersExist.rows[0].exists) {
      await pool.query(`
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Таблица users успешно создана');
    } else {
      console.log('Таблица users уже существует');
    }
  } catch (err) {
    console.error('Ошибка при инициализации базы данных:', err);
  }
}

// Запуск инициализации базы данных
initializeDatabase();

// Маршруты API
app.get('/api/reports', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reports ORDER BY date DESC');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения отчетов:', err);
    res.status(500).json({ error: 'Не удалось загрузить отчеты' });
  }
});

app.post('/api/reports', async (req, res) => {
  const { amount, date, paymentMethod, status, selfPaid, comment, fileName, fileSize, fileType, fileData } = req.body;
  
  if (!amount || !date || !paymentMethod) {
    return res.status(400).json({ error: 'Обязательные поля: amount, date, paymentMethod' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO reports 
      (amount, date, payment_method, status, self_paid, comment, file_name, file_size, file_type, file_data) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
      RETURNING *`,
      [
        amount, 
        date, 
        paymentMethod, 
        status || 'not_ordered', 
        selfPaid || false, 
        comment || '', 
        fileName || '', 
        fileSize || '', 
        fileType || '', 
        fileData || ''
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка создания отчета:', err);
    res.status(500).json({ error: 'Не удалось сохранить отчет' });
  }
});

app.put('/api/reports/:id', async (req, res) => {
  const { id } = req.params;
  const { amount, date, paymentMethod, status, selfPaid, comment, fileName, fileSize, fileType, fileData } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE reports 
      SET amount = $1, date = $2, payment_method = $3, status = $4, self_paid = $5, 
          comment = $6, file_name = $7, file_size = $8, file_type = $9, file_data = $10,
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = $11 
      RETURNING *`,
      [
        amount, 
        date, 
        paymentMethod, 
        status, 
        selfPaid, 
        comment, 
        fileName, 
        fileSize, 
        fileType, 
        fileData, 
        id
      ]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Отчёт не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Ошибка обновления отчета:', err);
    res.status(500).json({ error: 'Не удалось обновить отчет' });
  }
});

app.put('/api/reports/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const { rows } = await pool.query(
      'UPDATE reports SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Отчёт не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Ошибка обновления статуса:', err);
    res.status(500).json({ error: 'Не удалось обновить статус' });
  }
});

app.delete('/api/reports/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await pool.query('DELETE FROM reports WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Отчёт не найден' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('Ошибка удаления отчета:', err);
    res.status(500).json({ error: 'Не удалось удалить отчет' });
  }
});

// Статистика
app.get('/api/reports/stats', async (req, res) => {
  try {
    // Общая сумма
    const totalAmount = await pool.query('SELECT SUM(amount) FROM reports');
    
    // Сумма за текущий месяц
    const monthlyAmount = await pool.query(`
      SELECT SUM(amount) 
      FROM reports 
      WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
    `);
    
    // Сумма, оплаченная своими средствами
    const selfPaidAmount = await pool.query(`
      SELECT SUM(amount) 
      FROM reports 
      WHERE self_paid = TRUE
    `);
    
    // Сумма, оплаченная своими средствами и не возвращённая
    const unpaidSelfAmount = await pool.query(`
      SELECT SUM(amount) 
      FROM reports 
      WHERE self_paid = TRUE AND status != 'paid'
    `);
    
    // Распределение по наличным
    const cashAmount = await pool.query(`
      SELECT SUM(amount) 
      FROM reports 
      WHERE payment_method = 'cash'
    `);
    
    // Сумма по счетам
    const invoiceAmount = await pool.query(`
      SELECT SUM(amount) 
      FROM reports 
      WHERE payment_method = 'invoice'
    `);
    
    // Распределение по месяцам
    const monthlyData = await pool.query(`
      SELECT 
        to_char(date_trunc('month', date), 'YYYY-MM') as month,
        SUM(amount) as total
      FROM reports
      GROUP BY month
      ORDER BY month DESC
      LIMIT 6
    `);

    res.json({
      totalAmount: parseFloat(totalAmount.rows[0].sum || 0),
      monthlyAmount: parseFloat(monthlyAmount.rows[0].sum || 0),
      selfPaidAmount: parseFloat(selfPaidAmount.rows[0].sum || 0),
      unpaidSelfAmount: parseFloat(unpaidSelfAmount.rows[0].sum || 0),
      cashAmount: parseFloat(cashAmount.rows[0].sum || 0),
      invoiceAmount: parseFloat(invoiceAmount.rows[0].sum || 0),
      monthlyData: monthlyData.rows
    });
  } catch (err) {
    console.error('Ошибка получения статистики:', err);
    res.status(500).json({ error: 'Не удалось загрузить статистику' });
  }
});

const authRoutes = require('./routes/authRoutes');
app.use('/api', authRoutes);

// Маршрут для проверки токена и получения данных пользователя
app.get('/auth/check', authenticateJWT, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, avatar FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Ошибка проверки сессии:', err);
    res.status(500).json({ error: 'Ошибка проверки сессии' });
  }
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:${port}`);
});
