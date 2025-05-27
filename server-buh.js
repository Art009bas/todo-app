const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 1001;

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: 'postgresql://protokol_db_user:cHHaJl1IUJFjFrpuPWko41lsjjkEaukW@dpg-d0nki98dl3ps73acg24g-a/protokol_db',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Увеличиваем лимит для загрузки файлов

// Функция для инициализации базы данных
async function initializeDatabase() {
  try {
    // Проверяем существование таблицы
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'reports'
      )
    `);

    if (!tableExists.rows[0].exists) {
      // Создаем таблицу если она не существует
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
  } catch (err) {
    console.error('Ошибка при инициализации базы данных:', err);
  }
}

// Инициализируем базу данных при запуске сервера
initializeDatabase();

// Маршруты API
app.get('/api/reports', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reports ORDER BY date DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/reports', async (req, res) => {
  const { amount, date, payment_method, status, self_paid, comment, file_name, file_size, file_type, file_data } = req.body;
  
  if (!amount || !date || !payment_method) {
    return res.status(400).json({ error: 'Обязательные поля: amount, date, payment_method' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO reports 
      (amount, date, payment_method, status, self_paid, comment, file_name, file_size, file_type, file_data) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
      RETURNING *`,
      [amount, date, payment_method, status || 'not_ordered', self_paid || false, comment || '', 
       file_name || '', file_size || '', file_type || '', file_data || '']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/reports/:id', async (req, res) => {
  const { id } = req.params;
  const { amount, date, payment_method, status, self_paid, comment, file_name, file_size, file_type, file_data } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE reports 
      SET amount = $1, date = $2, payment_method = $3, status = $4, self_paid = $5, 
          comment = $6, file_name = $7, file_size = $8, file_type = $9, file_data = $10,
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = $11 
      RETURNING *`,
      [amount, date, payment_method, status, self_paid, comment, file_name, file_size, file_type, file_data, id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Отчёт не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
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
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
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
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
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
    
    // Сумма по наличным
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
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:${port}`);
});
