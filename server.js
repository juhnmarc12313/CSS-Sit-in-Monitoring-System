const express = require('express');
require('dotenv').config();
const { createClient } = require('@libsql/client');
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


//Serve static
app.use(express.static('public'));

// Initialize Database (Turso or local SQLite)
let db;

if (process.env.DATABASE_URL) {
    console.log('Using Turso Database (libSQL):', process.env.DATABASE_URL);
    const client = createClient({
        url: process.env.DATABASE_URL,
        authToken: process.env.DATABASE_AUTH_TOKEN
    });

    // SQLite3 Compatibility Layer for Turso/libSQL
    db = {
        run: function (sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            if (!params) params = [];

            client.execute({ sql, args: params })
                .then(result => {
                    if (callback) {
                        const ctx = {
                            lastID: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : null,
                            changes: result.rowsAffected
                        };
                        callback.call(ctx, null);
                    }
                })
                .catch(err => {
                    const isDuplicateColumn = err.message && err.message.includes('duplicate column name');
                    if (!isDuplicateColumn) {
                        console.error('Turso run error:', err, 'SQL:', sql);
                    }
                    if (callback) callback(err);
                });
        },
        get: function (sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            if (!params) params = [];

            client.execute({ sql, args: params })
                .then(result => {
                    if (callback) {
                        callback(null, result.rows[0]);
                    }
                })
                .catch(err => {
                    console.error('Turso get error:', err, 'SQL:', sql);
                    if (callback) callback(err);
                });
        },
        all: function (sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            if (!params) params = [];

            client.execute({ sql, args: params })
                .then(result => {
                    if (callback) {
                        callback(null, result.rows);
                    }
                })
                .catch(err => {
                    console.error('Turso all error:', err, 'SQL:', sql);
                    if (callback) callback(err);
                });
        },
        serialize: function (callback) {
            callback();
        },
        prepare: function (sql) {
            return {
                run: function (...args) {
                    let callback = null;
                    let params = args;
                    if (typeof args[args.length - 1] === 'function') {
                        callback = args.pop();
                        params = args;
                    }
                    db.run(sql, params, callback);
                },
                finalize: function (callback) {
                    if (callback) callback();
                }
            };
        }
    };

    // Trigger initialization with delay to let connection pool settle
    setTimeout(() => {
        initializeDatabase();
    }, 100);

} else {
    console.log('Using local SQLite Database (database.db)');
    db = new sqlite3.Database('./database.db', (err) => {
        if (err) {
            console.error('Error opening database:', err.message);
        } else {
            console.log('Connected to SQLite database');
            initializeDatabase();
        }
    });
}

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
                role TEXT DEFAULT 'student',
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
                // Add role column if it doesn't exist (for existing databases)
                db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'student'`, (alterErr) => {
                    if (alterErr && !alterErr.message.includes('duplicate column name')) {
                        console.error('Error adding role column:', alterErr.message);
                    }
                });

                // Add remaining_sessions column if it doesn't exist (for existing databases)
                db.run(`ALTER TABLE users ADD COLUMN remaining_sessions INTEGER DEFAULT 30`, (alterErr) => {
                    if (alterErr && !alterErr.message.includes('duplicate column name')) {
                        console.error('Error adding remaining_sessions column:', alterErr.message);
                    }
                });

                // Create default admin account
                createDefaultAdmin();
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

                // Clear all existing sessions on server startup (force logout)
                db.run(`UPDATE sessions SET logout_time = CURRENT_TIMESTAMP WHERE logout_time IS NULL`, (clearErr) => {
                    if (clearErr) {
                        console.error('Error clearing sessions on startup:', clearErr.message);
                    } else {
                        console.log('All previous sessions cleared on server startup');
                    }
                });
            }
        });

        // Sit-in Records Table (for monitoring sit-in activities)
        db.run(`
            CREATE TABLE IF NOT EXISTS sit_in_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                lab_room TEXT,
                purpose TEXT,
                pc_number INTEGER,
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
                // Ensure pc_number column exists for sit_in_records
                db.run(`ALTER TABLE sit_in_records ADD COLUMN pc_number INTEGER`, (alterErr) => {
                    // Ignore error if column already exists
                });
            }
        });

        // Create indexes for sit-in queries
        db.run(`CREATE INDEX IF NOT EXISTS idx_sit_in_user_id ON sit_in_records(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sit_in_date ON sit_in_records(date)`);

        // Feedbacks Table
        db.run(`
            CREATE TABLE IF NOT EXISTS feedbacks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                sit_in_record_id INTEGER,
                rating INTEGER,
                comment TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (sit_in_record_id) REFERENCES sit_in_records(id) ON DELETE SET NULL
            )
        `, (err) => {
            if (err) console.error('Error creating feedbacks table:', err.message);
            else {
                console.log('Feedbacks table created/verified');
                // Ensure sit_in_record_id exists for older databases
                db.run(`ALTER TABLE feedbacks ADD COLUMN sit_in_record_id INTEGER`, (alterErr) => {
                    // Ignore error if column already exists
                });
            }
        });

        // Reservations Table
        db.run(`
            CREATE TABLE IF NOT EXISTS reservations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                lab_room TEXT NOT NULL,
                date DATE NOT NULL,
                time TIME NOT NULL,
                purpose TEXT NOT NULL,
                pc_number INTEGER,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) console.error('Error creating reservations table:', err.message);
            else {
                console.log('Reservations table created/verified');
                // Ensure pc_number column exists for reservations
                db.run(`ALTER TABLE reservations ADD COLUMN pc_number INTEGER`, (alterErr) => {
                    // Ignore error if column already exists
                });
            }
        });

        // Notifications Table
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
        `, (err) => {
            if (err) console.error('Error creating notifications table:', err.message);
            else console.log('Notifications table created/verified');
        });

        // Lab Software Table
        db.run(`
            CREATE TABLE IF NOT EXISTS lab_software (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lab_room TEXT NOT NULL,
                software_name TEXT NOT NULL,
                software_version TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) console.error('Error creating lab_software table:', err.message);
            else {
                console.log('Lab software table created/verified');
                // Seed default lab software if table is empty
                db.get(`SELECT COUNT(*) as count FROM lab_software`, [], (err, row) => {
                    if (!err && row.count === 0) {
                        const defaultSoftware = [
                            { lab: 'Lab 524', name: 'Visual Studio Code', ver: '1.87.0' },
                            { lab: 'Lab 524', name: 'Node.js', ver: '20.11.0' },
                            { lab: 'Lab 524', name: 'Python', ver: '3.12.1' },
                            { lab: 'Lab 524', name: 'Java JDK', ver: '21.0.2' },

                            { lab: 'Lab 526', name: 'C++ Compiler', ver: 'GCC 13.2' },
                            { lab: 'Lab 526', name: 'Eclipse IDE', ver: '2023-12' },
                            { lab: 'Lab 526', name: 'Visual Studio Code', ver: '1.87.0' },
                            { lab: 'Lab 526', name: 'Git', ver: '2.43.0' },

                            { lab: 'Lab 528', name: 'Android Studio', ver: '2023.1.1' },
                            { lab: 'Lab 528', name: 'IntelliJ IDEA', ver: '2023.3.2' },
                            { lab: 'Lab 528', name: 'WebStorm', ver: '2023.3.2' },
                            { lab: 'Lab 528', name: 'Node.js', ver: '20.11.0' },

                            { lab: 'Lab 530', name: 'Adobe Photoshop', ver: '2024' },
                            { lab: 'Lab 530', name: 'Adobe Premiere Pro', ver: '2024' },
                            { lab: 'Lab 530', name: 'Adobe Illustrator', ver: '2024' },
                            { lab: 'Lab 530', name: 'Blender', ver: '4.0.2' },

                            { lab: 'Lab 544', name: 'MySQL Workbench', ver: '8.0.36' },
                            { lab: 'Lab 544', name: 'Microsoft SQL Server', ver: '2022' },
                            { lab: 'Lab 544', name: 'Python', ver: '3.12.1' },
                            { lab: 'Lab 544', name: 'pgAdmin 4', ver: '8.2' },

                            { lab: 'Lab 542', name: 'Unity Hub', ver: '3.7.0' },
                            { lab: 'Lab 542', name: 'Unreal Engine', ver: '5.3.2' },
                            { lab: 'Lab 542', name: 'Blender', ver: '4.0.2' },
                            { lab: 'Lab 542', name: 'Audacity', ver: '3.4.2' }
                        ];
                        
                        const insertStmt = db.prepare(`INSERT INTO lab_software (lab_room, software_name, software_version) VALUES (?, ?, ?)`);
                        defaultSoftware.forEach(s => {
                            insertStmt.run(s.lab, s.name, s.ver);
                        });
                        insertStmt.finalize();
                        console.log('Seeded default lab software');
                    }
                });
            }
        });

        // System Settings Table
        db.run(`
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `, (err) => {
            if (err) console.error('Error creating system_settings table:', err.message);
            else {
                console.log('System settings table created/verified');
                // Seed default settings if empty
                db.get(`SELECT COUNT(*) as count FROM system_settings WHERE key = 'reservations_enabled'`, [], (err, row) => {
                    if (!err && (!row || row.count === 0)) {
                        db.run(`INSERT INTO system_settings (key, value) VALUES ('reservations_enabled', 'true')`);
                    }
                });
            }
        });
    });
}

// Create default admin account
function createDefaultAdmin() {
    const adminIdNumber = 'admin';
    const adminPassword = hashPassword('admin123');

    // Check if admin exists
    db.get(`SELECT id FROM users WHERE id_number = ?`, [adminIdNumber], (err, row) => {
        if (err) {
            console.error('Error checking for admin:', err.message);
            return;
        }

        if (!row) {
            // Create admin user
            const query = `
                INSERT INTO users (
                    id_number, last_name, first_name, middle_name, 
                    course_level, course, address, email, 
                    password_hash, role, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.run(query, [
                adminIdNumber,
                'Admin',
                'System',
                'Admin',
                0,
                'Administrator',
                'University of Cebu',
                'admin@uc.ccs',
                adminPassword,
                'admin',
                1
            ], (insertErr) => {
                if (insertErr) {
                    console.error('Error creating admin account:', insertErr.message);
                } else {
                    console.log('Default admin account created successfully!');
                    console.log('  ID Number: admin');
                    console.log('  Password: admin123');
                }
            });
        } else {
            console.log('Admin account already exists');
        }
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

    db.run(query, [id_number, last_name, first_name, middle_name, course_level, course, address, email, password_hash], function (err) {
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
                return res.status(500).json({ error: 'Session creation failed' });
            }

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
                    profile_picture: user.profile_picture,
                    role: user.role || 'student'
                },
                session_token: session_token
            });
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

    db.run(query, [session_token], function (err) {
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
               u.course_level, u.course, u.address, u.email, u.profile_picture, u.role, u.remaining_sessions
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
                profile_picture: session.profile_picture,
                role: session.role || 'student',
                remaining_sessions: session.remaining_sessions
            }
        });
    });
});

// Get user profile
app.get('/api/user/:id', (req, res) => {
    const { id } = req.params;

    const query = `SELECT id, id_number, last_name, first_name, middle_name, course_level, course, address, email, profile_picture, created_at, remaining_sessions FROM users WHERE id = ?`;

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
        db.run(query, [profilePicturePath, id], function (err) {
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
    const { user_id, lab_room, purpose, pc_number } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    const query = `INSERT INTO sit_in_records (user_id, lab_room, purpose, pc_number) VALUES (?, ?, ?, ?)`;

    db.run(query, [user_id, lab_room, purpose, pc_number || null], function (err) {
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

    // First, find the user associated with this record to decrement their sessions
    const findUserQuery = `SELECT user_id, lab_room FROM sit_in_records WHERE id = ?`;

    db.get(findUserQuery, [record_id], (err, record) => {
        if (err || !record) {
            return res.status(500).json({ error: 'Failed to find record user: ' + (err ? err.message : 'Not found') });
        }

        const userId = record.user_id;
        const labRoom = record.lab_room;

        // Start transaction-like serialize to ensure atomic updates
        db.serialize(() => {
            // 1. Update the record time_out
            const updateRecordQuery = `UPDATE sit_in_records SET time_out = CURRENT_TIMESTAMP WHERE id = ? AND time_out IS NULL`;
            db.run(updateRecordQuery, [record_id], function (err) {
                if (err || this.changes === 0) {
                    return res.status(500).json({ error: 'Failed to update record time_out' });
                }

                // 2. Decrement student sessions
                const updateSessionsQuery = `UPDATE users SET remaining_sessions = MAX(0, remaining_sessions - 1) WHERE id = ? AND role = 'student'`;
                db.run(updateSessionsQuery, [userId], function (err) {
                    if (err) {
                        console.error('Failed to decrement sessions:', err.message);
                    }
                    
                    // 3. Create notification for the user
                    const title = 'Session Ended';
                    const message = `Your sit-in session in ${labRoom || 'the lab'} has been ended by the administrator.`;
                    
                    db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`, 
                        [userId, title, message], (notifErr) => {
                            if (notifErr) console.error('Error creating checkout notification:', notifErr.message);
                        });

                    res.json({ message: 'Check-out successful and session decremented' });
                });
            });
        });
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

// =============================================
// Feedbacks API
// =============================================

// Submit feedback (student)
app.post('/api/feedbacks', (req, res) => {
    const { user_id, rating, comment, sit_in_record_id } = req.body;

    if (!user_id || !comment) {
        return res.status(400).json({ error: 'User ID and comment are required' });
    }

    // Default rating to 5
    const defaultRating = rating || 5;

    const query = `INSERT INTO feedbacks (user_id, rating, comment, sit_in_record_id) VALUES (?, ?, ?, ?)`;
    db.run(query, [user_id, defaultRating, comment, sit_in_record_id || null], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to submit feedback: ' + err.message });
        }
        res.status(201).json({ message: 'Feedback submitted successfully', id: this.lastID });
    });
});

// Get user's own feedbacks
app.get('/api/feedbacks/user/:user_id', (req, res) => {
    const { user_id } = req.params;

    const query = `
        SELECT * FROM feedbacks 
        WHERE user_id = ? 
        ORDER BY created_at DESC
    `;

    db.all(query, [user_id], (err, feedbacks) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch user feedbacks: ' + err.message });
        }
        res.json(feedbacks);
    });
});

// =============================================
// Reservations API
// =============================================

// Submit reservation request (student)
app.post('/api/reservations', (req, res) => {
    const { user_id, lab_room, date, time, purpose, pc_number } = req.body;

    if (!user_id || !lab_room || !date || !time || !purpose || !pc_number) {
        return res.status(400).json({ error: 'All fields including PC number are required' });
    }

    // Check if reservations are enabled first
    db.get(`SELECT value FROM system_settings WHERE key = 'reservations_enabled'`, [], (err, setting) => {
        if (!err && setting && setting.value === 'false') {
            return res.status(403).json({ error: 'The reservation system is currently disabled by the administrator.' });
        }

        // Check if PC is already booked/pending for this lab on this date
        const checkQuery = `SELECT id FROM reservations WHERE lab_room = ? AND date = ? AND pc_number = ? AND status IN ('approved', 'pending')`;
        db.get(checkQuery, [lab_room, date, pc_number], (checkErr, row) => {
            if (checkErr) {
                return res.status(500).json({ error: 'Database verification failed: ' + checkErr.message });
            }
            if (row) {
                return res.status(409).json({ error: `PC-${pc_number} is already reserved in ${lab_room} on this date.` });
            }

            const query = `INSERT INTO reservations (user_id, lab_room, date, time, purpose, pc_number) VALUES (?, ?, ?, ?, ?, ?)`;
            db.run(query, [user_id, lab_room, date, time, purpose, pc_number], function (err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to submit reservation: ' + err.message });
                }
                res.status(201).json({ message: 'Reservation request submitted', id: this.lastID });
            });
        });
    });
});

// Get taken PCs for a laboratory at a specific date
app.get('/api/reservations/taken', (req, res) => {
    const { lab_room, date } = req.query;

    if (!lab_room || !date) {
        return res.status(400).json({ error: 'lab_room and date are required' });
    }

    // Find all approved or pending reservations for this lab and date
    const query = `
        SELECT pc_number FROM reservations 
        WHERE lab_room = ? AND date = ? AND status IN ('approved', 'pending')
    `;

    db.all(query, [lab_room, date], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch taken PCs: ' + err.message });
        }
        const takenPCs = rows.map(row => row.pc_number).filter(val => val !== null);
        res.json({ takenPCs });
    });
});

// =============================================
// Lab Software API
// =============================================

// Get all software grouped by lab, or filtered by lab
app.get('/api/software', (req, res) => {
    const { lab_room } = req.query;
    let query = `SELECT * FROM lab_software`;
    const params = [];

    if (lab_room) {
        query += ` WHERE lab_room = ?`;
        params.push(lab_room);
    }
    query += ` ORDER BY lab_room, software_name`;

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch software: ' + err.message });
        }
        res.json(rows);
    });
});

// Add software to laboratory (admin only)
app.post('/api/admin/software', (req, res) => {
    const { lab_room, software_name, software_version } = req.body;

    if (!lab_room || !software_name) {
        return res.status(400).json({ error: 'lab_room and software_name are required' });
    }

    const query = `INSERT INTO lab_software (lab_room, software_name, software_version) VALUES (?, ?, ?)`;
    db.run(query, [lab_room, software_name, software_version || ''], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to add software: ' + err.message });
        }
        res.status(201).json({ message: 'Software added successfully', id: this.lastID });
    });
});

// Delete software (admin only)
app.delete('/api/admin/software/:id', (req, res) => {
    const { id } = req.params;

    const query = `DELETE FROM lab_software WHERE id = ?`;
    db.run(query, [id], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to delete software: ' + err.message });
        }
        res.json({ message: 'Software deleted successfully' });
    });
});

// Get user's own reservations
app.get('/api/reservations/user/:user_id', (req, res) => {
    const { user_id } = req.params;
    const query = `SELECT * FROM reservations WHERE user_id = ? ORDER BY date DESC, time DESC`;

    db.all(query, [user_id], (err, reservations) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch reservations: ' + err.message });
        }
        res.json(reservations);
    });
});

// Get system settings
app.get('/api/settings', (req, res) => {
    db.all(`SELECT key, value FROM system_settings`, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch settings: ' + err.message });
        }
        const settings = {};
        rows.forEach(row => {
            settings[row.key] = row.value;
        });
        if (settings['reservations_enabled'] === undefined) {
            settings['reservations_enabled'] = 'true';
        }
        res.json(settings);
    });
});

// Update system setting
app.post('/api/settings', (req, res) => {
    const { key, value } = req.body;

    if (!key || value === undefined) {
        return res.status(400).json({ error: 'Key and value are required' });
    }

    const query = `INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
    db.run(query, [key, String(value)], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to save setting: ' + err.message });
        }
        res.json({ message: 'Setting saved successfully', key, value });
    });
});

// Cancel reservation (student)
app.delete('/api/reservations/:id', (req, res) => {
    const { id } = req.params;

    db.get(`SELECT user_id, status, lab_room, date, time FROM reservations WHERE id = ?`, [id], (err, reservation) => {
        if (err || !reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        if (reservation.status !== 'pending' && reservation.status !== 'approved') {
            return res.status(400).json({ error: 'Only pending or approved reservations can be cancelled' });
        }

        const query = `UPDATE reservations SET status = 'cancelled' WHERE id = ?`;
        db.run(query, [id], function (err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to cancel reservation: ' + err.message });
            }

            const title = `Reservation Cancelled`;
            const message = `Your reservation for ${reservation.lab_room} on ${reservation.date} at ${reservation.time} was successfully cancelled.`;
            
            db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`, 
                [reservation.user_id, title, message]);

            res.json({ message: 'Reservation successfully cancelled' });
        });
    });
});

// Get all reservations (admin)
app.get('/api/admin/reservations', (req, res) => {
    const query = `
        SELECT r.*, u.id_number, u.first_name, u.last_name
        FROM reservations r
        JOIN users u ON r.user_id = u.id
        ORDER BY r.date DESC, r.time DESC
    `;

    db.all(query, [], (err, reservations) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch reservations: ' + err.message });
        }
        res.json(reservations);
    });
});

// Update reservation status (admin)
app.put('/api/admin/reservations/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'approved', 'denied', 'completed'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    // Get reservation details first to notify user
    db.get(`SELECT user_id, lab_room, date, time FROM reservations WHERE id = ?`, [id], (err, reservation) => {
        if (err || !reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        const query = `UPDATE reservations SET status = ? WHERE id = ?`;
        db.run(query, [status, id], function (err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to update reservation: ' + err.message });
            }
            
            // Create notification for the user
            const title = `Reservation ${status.charAt(0).toUpperCase() + status.slice(1)}`;
            const message = `Your reservation for ${reservation.lab_room} on ${reservation.date} at ${reservation.time} has been ${status}.`;
            
            db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`, 
                [reservation.user_id, title, message]);

            res.json({ message: 'Reservation status updated and user notified' });
        });
    });
});

// =============================================
// Notifications API
// =============================================

// Get notifications for a user
app.get('/api/notifications/:user_id', (req, res) => {
    const { user_id } = req.params;
    const query = `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`;
    
    db.all(query, [user_id], (err, notifications) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch notifications: ' + err.message });
        }
        res.json(notifications.map(n => ({
            ...n,
            read: !!n.is_read // Map is_read to read for frontend compatibility
        })));
    });
});

// Mark notification as read
app.put('/api/notifications/:id/read', (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE notifications SET is_read = 1 WHERE id = ?`, [id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to update notification: ' + err.message });
        }
        res.json({ message: 'Notification marked as read' });
    });
});

// Mark all notifications as read for a user
app.put('/api/notifications/user/:user_id/read-all', (req, res) => {
    const { user_id } = req.params;
    db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [user_id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to update notifications: ' + err.message });
        }
        res.json({ message: 'All notifications marked as read' });
    });
});

// Delete all notifications for a user
app.delete('/api/notifications/user/:user_id', (req, res) => {
    const { user_id } = req.params;
    db.run(`DELETE FROM notifications WHERE user_id = ?`, [user_id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to delete notifications: ' + err.message });
        }
        res.json({ message: 'All notifications deleted' });
    });
});

// Get computer status (database-dependent)
app.get('/api/admin/computer-status', (req, res) => {
    const labs = ["Lab 524", "Lab 526", "Lab 528", "Lab 530", "Lab 544", "Lab 542"];
    const totalPcsPerLab = 49;

    const query = `
        SELECT lab_room, pc_number
        FROM sit_in_records 
        WHERE time_out IS NULL
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch database status: ' + err.message });
        }

        const occupiedSeatsByLab = {};
        labs.forEach(lab => {
            occupiedSeatsByLab[lab] = [];
        });

        rows.forEach(row => {
            if (row.lab_room) {
                // Handle different potential room names in DB (e.g. Lab 1/Lab 524)
                const roomName = row.lab_room;
                const normalizedRoom = roomName.startsWith('Lab ') && !isNaN(roomName.substring(4))
                    ? roomName
                    : (roomName === 'Lab 1' ? 'Lab 524'
                      : roomName === 'Lab 2' ? 'Lab 526'
                      : roomName === 'Lab 3' ? 'Lab 528'
                      : roomName === 'Lab 4' ? 'Lab 530'
                      : roomName === 'Lab 5' ? 'Lab 542'
                      : roomName === 'Lab 6' ? 'Lab 544' : roomName);
                
                if (occupiedSeatsByLab[normalizedRoom] && row.pc_number) {
                    occupiedSeatsByLab[normalizedRoom].push(row.pc_number);
                }
            }
        });

        const status = labs.map(lab => {
            const occupiedSeats = occupiedSeatsByLab[lab] || [];
            const active = occupiedSeats.length;
            return {
                lab_name: lab,
                total_pcs: totalPcsPerLab,
                available_pcs: Math.max(0, totalPcsPerLab - active),
                active_sitins: active,
                occupied_seats: occupiedSeats
            };
        });

        res.json(status);
    });
});

// Get laboratory and purpose analytics
app.get('/api/admin/analytics', (req, res) => {
    const labQuery = `
        SELECT lab_room, COUNT(*) as count 
        FROM sit_in_records 
        WHERE lab_room IS NOT NULL AND lab_room != ''
        GROUP BY lab_room
    `;

    const purposeQuery = `
        SELECT purpose, COUNT(*) as count 
        FROM sit_in_records 
        WHERE purpose IS NOT NULL AND purpose != ''
        GROUP BY purpose 
        ORDER BY count DESC
    `;

    db.all(labQuery, [], (labErr, labRows) => {
        if (labErr) {
            return res.status(500).json({ error: 'Failed to fetch lab analytics: ' + labErr.message });
        }

        db.all(purposeQuery, [], (purposeErr, purposeRows) => {
            if (purposeErr) {
                return res.status(500).json({ error: 'Failed to fetch purpose analytics: ' + purposeErr.message });
            }

            // Normalize and group lab rooms in Javascript
            const labCounts = {};
            // Initialize all 6 labs to 0 check-ins so they always show up even if empty
            const defaultLabs = ["Lab 524", "Lab 526", "Lab 528", "Lab 530", "Lab 542", "Lab 544"];
            defaultLabs.forEach(l => {
                labCounts[l] = 0;
            });

            labRows.forEach(row => {
                const roomName = row.lab_room;
                const normalizedRoom = roomName === 'Lab 1' ? 'Lab 524'
                      : roomName === 'Lab 2' ? 'Lab 526'
                      : roomName === 'Lab 3' ? 'Lab 528'
                      : roomName === 'Lab 4' ? 'Lab 530'
                      : roomName === 'Lab 5' ? 'Lab 542'
                      : roomName === 'Lab 6' ? 'Lab 544' : roomName;
                
                labCounts[normalizedRoom] = (labCounts[normalizedRoom] || 0) + row.count;
            });

            // Convert back to sorted array
            const formattedLabs = Object.keys(labCounts).map(key => ({
                lab_room: key,
                count: labCounts[key]
            })).sort((a, b) => b.count - a.count);

            res.json({
                labs: formattedLabs,
                purposes: purposeRows
            });
        });
    });
});

// Get individual student sit-in summary
app.get('/api/user/:userId/sit-in-summary', (req, res) => {
    const { userId } = req.params;

    const query = `
        SELECT time_in, time_out 
        FROM sit_in_records 
        WHERE user_id = ? AND time_out IS NOT NULL
    `;

    db.all(query, [userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch sit-in records: ' + err.message });
        }

        let totalSessions = rows.length;
        let totalDurationMs = 0;
        let longestSessionMs = 0;

        rows.forEach(row => {
            const timeIn = new Date(row.time_in);
            const timeOut = new Date(row.time_out);
            const durationMs = Math.max(0, timeOut - timeIn);

            totalDurationMs += durationMs;
            if (durationMs > longestSessionMs) {
                longestSessionMs = durationMs;
            }
        });

        const totalHours = (totalDurationMs / (1000 * 60 * 60)).toFixed(1);
        const averageDurationMins = totalSessions > 0 
            ? Math.round((totalDurationMs / (1000 * 60)) / totalSessions) 
            : 0;
        const longestDurationMins = Math.round(longestSessionMs / (1000 * 60));

        res.json({
            totalHours: parseFloat(totalHours),
            totalSessions: totalSessions,
            averageDurationMins: averageDurationMins,
            longestDurationMins: longestDurationMins
        });
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

// Update user role (admin only)
app.put('/api/user/:id/role', (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!role || !['student', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role. Must be student or admin' });
    }

    const query = `UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    db.run(query, [role, id], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to update role: ' + err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'Role updated successfully', role: role });
    });
});

// =============================================
// Admin API Endpoints
// =============================================

// Get all students (admin)
app.get('/api/admin/students', (req, res) => {
    const query = `SELECT id, id_number, first_name, last_name, middle_name, course, course_level, email, address, role, is_active, remaining_sessions FROM users WHERE role = 'student' AND is_active = 1 ORDER BY last_name, first_name`;

    db.all(query, [], (err, students) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch students: ' + err.message });
        }
        res.json(students);
    });
});

// Add new student (admin)
app.post('/api/admin/students', (req, res) => {
    const { id_number, first_name, last_name, middle_name, email, course, course_level, address, password, remaining_sessions } = req.body;

    if (!id_number || !first_name || !last_name || !email || !course || !course_level || !password) {
        return res.status(400).json({ error: 'All required fields must be filled' });
    }

    const password_hash = crypto.createHash('sha256').update(password).digest('hex');
    const sessions = remaining_sessions !== undefined ? remaining_sessions : 30;

    const query = `
        INSERT INTO users (id_number, first_name, last_name, middle_name, email, course, course_level, address, password_hash, role, is_active, remaining_sessions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'student', 1, ?)
    `;

    db.run(query, [id_number, first_name, last_name, middle_name || null, email, course, course_level, address || null, password_hash, sessions], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                if (err.message.includes('id_number')) {
                    return res.status(409).json({ error: 'ID Number already exists' });
                } else if (err.message.includes('email')) {
                    return res.status(409).json({ error: 'Email already exists' });
                }
            }
            return res.status(500).json({ error: 'Failed to add student: ' + err.message });
        }
        res.json({ id: this.lastID, message: 'Student added successfully' });
    });
});

// Update student remaining sessions (admin)
app.put('/api/admin/students/:id/sessions', (req, res) => {
    const { id } = req.params;
    const { remaining_sessions } = req.body;

    if (remaining_sessions === undefined || remaining_sessions < 0) {
        return res.status(400).json({ error: 'Valid remaining_sessions value is required' });
    }

    const query = `UPDATE users SET remaining_sessions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND role = 'student'`;

    db.run(query, [remaining_sessions, id], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to update remaining sessions: ' + err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        res.json({ message: 'Remaining sessions updated successfully' });
    });
});

// Delete student (admin)
app.delete('/api/admin/students/:id', (req, res) => {
    const { id } = req.params;

    // Soft delete - set is_active to 0
    const query = `UPDATE users SET is_active = 0 WHERE id = ? AND role = 'student'`;

    db.run(query, [id], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to delete student: ' + err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        res.json({ message: 'Student deleted successfully' });
    });
});

// Get admin dashboard stats
app.get('/api/admin/stats', (req, res) => {
    const stats = {};

    // Get total students
    db.get(`SELECT COUNT(*) as count FROM users WHERE is_active = 1`, [], (err, row) => {
        if (err) {
            stats.totalStudents = 0;
        } else {
            stats.totalStudents = row.count;
        }

        // Get active sit-ins
        db.get(`SELECT COUNT(*) as count FROM sit_in_records WHERE time_out IS NULL`, [], (err, row) => {
            if (err) {
                stats.activeSitins = 0;
            } else {
                stats.activeSitins = row.count;
            }

            // Get today's reservations
            const today = new Date().toISOString().split('T')[0];
            db.get(`SELECT COUNT(*) as count FROM reservations WHERE date = ?`, [today], (err, row) => {
                if (err) {
                    stats.todayReservations = 0;
                } else {
                    stats.todayReservations = row.count;
                }

                // Get total feedbacks
                db.get(`SELECT COUNT(*) as count FROM feedbacks`, [], (err, row) => {
                    if (err) {
                        stats.totalFeedbacks = 0;
                    } else {
                        stats.totalFeedbacks = row.count;
                    }
                    res.json(stats);
                });
            });
        });
    });
});

// Get all sit-in records (admin)
app.get('/api/admin/records', (req, res) => {
    const { date, lab_room } = req.query;
    let query = `
        SELECT sr.*, u.id_number, u.first_name, u.last_name, u.course, u.remaining_sessions
        FROM sit_in_records sr
        JOIN users u ON sr.user_id = u.id
        WHERE 1=1
    `;
    const params = [];

    if (date) {
        query += ` AND sr.date = ?`;
        params.push(date);
    }
    if (lab_room) {
        query += ` AND sr.lab_room = ?`;
        params.push(lab_room);
    }

    query += ` ORDER BY sr.date DESC, sr.time_in DESC`;

    db.all(query, params, (err, records) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch records: ' + err.message });
        }
        res.json(records);
    });
});

// Get sit-in reports data with analytics (admin)
app.get('/api/admin/sitin-reports', (req, res) => {
    const { dateFrom, dateTo, labRoom, course } = req.query;
    let query = `
        SELECT sr.*, u.id_number, u.first_name, u.last_name, u.course, u.course_level
        FROM sit_in_records sr
        JOIN users u ON sr.user_id = u.id
        WHERE 1=1
    `;
    const params = [];

    if (dateFrom) {
        query += ` AND sr.date >= ?`;
        params.push(dateFrom);
    }
    if (dateTo) {
        query += ` AND sr.date <= ?`;
        params.push(dateTo);
    }
    if (labRoom) {
        query += ` AND sr.lab_room = ?`;
        params.push(labRoom);
    }
    if (course) {
        query += ` AND u.course = ?`;
        params.push(course);
    }

    query += ` ORDER BY sr.date DESC, sr.time_in DESC`;

    db.all(query, params, (err, records) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch reports: ' + err.message });
        }
        res.json(records);
    });
});

// Get currently active sit-ins (admin)
app.get('/api/admin/active-sitins', (req, res) => {
    const query = `
        SELECT sr.*, u.id_number, u.first_name, u.last_name, u.course, u.course_level, u.remaining_sessions
        FROM sit_in_records sr
        JOIN users u ON sr.user_id = u.id
        WHERE sr.time_out IS NULL
        ORDER BY sr.time_in DESC
    `;

    db.all(query, [], (err, records) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch active sit-ins: ' + err.message });
        }
        res.json(records);
    });
});

// Search students (admin)
app.get('/api/admin/search', (req, res) => {
    const { q } = req.query;

    if (!q) {
        return res.json([]);
    }

    const query = `
        SELECT id, id_number, first_name, last_name, course, course_level, email
        FROM users 
        WHERE is_active = 1 AND (
            id_number LIKE ? OR 
            first_name LIKE ? OR 
            last_name LIKE ? OR
            email LIKE ?
        )
        LIMIT 20
    `;
    const searchTerm = `%${q}%`;

    db.all(query, [searchTerm, searchTerm, searchTerm, searchTerm], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Search failed: ' + err.message });
        }
        res.json(results);
    });
});

// Get student by ID number (admin)
app.get('/api/admin/student/:idNumber', (req, res) => {
    const { idNumber } = req.params;

    if (!idNumber) {
        return res.status(400).json({ error: 'ID number is required' });
    }

    const query = `
        SELECT id, id_number, first_name, last_name, middle_name, email, course, course_level, is_active, created_at, remaining_sessions
        FROM users 
        WHERE id_number = ? AND role = 'student'
    `;

    db.get(query, [idNumber], (err, student) => {
        if (err) {
            console.error('Search error:', err.message);
            return res.status(500).json({ error: 'Search failed: ' + err.message });
        }
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        res.json(student);
    });
});

// Search students by ID number or name (admin)
app.get('/api/admin/students/search', (req, res) => {
    const { q } = req.query;
    const session_token = req.headers.authorization?.replace('Bearer ', '');

    // Skip authorization check for now - just search
    if (!q || q.trim().length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const searchTerm = `%${q.trim()}%`;
    const query = `
        SELECT id, id_number, first_name, last_name, middle_name, email, course, course_level, is_active, created_at, remaining_sessions
        FROM users 
        WHERE (id_number LIKE ? OR first_name LIKE ? OR last_name LIKE ?)
        AND role = 'student'
        ORDER BY last_name, first_name
        LIMIT 20
    `;

    db.all(query, [searchTerm, searchTerm, searchTerm], (err, students) => {
        if (err) {
            console.error('Search error:', err.message);
            return res.status(500).json({ error: 'Search failed: ' + err.message });
        }
        res.json(students);
    });
});

// Get feedbacks (admin)
app.get('/api/admin/feedbacks', (req, res) => {
    const query = `
        SELECT f.*, u.id_number, u.first_name, u.last_name
        FROM feedbacks f
        JOIN users u ON f.user_id = u.id
        ORDER BY f.created_at DESC
    `;

    db.all(query, [], (err, feedbacks) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch feedbacks: ' + err.message });
        }
        res.json(feedbacks);
    });
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

    db.run(query, params, function (err) {
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

// Create announcements table if not exists
db.run(`
    CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        priority TEXT DEFAULT 'normal',
        admin_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
    )
`);

// Add priority column if it doesn't exist
db.run(`ALTER TABLE announcements ADD COLUMN priority TEXT DEFAULT 'normal'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding priority column:', err.message);
    }
});

// Get all active announcements (for students)
app.get('/api/announcements', (req, res) => {
    const query = `
        SELECT a.*, u.first_name as admin_first_name, u.last_name as admin_last_name
        FROM announcements a
        JOIN users u ON a.admin_id = u.id
        WHERE a.is_active = 1
        ORDER BY a.created_at DESC
    `;

    db.all(query, [], (err, announcements) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch announcements: ' + err.message });
        }
        res.json(announcements);
    });
});

// Get all active announcements (for admin)
app.get('/api/admin/announcements', (req, res) => {
    const query = `
        SELECT a.*, u.first_name as admin_first_name, u.last_name as admin_last_name
        FROM announcements a
        JOIN users u ON a.admin_id = u.id
        WHERE a.is_active = 1
        ORDER BY a.created_at DESC
    `;

    db.all(query, [], (err, announcements) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch announcements: ' + err.message });
        }
        res.json(announcements);
    });
});

// Create new announcement (admin)
app.post('/api/admin/announcements', (req, res) => {
    const { title, content, priority } = req.body;
    const session_token = req.headers.authorization?.replace('Bearer ', '');

    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }

    if (!session_token) {
        return res.status(401).json({ error: 'Unauthorized - No session token' });
    }

    // Get user from session token
    const userQuery = `SELECT user_id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = ? AND s.logout_time IS NULL`;
    db.get(userQuery, [session_token], (err, session) => {
        if (err || !session) {
            return res.status(401).json({ error: 'Unauthorized - Invalid session' });
        }

        if (session.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }

        const adminId = session.user_id;

        const query = `
            INSERT INTO announcements (title, content, priority, admin_id)
            VALUES (?, ?, ?, ?)
        `;

        db.run(query, [title, content, priority || 'normal', adminId], function (err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to create announcement: ' + err.message });
            }
            res.json({ id: this.lastID, message: 'Announcement created successfully' });
        });
    });
});

// Delete/remove announcement (admin)
app.delete('/api/admin/announcements/:id', (req, res) => {
    const { id } = req.params;
    const session_token = req.headers.authorization?.replace('Bearer ', '');

    if (!session_token) {
        return res.status(401).json({ error: 'Unauthorized - No session token' });
    }

    // Get user from session token
    const userQuery = `SELECT user_id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = ? AND s.logout_time IS NULL`;
    db.get(userQuery, [session_token], (err, session) => {
        if (err || !session) {
            return res.status(401).json({ error: 'Unauthorized - Invalid session' });
        }

        if (session.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }

        // Soft delete - set is_active to 0
        const query = `UPDATE announcements SET is_active = 0 WHERE id = ?`;

        db.run(query, [id], function (err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to remove announcement: ' + err.message });
            }
            res.json({ message: 'Announcement removed successfully' });
        });
    });
});

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

    db.run(query, [id], function (err) {
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

    db.run(query, [user_id], function (err) {
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

    db.run(query, [user_id, title, message], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to create notification: ' + err.message });
        }
        res.status(201).json({ message: 'Notification created', id: this.lastID });
    });
});

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, '/pages/login.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, '/pages/Register.html'));
});

app.get('/community.html', (req, res) => {
    res.sendFile(path.join(__dirname, '/pages/community.html'));
});

app.get('/aboutus.html', (req, res) => {
    res.sendFile(path.join(__dirname, '/pages/aboutus.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, '/pages/dashboard.html'));
});

// =============================================
// Start Server
// =============================================

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    if (db && typeof db.close === 'function') {
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err.message);
            } else {
                console.log('Database connection closed');
            }
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

module.exports = app;
