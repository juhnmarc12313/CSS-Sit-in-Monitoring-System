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


//Serve static
app.use(express.static('public'));

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

        // Feedbacks Table
        db.run(`
            CREATE TABLE IF NOT EXISTS feedbacks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                rating INTEGER,
                comment TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) console.error('Error creating feedbacks table:', err.message);
            else console.log('Feedbacks table created/verified');
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
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) console.error('Error creating reservations table:', err.message);
            else console.log('Reservations table created/verified');
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
                profile_picture: user.profile_picture,
                role: user.role || 'student'
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
               u.course_level, u.course, u.address, u.email, u.profile_picture, u.role
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
                role: session.role || 'student'
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
    const { user_id, lab_room, purpose } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    const query = `INSERT INTO sit_in_records (user_id, lab_room, purpose) VALUES (?, ?, ?)`;

    db.run(query, [user_id, lab_room, purpose], function (err) {
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
    const findUserQuery = `SELECT user_id FROM sit_in_records WHERE id = ?`;
    
    db.get(findUserQuery, [record_id], (err, record) => {
        if (err || !record) {
            return res.status(500).json({ error: 'Failed to find record user: ' + (err ? err.message : 'Not found') });
        }

        const userId = record.user_id;

        // Start transaction-like serialize to ensure atomic updates
        db.serialize(() => {
            // 1. Update the record time_out
            const updateRecordQuery = `UPDATE sit_in_records SET time_out = CURRENT_TIMESTAMP WHERE id = ? AND time_out IS NULL`;
            db.run(updateRecordQuery, [record_id], function(err) {
                if (err || this.changes === 0) {
                    return res.status(500).json({ error: 'Failed to update record time_out' });
                }

                // 2. Decrement student sessions
                const updateSessionsQuery = `UPDATE users SET remaining_sessions = MAX(0, remaining_sessions - 1) WHERE id = ? AND role = 'student'`;
                db.run(updateSessionsQuery, [userId], function(err) {
                    if (err) {
                        console.error('Failed to decrement sessions:', err.message);
                    }
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
    const { user_id, rating, comment } = req.body;
    
    if (!user_id || !comment) {
        return res.status(400).json({ error: 'User ID and comment are required' });
    }

    // Default rating to 5 since we removed it from the UI
    const defaultRating = rating || 5;

    const query = `INSERT INTO feedbacks (user_id, rating, comment) VALUES (?, ?, ?)`;
    db.run(query, [user_id, defaultRating, comment], function(err) {
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
    const { user_id, lab_room, date, time, purpose } = req.body;

    if (!user_id || !lab_room || !date || !time || !purpose) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    const query = `INSERT INTO reservations (user_id, lab_room, date, time, purpose) VALUES (?, ?, ?, ?, ?)`;
    db.run(query, [user_id, lab_room, date, time, purpose], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to submit reservation: ' + err.message });
        }
        res.status(201).json({ message: 'Reservation request submitted', id: this.lastID });
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

    const query = `UPDATE reservations SET status = ? WHERE id = ?`;
    db.run(query, [status, id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to update reservation: ' + err.message });
        }
        res.json({ message: 'Reservation status updated' });
    });
});

// Get computer status (mock for now)
app.get('/api/admin/computer-status', (req, res) => {
    // Mocking 10 PCs per lab
    const labs = ["Lab 524", "Lab 526", "Lab 528", "Lab 530", "Lab 544", "Lab 542"];
    const status = labs.map(lab => ({
        lab_name: lab,
        total_pcs: 30,
        available_pcs: Math.floor(Math.random() * 31),
        active_sitins: Math.floor(Math.random() * 10)
    }));
    res.json(status);
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
    const query = `SELECT id, id_number, first_name, last_name, middle_name, course, course_level, email, address, role, is_active, remaining_sessions FROM users WHERE role = 'student' ORDER BY last_name, first_name`;

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

// Get all announcements including inactive (for admin)
app.get('/api/admin/announcements', (req, res) => {
    const query = `
        SELECT a.*, u.first_name as admin_first_name, u.last_name as admin_last_name
        FROM announcements a
        JOIN users u ON a.admin_id = u.id
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
