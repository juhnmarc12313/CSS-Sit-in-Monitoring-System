const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for profile picture uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'profile-' + req.params.id + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (jpeg, jpg, png, gif) are allowed!'));
        }
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(uploadsDir));

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
                profile_picture TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )
        `, (err) => {
            if (err) {
                console.error('Error creating users table:', err.message);
            } else {
                console.log('Users table created/verified');
                // Add profile_picture column if it doesn't exist (for existing databases)
                db.run(`ALTER TABLE users ADD COLUMN profile_picture TEXT`, (alterErr) => {
                    if (alterErr && !alterErr.message.includes('duplicate column name')) {
                        console.error('Error adding profile_picture column:', alterErr.message);
                    }
                });
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
                first_name: user.first_name,
                last_name: user.last_name,
                middle_name: user.middle_name,
                email: user.email,
                course: user.course,
                course_level: user.course_level,
                address: user.address,
                profile_picture: user.profile_picture
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

// Validate session and get user data
app.get('/api/session/validate', (req, res) => {
    const session_token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;

    if (!session_token) {
        return res.status(401).json({ error: 'Session token required' });
    }

    // Find the session
    const sessionQuery = `
        SELECT s.*, u.id as user_id, u.id_number, u.last_name, u.first_name, u.middle_name, 
               u.course_level, u.course, u.address, u.email, u.profile_picture
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.session_token = ? AND s.logout_time IS NULL
    `;

    db.get(sessionQuery, [session_token], (err, session) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to validate session: ' + err.message });
        }
        if (!session) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }

        // Return user data
        res.json({
            user: {
                id: session.user_id,
                id_number: session.id_number,
                name: `${session.first_name} ${session.last_name}`,
                first_name: session.first_name,
                last_name: session.last_name,
                middle_name: session.middle_name,
                email: session.email,
                course: session.course,
                course_level: session.course_level,
                address: session.address,
                profile_picture: session.profile_picture
            }
        });
    });
});

// Get user profile
app.get('/api/user/:id', (req, res) => {
    const { id } = req.params;

    const query = `SELECT id, id_number, last_name, first_name, middle_name, course_level, course, address, email, profile_picture, created_at FROM users WHERE id = ?`;

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

// Upload profile picture
app.post('/api/user/:id/profile-picture', upload.single('profilePicture'), (req, res) => {
    const { id } = req.params;

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const profilePicturePath = `/uploads/${req.file.filename}`;

    // Get old profile picture to delete it
    db.get(`SELECT profile_picture FROM users WHERE id = ?`, [id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch user: ' + err.message });
        }

        // Update database with new profile picture path
        const query = `UPDATE users SET profile_picture = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        db.run(query, [profilePicturePath, id], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to update profile picture: ' + err.message });
            }

            // Delete old profile picture if exists
            if (user && user.profile_picture) {
                const oldPath = path.join(__dirname, user.profile_picture);
                fs.unlink(oldPath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting old profile picture:', unlinkErr.message);
                });
            }

            res.json({ 
                message: 'Profile picture uploaded successfully', 
                profile_picture: profilePicturePath 
            });
        });
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

// Get sit-in records for a specific user
app.get('/api/sitin/records/user/:user_id', (req, res) => {
    const { user_id } = req.params;

    const query = `
        SELECT * FROM sit_in_records 
        WHERE user_id = ? 
        ORDER BY date DESC, time_in DESC
    `;

    db.all(query, [user_id], (err, records) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch records: ' + err.message });
        }
        res.json({ records: records });
    });
});

// Update user profile
app.put('/api/user/:id', (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, middle_name, email, course, course_level, address, current_password, new_password, remove_profile_picture } = req.body;

    // First verify current password if trying to change password
    if (new_password && current_password) {
        const current_hash = hashPassword(current_password);
        const verifyQuery = `SELECT password_hash FROM users WHERE id = ?`;

        db.get(verifyQuery, [id], (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Verification failed: ' + err.message });
            }
            if (!user || user.password_hash !== current_hash) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            // Update with new password
            const new_hash = hashPassword(new_password);
            updateProfile(id, first_name, last_name, middle_name, email, course, course_level, address, new_hash, remove_profile_picture, res);
        });
    } else {
        // Update without changing password
        updateProfile(id, first_name, last_name, middle_name, email, course, course_level, address, null, remove_profile_picture, res);
    }
});

// Helper function to update profile
function updateProfile(id, first_name, last_name, middle_name, email, course, course_level, address, password_hash, remove_profile_picture, res) {
    let query, params;

    if (remove_profile_picture) {
        // Remove profile picture
        if (password_hash) {
            query = `
                UPDATE users 
                SET first_name = ?, last_name = ?, middle_name = ?, email = ?, course = ?, 
                    course_level = ?, address = ?, password_hash = ?, profile_picture = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            params = [first_name, last_name, middle_name, email, course, course_level, address, password_hash, id];
        } else {
            query = `
                UPDATE users 
                SET first_name = ?, last_name = ?, middle_name = ?, email = ?, course = ?, 
                    course_level = ?, address = ?, profile_picture = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            params = [first_name, last_name, middle_name, email, course, course_level, address, id];
        }
    } else if (password_hash) {
        query = `
            UPDATE users 
            SET first_name = ?, last_name = ?, middle_name = ?, email = ?, course = ?, 
                course_level = ?, address = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        params = [first_name, last_name, middle_name, email, course, course_level, address, password_hash, id];
    } else {
        query = `
            UPDATE users 
            SET first_name = ?, last_name = ?, middle_name = ?, email = ?, course = ?, 
                course_level = ?, address = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        params = [first_name, last_name, middle_name, email, course, course_level, address, id];
    }

    db.run(query, params, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ error: 'Email already in use' });
            }
            return res.status(500).json({ error: 'Failed to update profile: ' + err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'Profile updated successfully' });
    });
}

// =============================================
// Notifications API
// =============================================

// Create notifications table if not exists
db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
`);

// Get notifications for a user
app.get('/api/notifications/:user_id', (req, res) => {
    const { user_id } = req.params;

    const query = `
        SELECT id, title, message, is_read as read, created_at as time
        FROM notifications 
        WHERE user_id = ? 
        ORDER BY created_at DESC
    `;

    db.all(query, [user_id], (err, notifications) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch notifications: ' + err.message });
        }
        res.json(notifications);
    });
});

// Mark notification as read
app.put('/api/notifications/:id/read', (req, res) => {
    const { id } = req.params;

    const query = `UPDATE notifications SET is_read = 1 WHERE id = ?`;

    db.run(query, [id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to update notification: ' + err.message });
        }
        res.json({ message: 'Notification marked as read' });
    });
});

// Mark all notifications as read for a user
app.put('/api/notifications/user/:user_id/read-all', (req, res) => {
    const { user_id } = req.params;

    const query = `UPDATE notifications SET is_read = 1 WHERE user_id = ?`;

    db.run(query, [user_id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to update notifications: ' + err.message });
        }
        res.json({ message: 'All notifications marked as read' });
    });
});

// Create a notification (for admin/system use)
app.post('/api/notifications', (req, res) => {
    const { user_id, title, message } = req.body;

    if (!user_id || !title || !message) {
        return res.status(400).json({ error: 'user_id, title, and message are required' });
    }

    const query = `INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`;

    db.run(query, [user_id, title, message], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to create notification: ' + err.message });
        }
        res.status(201).json({ message: 'Notification created', id: this.lastID });
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
