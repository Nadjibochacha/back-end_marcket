const express = require('express');
const pool = require('./controller/db_connection');
const bcrypt = require('bcrypt');
const app = express();
const PORT = 8080;
const cors = require('cors');
const corsOptions = {
  origin: 'http://localhost:3000', // Ensure no trailing slash here
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Allow cookies to be sent
};

app.use(express.json());
app.use(cors(corsOptions));

// authentication
app.post('/', async(req, res) => {
  const { username, password } = req.body;

  try {
    // Check if the user exists
    const userResult = await pool.query('SELECT user_id, password FROM users WHERE username = $1', [username]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = userResult.rows[0];

    // Compare hashed password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    res.status(200).json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

//sign up
app.post('/sign',async (req,res)=>{
  const { username, password } = req.body;
  const hashed_password = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query("insert into users(username, password) values($1,$2) returning *", [username, hashed_password]);
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
})

// Add a new stock item
app.post('/stock', async (req, res) => {
  const { name, quantity, expiration, price , category} = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO stock (name, quantity, expiration , price, catigory) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, quantity, expiration, price, category]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// Get all stock items
app.get('/stock', async (req, res) => {
  try {
    const result = await pool.query("SELECT product_id, name, TO_CHAR(expiration, 'DD-MM-YYYY') AS formatted_expiration, quantity, price, cost, catigory FROM stock ORDER BY expiration");
    res.status(200).json(result.rows)

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve stock items' });
  }
});
// update item from stock
app.put('/stock/:id', async (req, res) => {
  const id = req.params.id;
  const { name, quantity, expiration, price, category, cost } = req.body;

  try {
    const result = await pool.query(
      `UPDATE stock
       SET name = $1, quantity = $2, expiration = $3, price = $4, catigory = $5, cost = $6
       WHERE product_id = $7 RETURNING *`,
      [name, quantity, expiration, price, category, cost,id]
    );
    res.status(201).json(result.rows[0]); // Return the updated row
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error });
  }
});

// delete product from stock
app.delete('/stock/:id', async (req,res)=>{
  const id = req.params.id;
  try {
    const result = await pool.query('delete from stock where product_id= $1 returning *', [id]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
  }
})

// get all bills 
app.get("/bills", async (req,res)=>{
  try {
    const result = await pool.query("SELECT  b.bill_id, b.total, TO_CHAR(b.created_at,'DD-MM-YYYY') As created_at , b.items_num, bp.id_product, s.name AS product_name, s.price, bp.quantity FROM bill b LEFT JOIN  bill_products bp ON b.bill_id = bp.bill_id LEFT JOIN stock s ON bp.id_product = s.product_id")
    res.json(result.rows);
  } catch (error) {
    console.log(error);
  }
});

// post a bill
app.post('/bills', async (req, res) => {
  const { total, cart } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: Recalculate cartLength
    const cartLength = cart.reduce((acc, product) => acc + product.quantity, 0);

    // Step 2: Insert the bill
    const billResult = await client.query(
      'INSERT INTO bill (total, items_num) VALUES ($1, $2) RETURNING bill_id',
      [total, cartLength]
    );
    const bill_id = billResult.rows[0].bill_id;

    // Step 3: Validate and update stock
    for (const product of cart) {
      const stockResult = await client.query(
        'SELECT quantity FROM stock WHERE product_id = $1 FOR UPDATE',
        [product.product_id]
      );
      if (stockResult.rows[0].quantity < product.quantity) {
        throw new Error(`Insufficient stock for product ID: ${product.product_id}`);
      }
      await client.query(
        'UPDATE stock SET quantity = quantity - $1 WHERE product_id = $2',
        [product.quantity, product.product_id]
      );
    }

    // Step 4: Insert bill products
    const productQueries = cart.map((product) =>
      client.query(
        'INSERT INTO bill_products (bill_id, id_product, quantity) VALUES ($1, $2, $3)',
        [bill_id, product.product_id, product.quantity]
      )
    );
    await Promise.all(productQueries);

    await client.query('COMMIT');
    res.status(201).json({ message: 'Bill created successfully', bill_id });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    if (error.message.includes('Insufficient stock')) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to create bill due to a server error' });
    }
  } finally {
    client.release();
  }
});

// statistics endpoints:
app.get("/allSales", async (req, res)=>{
  try {
    const result = await pool.query("select total , TO_CHAR(created_at,'DD-MM-YYYY') As created_at from bill");
    res.json(result.rows);
  } catch (error) {
    console.log(error);
  }
})
//bestsallers :
app.get("/bestSll", async (req,res)=>{
  try {
    const result = await pool.query("select name, quantity from stock where name = 'Sony PlayStation 5' or name = 'Lenovo ThinkPad X1' or name = 'Apples' or name ='potato' ");
    res.json(result.rows);
  } catch (error) {
    console.log(error);
  }
})



// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

