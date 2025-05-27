const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 10001; // Используем другой порт

// Подключение к PostgreSQL (та же база)
const pool = new Pool({
  connectionString: 'postgresql://protokol_db_user:cHHaJl1IUJFjFrpuPWko41lsjjkEaukW@dpg-d0nki98dl3ps73acg24g-a/protokol_db',
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Увеличиваем лимит для загрузки файлов

// Функция для инициализации базы данных
async function initializeDatabase() {
  try {
    // Проверяем существование таблицы отчетов
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'expense_reports'
      )
    `);

    if (!tableExists.rows[0].exists) {
      // Создаем таблицу если она не существует
      await pool.query(`
        CREATE TABLE expense_reports (
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
      console.log('Таблица expense_reports успешно создана');
    } else {
      console.log('Таблица expense_reports уже существует');
    }
  } catch (err) {
    console.error('Ошибка при инициализации базы данных:', err);
  }
}

// Инициализируем базу данных при запуске сервера
initializeDatabase();

// Маршруты API для отчетов
app.get('/api/reports', async (req, res) => {
  try {
    const { filter, statusFilter, page = 1, limit = 5 } = req.query;
    let query = 'SELECT * FROM expense_reports';
    const params = [];
    
    // Добавляем фильтры
    const whereClauses = [];
    if (filter && filter !== 'all') {
      whereClauses.push(`payment_method = $${params.length + 1}`);
      params.push(filter);
    }
    if (statusFilter && statusFilter !== 'all') {
      whereClauses.push(`status = $${params.length + 1}`);
      params.push(statusFilter);
    }
    
    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }
    
    // Добавляем сортировку и пагинацию
    query += ' ORDER BY date DESC, created_at DESC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, (page - 1) * limit);
    
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при получении отчетов' });
  }
});

app.post('/api/reports', async (req, res) => {
  const { 
    amount, 
    date, 
    paymentMethod, 
    selfPaid, 
    comment, 
    fileName, 
    fileSize, 
    fileType, 
    fileData 
  } = req.body;

  if (!amount || !date || !paymentMethod) {
    return res.status(400).json({ error: 'Обязательные поля: amount, date, paymentMethod' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO expense_reports (
        amount, date, payment_method, status, self_paid, comment, 
        file_name, file_size, file_type, file_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        amount, 
        date, 
        paymentMethod, 
        'not_ordered', 
        selfPaid || false, 
        comment || null,
        fileName || null,
        fileSize || null,
        fileType || null,
        fileData || null
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при создании отчета' });
  }
});

app.put('/api/reports/:id', async (req, res) => {
  const { id } = req.params;
  const { 
    amount, 
    date, 
    paymentMethod, 
    status, 
    selfPaid, 
    comment, 
    fileName, 
    fileSize, 
    fileType, 
    fileData 
  } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE expense_reports SET 
        amount = $1, 
        date = $2, 
        payment_method = $3, 
        status = $4, 
        self_paid = $5, 
        comment = $6, 
        file_name = $7, 
        file_size = $8, 
        file_type = $9, 
        file_data = $10,
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = $11 RETURNING *`,
      [
        amount, 
        date, 
        paymentMethod, 
        status || 'not_ordered', 
        selfPaid || false, 
        comment || null,
        fileName || null,
        fileSize || null,
        fileType || null,
        fileData || null,
        id
      ]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Отчет не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при обновлении отчета' });
  }
});

app.put('/api/reports/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Статус обязателен' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE expense_reports SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Отчет не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при обновлении статуса' });
  }
});

app.delete('/api/reports/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await pool.query('DELETE FROM expense_reports WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Отчет не найден' });
    }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при удалении отчета' });
  }
});

app.get('/api/reports/stats', async (req, res) => {
  try {
    // Общая сумма
    const totalQuery = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM expense_reports');
    const totalAmount = parseFloat(totalQuery.rows[0].total);
    
    // Сумма за текущий месяц
    const monthlyQuery = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expense_reports 
      WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
    `);
    const monthlyAmount = parseFloat(monthlyQuery.rows[0].total);
    
    // Сумма, оплаченная своими средствами
    const selfPaidQuery = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expense_reports 
      WHERE self_paid = true
    `);
    const selfPaidAmount = parseFloat(selfPaidQuery.rows[0].total);
    
    // Сумма, оплаченная своими средствами и не возвращённая
    const unpaidSelfQuery = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expense_reports 
      WHERE self_paid = true AND status != 'paid'
    `);
    const unpaidSelfAmount = parseFloat(unpaidSelfQuery.rows[0].total);
    
    // Сумма по наличным
    const cashQuery = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expense_reports 
      WHERE payment_method = 'cash'
    `);
    const cashAmount = parseFloat(cashQuery.rows[0].total);
    
    // Сумма по счетам
    const invoiceQuery = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expense_reports 
      WHERE payment_method = 'invoice'
    `);
    const invoiceAmount = parseFloat(invoiceQuery.rows[0].total);
    
    // Распределение по месяцам
    const monthlyDataQuery = await pool.query(`
      SELECT 
        to_char(date_trunc('month', date), 'YYYY-MM') as month,
        to_char(date_trunc('month', date), 'Mon') as month_name,
        SUM(amount) as total
      FROM expense_reports
      WHERE date >= date_trunc('month', CURRENT_DATE - interval '5 months')
      GROUP BY month, month_name
      ORDER BY month
    `);
    
    res.json({
      totalAmount,
      monthlyAmount,
      selfPaidAmount,
      unpaidSelfAmount,
      cashAmount,
      invoiceAmount,
      cashPercent: totalAmount > 0 ? Math.round((cashAmount / totalAmount) * 100) : 0,
      invoicePercent: totalAmount > 0 ? Math.round((invoiceAmount / totalAmount) * 100) : 0,
      monthlyData: monthlyDataQuery.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при получении статистики' });
  }
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Сервер отчетов запущен на http://localhost:${port}`);
});
