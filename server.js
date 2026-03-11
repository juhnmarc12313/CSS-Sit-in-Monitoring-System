const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Initialize SQLite Database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// =============================================
// Database Schema Initialization
// =============================================

function initializeDatabase() {
    db.serialize(() => {
        // Users Table (for registration/login)
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                id_number TEXT UNIQUE NOT NULL,
                last_name TEXT NOT NULL,
                first_name TEXT NOT NULL,
                middle_name TEXT,
                course_level INTEGER NOT NULL,
                course TEXT NOT NULL,
                address TEXT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )
        `, (err) => {
            if (err) {
                console.error('Error creating users table:', err.message);
            } else {
                console.log('Users table created/verified');
            }
        });

        // Create index for faster login lookups
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_id_number ON users(id_number)`);

        // Sessions Table (for tracking user sessions)
        db.run(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                session_token TEXT UNIQUE NOT NULL,
                login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                logout_time DATETIME,
                ip_address TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) {
                console.error('Error creating sessions table:', err.message);
            } else {
                console.log('Sessions table created/verified');
            }
        });

        // Sit-in Records Table (for monitoring sit-in activities)
        db.run(`
            CREATE TABLE IF NOT EXISTS sit_in_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                lab_room TEXT,
                purpose TEXT,
                time_in DATETIME DEFAULT CURRENT_TIMESTAMP,
                time_out DATETIME,
                date DATE DEFAULT (date('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) {
                console.error('Error creating sit_in_records table:', err.message);
            } else {
                console.log('Sit-in records table created/verified');
            }
        });

        // Create indexes for sit-in queries
        db.run(`CREATE INDEX IF NOT EXISTS idx_sit_in_user_id ON sit_in_records(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sit_in_date ON sit_in_records(date)`);
    });
}

// =============================================
// Helper Functions
// =============================================

// Hash password using SHA-256 (consider using bcrypt in production)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Generate session token
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// =============================================
// API Routes
// =============================================

// Registration endpoint
app.post('/api/register', (req, res) => {
    const { id_number, last_name, first_name, middle_name, course_level, course, address, email, password } = req.body;

    // Validate required fields
    if (!id_number || !last_name || !first_name || !course_level || !course || !email || !password) {
        return res.status(400).json({ error: 'All required fields must be filled' });
    }

    const password_hash = hashPassword(password);

    const query = `
        INSERT INTO users (id_number, last_name, first_name, middle_name, course_level, course, address, email, password_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(query, [id_number, last_name, first_name, middle_name, course_level, course, address, email, password_hash], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                if (err.message.includes('email')) {
                    return res.status(409).json({ error: 'Email already registered' });
                } else if (err.message.includes('id_number')) {
                    return res.status(409).json({ error: 'ID Number already registered' });
                }
            }
            return res.status(500).json({ error: 'Registration failed: ' + err.message });
        }
        res.status(201).json({ message: 'Registration successful', userId: this.lastID });
    });
});

// Login endpoint
app.post('/api/login', (req, res) => {
    const { id_number, password } = req.body;

    if (!id_number || !password) {
        return res.status(400).json({ error: 'ID Number and password are required' });
    }

    const password_hash = hashPassword(password);

    const query = `SELECT * FROM users WHERE id_number = ? AND password_hash = ? AND is_active = 1`;

    db.get(query, [id_number, password_hash], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Login failed: ' + err.message });
        }

        if (!user) {
            return res.status(401).json({ error: 'Invalid ID Number or password' });
        }

        // Create session
        const session_token = generateSessionToken();
        const sessionQuery = `INSERT INTO sessions (user_id, session_token, ip_address) VALUES (?, ?, ?)`;

        db.run(sessionQuery, [user.id, session_token, req.ip], (err) => {
            if (err) {
                console.error('Session creation error:', err.message);
            }
        });

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                id_number: user.id_number,
                name: `${user.first_name} ${user.last_name}`,
                email: user.email,
                course: user.course,
                course_level: user.course_level
            },
            session_token: session_token
        });
    });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    const { session_token } = req.body;

    if (!session_token) {
        return res.status(400).json({ error: 'Session token required' });
    }

    const query = `UPDATE sessions SET logout_time = CURRENT_TIMESTAMP WHERE session_token = ?`;

    db.run(query, [session_token], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Logout failed: ' + err.message });
        }
        res.json({ message: 'Logout successful' });
    });
});

// Get user profile
app.get('/api/user/:id', (req, res) => {
    const { id } = req.params;

    const query = `SELECT id, id_number, last_name, first_name, middle_name, course_level, course, address, email, created_at FROM users WHERE id = ?`;

    db.get(query, [id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch user: ' + err.message });
        }
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });
});

// Sit-in check-in endpoint
app.post('/api/sitin/checkin', (req, res) => {
    const { user_id, lab_room, purpose } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    const query = `INSERT INTO sit_in_records (user_id, lab_room, purpose) VALUES (?, ?, ?)`;

    db.run(query, [user_id, lab_room, purpose], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Check-in failed: ' + err.message });
        }
        res.status(201).json({ message: 'Check-in successful', recordId: this.lastID });
    });
});

// Sit-in check-out endpoint
app.post('/api/sitin/checkout', (req, res) => {
    const { record_id } = req.body;

    if (!record_id) {
        return res.status(400).json({ error: 'Record ID is required' });
    }

    const query = `UPDATE sit_in_records SET time_out = CURRENT_TIMESTAMP WHERE id = ? AND time_out IS NULL`;

    db.run(query, [record_id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Check-out failed: ' + err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Active sit-in record not found' });
        }
        res.json({ message: 'Check-out successful' });
    });
});

// Get sit-in records
app.get('/api/sitin/records', (req, res) => {
    const query = `
        SELECT sr.*, u.id_number, u.first_name, u.last_name, u.course
        FROM sit_in_records sr
        JOIN users u ON sr.user_id = u.id
        ORDER BY sr.date DESC, sr.time_in DESC
    `;

    db.all(query, [], (err, records) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch records: ' + err.message });
        }
        res.json(records);
    });
});

// =============================================
// Start Server
// =============================================

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});

module.exports = app;
