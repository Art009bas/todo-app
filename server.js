const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 10000;

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: 'postgresql://protokol_db_user:cHHaJl1IUJFjFrpuPWko41lsjjkEaukW@dpg-d0nki98dl3ps73acg24g-a/protokol_db',
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Инициализация базы данных
async function initializeDatabase() {
  try {
    // Создаем таблицу задач, если не существует
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создаем таблицу отчетов, если не существует
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expense_reports (
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

    console.log('База данных успешно инициализирована');
  } catch (err) {
    console.error('Ошибка при инициализации базы данных:', err);
  }
}

// Маршруты для To-Do приложения
app.get('/api/tasks', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/tasks', async (req, res) => {
  const { title, description } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO tasks (title, description) VALUES ($1, $2) RETURNING *',
      [title, description]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { completed } = req.body;

  try {
    const { rows } = await pool.query(
      'UPDATE tasks SET completed = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [completed, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Маршруты для приложения "Отчет бухам"
app.get('/api/reports', async (req, res) => {
  try {
    const { filter = 'all', status = 'all', page = 1, limit = 5 } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM expense_reports';
    const params = [];
    const conditions = [];

    if (filter !== 'all') {
      conditions.push(`payment_method = $${params.length + 1}`);
      params.push(filter);
    }

    if (status !== 'all') {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY date DESC, created_at DESC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/reports', async (req, res) => {
  const { amount, date, paymentMethod, selfPaid, comment, fileName, fileSize, fileType, fileData } = req.body;

  if (!amount || !date || !paymentMethod) {
    return res.status(400).json({ error: 'Amount, date and payment method are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO expense_reports (
        amount, date, payment_method, self_paid, comment, 
        file_name, file_size, file_type, file_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [amount, date, paymentMethod, selfPaid || false, comment || null, 
       fileName || null, fileSize || null, fileType || null, fileData || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/reports/:id', async (req, res) => {
  const { id } = req.params;
  const { amount, date, paymentMethod, status, selfPaid, comment, fileName, fileSize, fileType, fileData } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE expense_reports SET 
        amount = $1, date = $2, payment_method = $3, status = $4, 
        self_paid = $5, comment = $6, file_name = $7, file_size = $8, 
        file_type = $9, file_data = $10, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $11 RETURNING *`,
      [amount, date, paymentMethod, status || 'not_ordered', selfPaid || false, 
       comment || null, fileName || null, fileSize || null, 
       fileType || null, fileData || null, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
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
      'UPDATE expense_reports SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
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
    const { rowCount } = await pool.query('DELETE FROM expense_reports WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/reports/stats', async (req, res) => {
  try {
    // Общая статистика
    const totalQuery = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM expense_reports');
    const monthlyQuery = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expense_reports 
      WHERE date_trunc('month', date) = date_trunc('month', CURRENT_DATE)
    `);
    const selfPaidQuery = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expense_reports 
      WHERE self_paid = true
    `);
    const unpaidSelfQuery = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expense_reports 
      WHERE self_paid = true AND status != 'paid'
    `);
    const cashQuery = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expense_reports 
      WHERE payment_method = 'cash'
    `);
    const invoiceQuery = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expense_reports 
      WHERE payment_method = 'invoice'
    `);
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
      totalAmount: parseFloat(totalQuery.rows[0].total),
      monthlyAmount: parseFloat(monthlyQuery.rows[0].total),
      selfPaidAmount: parseFloat(selfPaidQuery.rows[0].total),
      unpaidSelfAmount: parseFloat(unpaidSelfQuery.rows[0].total),
      cashAmount: parseFloat(cashQuery.rows[0].total),
      invoiceAmount: parseFloat(invoiceQuery.rows[0].total),
      monthlyData: monthlyDataQuery.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Инициализация и запуск сервера
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
  });
});
