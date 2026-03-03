"""
CivicPulse Database Module
SQLite database setup and helper functions
"""

import sqlite3
import hashlib
from datetime import datetime, timedelta
import os

# Use /tmp on Render (ephemeral but writable), local path for development
if os.environ.get('RENDER'):
    DATABASE_PATH = '/tmp/civicpulse.db'
else:
    DATABASE_PATH = os.path.join(os.path.dirname(__file__), 'civicpulse.db')

def get_db():
    """Get database connection with row factory"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def dict_from_row(row):
    """Convert sqlite3.Row to dictionary"""
    if row is None:
        return None
    return dict(row)

def init_db():
    """Initialize database tables"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            issues_reported INTEGER DEFAULT 0,
            issues_resolved INTEGER DEFAULT 0
        )
    ''')
    
    # Create admins table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            created_at TEXT NOT NULL,
            is_blocked INTEGER DEFAULT 0,
            blocked_reason TEXT DEFAULT '',
            blocked_at TEXT DEFAULT ''
        )
    ''')
    
    # Create issues table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS issues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_type TEXT NOT NULL,
            description TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            severity TEXT NOT NULL,
            status TEXT DEFAULT 'Reported',
            created_at TEXT NOT NULL,
            image TEXT,
            reported_by TEXT DEFAULT 'anonymous',
            reporter_name TEXT DEFAULT '',
            reporter_contact TEXT DEFAULT '',
            upvotes INTEGER DEFAULT 0,
            assigned_to TEXT DEFAULT '',
            assigned_at TEXT,
            assigned_by TEXT
        )
    ''')
    
    conn.commit()
    
    # Migration: Add blocking columns to admins table if they don't exist
    try:
        cursor.execute("SELECT is_blocked FROM admins LIMIT 1")
    except sqlite3.OperationalError:
        # Column doesn't exist, add it
        cursor.execute("ALTER TABLE admins ADD COLUMN is_blocked INTEGER DEFAULT 0")
        cursor.execute("ALTER TABLE admins ADD COLUMN blocked_reason TEXT DEFAULT ''")
        cursor.execute("ALTER TABLE admins ADD COLUMN blocked_at TEXT DEFAULT ''")
        conn.commit()
        print("Migration: Added admin blocking columns")
    
    # Seed admin if not exists
    cursor.execute("SELECT COUNT(*) FROM admins WHERE username = 'admin'")
    if cursor.fetchone()[0] == 0:
        password_hash = hashlib.sha256("admin123".encode()).hexdigest()
        cursor.execute('''
            INSERT INTO admins (username, password, name, email, created_at)
            VALUES (?, ?, ?, ?, ?)
        ''', ('admin', password_hash, 'System Administrator', 'admin@civicpulse.gov', datetime.now().isoformat()))
        conn.commit()
        print("Default admin created: admin / admin123")
    
    conn.close()
    print("Database initialized successfully!")

# User operations
def create_user(username, password, name, email, phone, address=""):
    """Create a new user"""
    conn = get_db()
    cursor = conn.cursor()
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    cursor.execute('''
        INSERT INTO users (username, password, name, email, phone, address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (username, password_hash, name, email, phone, address, datetime.now().isoformat()))
    conn.commit()
    user_id = cursor.lastrowid
    conn.close()
    return user_id

def get_user_by_username(username):
    """Get user by username"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    return dict_from_row(row)

def get_user_by_id(user_id):
    """Get user by ID"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    return dict_from_row(row)

def update_user(username, **kwargs):
    """Update user fields"""
    conn = get_db()
    cursor = conn.cursor()
    
    allowed_fields = ['name', 'email', 'phone', 'address']
    updates = []
    values = []
    
    for field in allowed_fields:
        if field in kwargs:
            updates.append(f"{field} = ?")
            values.append(kwargs[field])
    
    if updates:
        values.append(username)
        cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE username = ?", values)
        conn.commit()
    
    conn.close()

def update_user_password(username, new_password):
    """Update user password"""
    conn = get_db()
    cursor = conn.cursor()
    password_hash = hashlib.sha256(new_password.encode()).hexdigest()
    cursor.execute("UPDATE users SET password = ? WHERE username = ?", (password_hash, username))
    conn.commit()
    conn.close()

def get_all_users():
    """Get all users"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users")
    rows = cursor.fetchall()
    conn.close()
    return [dict_from_row(row) for row in rows]

def delete_user(username):
    """Delete a user"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM users WHERE username = ?", (username,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

def user_exists(username):
    """Check if username exists"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM users WHERE username = ?", (username,))
    count = cursor.fetchone()[0]
    conn.close()
    return count > 0

def count_users():
    """Count total users"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM users")
    count = cursor.fetchone()[0]
    conn.close()
    return count

# Admin operations
def get_admin_by_username(username):
    """Get admin by username"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM admins WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    return dict_from_row(row)

# Issue operations
def create_issue(issue_type, description, latitude, longitude, severity, 
                 image=None, reported_by="anonymous", reporter_name="", reporter_contact=""):
    """Create a new issue"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO issues (issue_type, description, latitude, longitude, severity, 
                           status, created_at, image, reported_by, reporter_name, reporter_contact, upvotes)
        VALUES (?, ?, ?, ?, ?, 'Reported', ?, ?, ?, ?, ?, 0)
    ''', (issue_type, description, latitude, longitude, severity, 
          datetime.now().isoformat(), image, reported_by, reporter_name, reporter_contact))
    conn.commit()
    issue_id = cursor.lastrowid
    
    # Get the created issue
    cursor.execute("SELECT * FROM issues WHERE id = ?", (issue_id,))
    row = cursor.fetchone()
    conn.close()
    return dict_from_row(row)

def get_all_issues():
    """Get all issues"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM issues ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict_from_row(row) for row in rows]

def get_issue_by_id(issue_id):
    """Get issue by ID"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM issues WHERE id = ?", (issue_id,))
    row = cursor.fetchone()
    conn.close()
    return dict_from_row(row)

def get_issues_by_user(username):
    """Get issues reported by a user"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM issues WHERE reported_by = ? ORDER BY created_at DESC", (username,))
    rows = cursor.fetchall()
    conn.close()
    return [dict_from_row(row) for row in rows]

def update_issue_status(issue_id, status):
    """Update issue status"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE issues SET status = ? WHERE id = ?", (status, issue_id))
    conn.commit()
    
    # Get updated issue
    cursor.execute("SELECT * FROM issues WHERE id = ?", (issue_id,))
    row = cursor.fetchone()
    conn.close()
    return dict_from_row(row)

def assign_issue(issue_id, assigned_to, assigned_by):
    """Assign an issue to someone"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE issues SET assigned_to = ?, assigned_at = ?, assigned_by = ?
        WHERE id = ?
    ''', (assigned_to, datetime.now().isoformat(), assigned_by, issue_id))
    conn.commit()
    
    cursor.execute("SELECT * FROM issues WHERE id = ?", (issue_id,))
    row = cursor.fetchone()
    conn.close()
    return dict_from_row(row)

def upvote_issue(issue_id):
    """Increment upvote count"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE issues SET upvotes = upvotes + 1 WHERE id = ?", (issue_id,))
    conn.commit()
    
    cursor.execute("SELECT upvotes FROM issues WHERE id = ?", (issue_id,))
    row = cursor.fetchone()
    conn.close()
    return row['upvotes'] if row else 0

def delete_issue(issue_id):
    """Delete an issue"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM issues WHERE id = ?", (issue_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

def count_issues():
    """Count total issues"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM issues")
    count = cursor.fetchone()[0]
    conn.close()
    return count

def count_issues_by_status(status):
    """Count issues by status"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM issues WHERE status = ?", (status,))
    count = cursor.fetchone()[0]
    conn.close()
    return count

def count_issues_by_severity(severity):
    """Count issues by severity"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM issues WHERE severity = ?", (severity,))
    count = cursor.fetchone()[0]
    conn.close()
    return count

def get_issues_by_type_count():
    """Get issue count grouped by type"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT issue_type, COUNT(*) as count FROM issues GROUP BY issue_type")
    rows = cursor.fetchall()
    conn.close()
    return {row['issue_type']: row['count'] for row in rows}

def count_recent_issues(hours=24):
    """Count issues created in the last N hours"""
    conn = get_db()
    cursor = conn.cursor()
    cutoff = (datetime.now() - __import__('datetime').timedelta(hours=hours)).isoformat()
    cursor.execute("SELECT COUNT(*) FROM issues WHERE created_at > ?", (cutoff,))
    count = cursor.fetchone()[0]
    conn.close()
    return count

def get_top_reporters(limit=5):
    """Get top issue reporters"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT reported_by, COUNT(*) as count 
        FROM issues 
        WHERE reported_by != 'anonymous'
        GROUP BY reported_by 
        ORDER BY count DESC 
        LIMIT ?
    ''', (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [{"username": row['reported_by'], "count": row['count']} for row in rows]

def count_user_issues(username):
    """Count issues reported by user"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM issues WHERE reported_by = ?", (username,))
    total = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM issues WHERE reported_by = ? AND status = 'Resolved'", (username,))
    resolved = cursor.fetchone()[0]
    conn.close()
    return {"total": total, "resolved": resolved}

# Admin blocking operations
def get_overdue_issues(days=3):
    """Get issues assigned but not resolved within specified days"""
    conn = get_db()
    cursor = conn.cursor()
    
    threshold_date = (datetime.now() - timedelta(days=days)).isoformat()
    
    cursor.execute('''
        SELECT i.*, 
               julianday('now') - julianday(i.assigned_at) as days_overdue
        FROM issues i
        WHERE i.assigned_to != '' 
        AND i.assigned_to IS NOT NULL
        AND i.status != 'Resolved'
        AND i.assigned_at IS NOT NULL
        AND i.assigned_at < ?
        ORDER BY days_overdue DESC
    ''', (threshold_date,))
    
    rows = cursor.fetchall()
    conn.close()
    return [dict_from_row(row) for row in rows]

def get_admins_with_overdue_issues(days=3):
    """Get admins who have overdue issues"""
    conn = get_db()
    cursor = conn.cursor()
    
    threshold_date = (datetime.now() - timedelta(days=days)).isoformat()
    
    cursor.execute('''
        SELECT a.*, COUNT(i.id) as overdue_count,
               MAX(julianday('now') - julianday(i.assigned_at)) as max_days_overdue
        FROM admins a
        LEFT JOIN issues i ON i.assigned_to = a.username 
            AND i.status != 'Resolved' 
            AND i.assigned_at IS NOT NULL
            AND i.assigned_at < ?
        GROUP BY a.id
        HAVING overdue_count > 0
        ORDER BY overdue_count DESC
    ''', (threshold_date,))
    
    rows = cursor.fetchall()
    conn.close()
    return [dict_from_row(row) for row in rows]

def block_admin(admin_id, reason="Overdue issues not resolved"):
    """Block an admin account"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE admins 
        SET is_blocked = 1, blocked_reason = ?, blocked_at = ?
        WHERE id = ?
    ''', (reason, datetime.now().isoformat(), admin_id))
    conn.commit()
    conn.close()
    return True

def unblock_admin(admin_id):
    """Unblock an admin account"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE admins 
        SET is_blocked = 0, blocked_reason = '', blocked_at = ''
        WHERE id = ?
    ''', (admin_id,))
    conn.commit()
    conn.close()
    return True

def get_all_admins():
    """Get all admins with their status"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM admins ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict_from_row(row) for row in rows]

def get_admin_by_id(admin_id):
    """Get admin by ID"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM admins WHERE id = ?", (admin_id,))
    row = cursor.fetchone()
    conn.close()
    return dict_from_row(row)

def auto_block_admins_with_overdue(days=3):
    """Automatically block admins who have overdue issues"""
    admins_with_overdue = get_admins_with_overdue_issues(days)
    blocked_count = 0
    
    for admin in admins_with_overdue:
        if not admin.get('is_blocked'):
            block_admin(admin['id'], f"Auto-blocked: {admin['overdue_count']} issue(s) not resolved in {days}+ days")
            blocked_count += 1
    
    return blocked_count

# Seed sample data
def add_seed_data():
    """Add sample issues if database is empty"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM issues")
    if cursor.fetchone()[0] > 0:
        conn.close()
        return  # Already has data
    
    from datetime import timedelta
    
    seed_issues = [
        ("Road Damage", "Large pothole on Avinashi Road near Tidel Park. Approximately 2 feet wide and causing traffic hazards.", 11.0205, 76.9629, "High", "Reported", 15, 2),
        ("Garbage", "Overflowing garbage bins near RS Puram bus stand. Foul smell and health hazard.", 11.0073, 76.9535, "Medium", "In Progress", 8, 0.5),
        ("Water Leak", "Underground pipe leak on Gandhipuram main road. Water pooling on sidewalk.", 11.0183, 76.9725, "Low", "Reported", 3, 0),
        ("Streetlight", "Multiple streetlights not working on Race Course Road for past 3 days.", 11.0122, 76.9631, "Medium", "Reported", 12, 5),
        ("Fire", "Small fire spotted near scrap yard in Ukkadam area. Smoke visible.", 10.9954, 76.9573, "High", "In Progress", 25, 0.75),
        ("Accident", "Traffic accident at Singanallur junction. Two vehicles involved.", 11.0052, 77.0087, "High", "Resolved", 6, 8),
        ("Noise Complaint", "Loud construction noise from building site near Brookefields Mall.", 11.0242, 76.9886, "Low", "Reported", 4, 12),
    ]
    
    for issue in seed_issues:
        created_at = (datetime.now() - timedelta(hours=issue[7])).isoformat()
        cursor.execute('''
            INSERT INTO issues (issue_type, description, latitude, longitude, severity, status, upvotes, created_at, reported_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'anonymous')
        ''', (issue[0], issue[1], issue[2], issue[3], issue[4], issue[5], issue[6], created_at))
    
    conn.commit()
    conn.close()
    print(f"Added {len(seed_issues)} sample issues to database")

if __name__ == "__main__":
    init_db()
    add_seed_data()
