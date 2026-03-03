"""
CivicPulse – Smart Public Issue & Emergency Intelligence System
Flask Backend API with SQLite Database

This module provides a REST API for managing public issues and emergencies.
Features:
- CRUD operations for issues
- Priority scoring based on severity and age
- Statistics endpoint for dashboard
- User and Admin authentication
- Role-based access control
- SQLite database for persistent storage
"""

from flask import Flask, render_template, request, jsonify, session, redirect, url_for, Response
from flask_cors import CORS
from datetime import datetime, timedelta
from functools import wraps
from werkzeug.utils import secure_filename
import hashlib
import secrets
import os
import requests
import csv
import io
import uuid

# OpenCV for image-based severity detection
import cv2
import numpy as np

# Import database module
import database as db

app = Flask(__name__)

# ============================================================================
# UPLOAD CONFIGURATION
# ============================================================================
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# ============================================================================
# FAST2SMS CONFIGURATION
# ============================================================================
FAST2SMS_API_KEY = os.environ.get('FAST2SMS_API_KEY', 'NdwiE4eLHtCKfSJVpWkXT6YRg5F9BvZDsIjyAno8hbGQzPU0OuRlrh3gmBtxpDjXvfOTYSG7JCqQEWP9')
app.secret_key = secrets.token_hex(32)  # Secret key for sessions

# Enable CORS for all routes to allow cross-origin requests from frontend
CORS(app, supports_credentials=True)

# Valid values for issue fields (used for validation)
VALID_ISSUE_TYPES = ["Garbage", "Water Leak", "Road Damage", "Fire", "Accident", "Streetlight", "Noise Complaint", "Other"]
VALID_SEVERITIES = ["Low", "Medium", "High"]
VALID_STATUSES = ["Reported", "In Progress", "Resolved"]


# ============================================================================
# AUTOMATED SEVERITY DETECTION
# ============================================================================

# Keywords that indicate high severity
HIGH_SEVERITY_KEYWORDS = [
    # Emergency/danger words
    'emergency', 'urgent', 'critical', 'danger', 'dangerous', 'hazard', 'hazardous',
    'life-threatening', 'death', 'dying', 'fatal', 'severe', 'serious',
    # Fire-related
    'fire', 'burning', 'flames', 'smoke', 'explosion', 'blast',
    # Accident-related
    'accident', 'crash', 'collision', 'injured', 'injury', 'casualties', 'victim',
    'ambulance', 'hospital', 'blood', 'unconscious',
    # Infrastructure danger
    'collapse', 'collapsing', 'sinkhole', 'flood', 'flooding', 'electrocution',
    'exposed wire', 'live wire', 'gas leak', 'chemical', 'toxic',
    # Size/scale
    'massive', 'huge', 'large', 'major', 'widespread', 'multiple', 'many',
    'blocking', 'blocked', 'impassable'
]

# Keywords that indicate medium severity
MEDIUM_SEVERITY_KEYWORDS = [
    # Infrastructure issues
    'pothole', 'crack', 'broken', 'damaged', 'leaking', 'leak', 'burst',
    'not working', 'malfunctioning', 'faulty', 'defective',
    # Environmental
    'overflowing', 'overflow', 'smell', 'foul', 'stench', 'dirty',
    'pollution', 'polluted', 'contaminated',
    # Traffic/access
    'traffic', 'congestion', 'slow', 'delay', 'obstruction',
    # Duration/persistence
    'days', 'week', 'weeks', 'month', 'persistent', 'ongoing', 'continuous',
    # Health concerns
    'health', 'disease', 'mosquito', 'insects', 'rats', 'pests'
]

# Issue types with inherent high severity
HIGH_SEVERITY_TYPES = ['Fire', 'Accident']

# Issue types with inherent medium severity
MEDIUM_SEVERITY_TYPES = ['Road Damage', 'Water Leak']


def detect_severity(issue_type, description):
    """
    Automatically detect severity level based on issue type and description.
    Returns: tuple (severity_level, confidence_score, matched_keywords)
    """
    description_lower = description.lower()
    matched_keywords = []
    
    # Check for high severity keywords
    high_matches = [kw for kw in HIGH_SEVERITY_KEYWORDS if kw in description_lower]
    matched_keywords.extend(high_matches)
    
    # Check for medium severity keywords
    medium_matches = [kw for kw in MEDIUM_SEVERITY_KEYWORDS if kw in description_lower]
    
    # Calculate severity score
    score = 0
    
    # Issue type base score
    if issue_type in HIGH_SEVERITY_TYPES:
        score += 70
    elif issue_type in MEDIUM_SEVERITY_TYPES:
        score += 40
    else:
        score += 20
    
    # Keyword scoring
    score += len(high_matches) * 15
    score += len(medium_matches) * 8
    
    # Description length bonus (longer descriptions often indicate more serious issues)
    if len(description) > 200:
        score += 10
    elif len(description) > 100:
        score += 5
    
    # Determine severity level
    if score >= 70 or len(high_matches) >= 2:
        severity = "High"
        confidence = min(95, 60 + len(high_matches) * 10)
    elif score >= 40 or len(medium_matches) >= 2:
        severity = "Medium"
        confidence = min(90, 50 + len(medium_matches) * 8 + len(high_matches) * 5)
    else:
        severity = "Low"
        confidence = min(85, 40 + (40 - score))
    
    matched_keywords.extend(medium_matches)
    
    return severity, confidence, list(set(matched_keywords))


# ============================================================================
# OPENCV IMAGE-BASED SEVERITY DETECTION
# ============================================================================

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def calculate_severity_from_image(image_path):
    """
    Calculate issue severity from image using OpenCV.
    Analyzes multiple factors: edges, colors, damage indicators, warning markers.
    Works for garbage, road damage, landslides, infrastructure issues.
    
    Returns: tuple (severity, confidence, analysis_data)
    """
    try:
        # Read image
        img = cv2.imread(image_path)
        if img is None:
            return None, 0, {"error": "Could not read image"}
        
        # Get image dimensions
        height, width = img.shape[:2]
        total_pixels = height * width
        
        # Convert to different color spaces
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        
        # Apply Gaussian blur to reduce noise
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # ===== 1. Edge Detection (texture complexity) =====
        edges = cv2.Canny(blurred, 50, 150)
        edge_pixels = np.count_nonzero(edges)
        edge_ratio = edge_pixels / total_pixels
        
        # ===== 2. Color Variance Analysis =====
        h_variance = np.var(hsv[:, :, 0])
        s_variance = np.var(hsv[:, :, 1])
        v_variance = np.var(hsv[:, :, 2])
        color_variance = (h_variance + s_variance + v_variance) / 3
        
        # ===== 3. Damage Color Detection (earth/debris - brown, tan, dirt) =====
        # Earth tones: brown, tan, beige (landslide, road damage, debris)
        # HSV ranges for earth/dirt colors
        lower_earth1 = np.array([5, 30, 50])   # Light brown/tan
        upper_earth1 = np.array([25, 255, 200])
        lower_earth2 = np.array([0, 20, 80])   # Darker earth
        upper_earth2 = np.array([20, 150, 180])
        
        earth_mask1 = cv2.inRange(hsv, lower_earth1, upper_earth1)
        earth_mask2 = cv2.inRange(hsv, lower_earth2, upper_earth2)
        earth_mask = cv2.bitwise_or(earth_mask1, earth_mask2)
        earth_pixels = np.count_nonzero(earth_mask)
        earth_ratio = earth_pixels / total_pixels
        
        # ===== 4. Warning Color Detection (orange cones, safety markers) =====
        # Orange: typical safety cone color
        lower_orange = np.array([5, 150, 150])
        upper_orange = np.array([25, 255, 255])
        orange_mask = cv2.inRange(hsv, lower_orange, upper_orange)
        orange_pixels = np.count_nonzero(orange_mask)
        warning_ratio = orange_pixels / total_pixels
        
        # ===== 5. Dark Crack Detection (road cracks, structural damage) =====
        # Look for very dark areas that could be cracks or holes
        dark_threshold = 40
        dark_mask = gray < dark_threshold
        dark_pixels = np.count_nonzero(dark_mask)
        dark_ratio = dark_pixels / total_pixels
        
        # ===== 6. Structural Irregularity (large contours indicating damage) =====
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        large_contours = [c for c in contours if cv2.contourArea(c) > (total_pixels * 0.01)]
        irregularity_score = len(large_contours) / max(1, len(contours)) if contours else 0
        
        # ===== Calculate Severity Score =====
        severity_score = 0
        indicators = []
        
        # Edge complexity contributes
        if edge_ratio > 0.20:
            severity_score += 25
            indicators.append("high_texture_complexity")
        elif edge_ratio > 0.12:
            severity_score += 15
            indicators.append("moderate_texture")
        
        # Earth/debris colors (strong indicator of damage)
        if earth_ratio > 0.30:
            severity_score += 35
            indicators.append("major_earth_exposure")
        elif earth_ratio > 0.15:
            severity_score += 20
            indicators.append("significant_debris")
        elif earth_ratio > 0.08:
            severity_score += 10
            indicators.append("some_debris")
        
        # Warning markers present
        if warning_ratio > 0.005:
            severity_score += 20
            indicators.append("safety_markers_present")
        elif warning_ratio > 0.001:
            severity_score += 10
            indicators.append("warning_signs")
        
        # Dark areas (cracks, holes, damage)
        if dark_ratio > 0.15:
            severity_score += 15
            indicators.append("major_dark_areas")
        elif dark_ratio > 0.08:
            severity_score += 8
            indicators.append("cracks_detected")
        
        # Color variance (chaos/destruction indicator)
        if color_variance > 2500:
            severity_score += 15
            indicators.append("high_color_chaos")
        elif color_variance > 1500:
            severity_score += 8
            indicators.append("color_variation")
        
        # Large irregular contours (structural damage)
        if irregularity_score > 0.3:
            severity_score += 10
            indicators.append("structural_irregularity")
        
        # Determine final severity
        if severity_score >= 50:
            severity = "High"
            confidence = min(95, 75 + int(severity_score / 5))
        elif severity_score >= 25:
            severity = "Medium"
            confidence = min(90, 60 + int(severity_score / 3))
        else:
            severity = "Low"
            confidence = min(85, 50 + int(severity_score))
        
        analysis_data = {
            "edge_ratio": round(edge_ratio, 4),
            "earth_ratio": round(earth_ratio, 4),
            "warning_ratio": round(warning_ratio, 5),
            "dark_ratio": round(dark_ratio, 4),
            "color_variance": round(color_variance, 2),
            "severity_score": severity_score,
            "indicators": indicators,
            "image_dimensions": f"{width}x{height}",
            "severity": severity,
            "confidence": confidence
        }
        
        return severity, confidence, analysis_data
        
    except Exception as e:
        print(f"Error analyzing image: {e}")
        return None, 0, {"error": str(e)}


def save_uploaded_image(file):
    """
    Save uploaded image file and return the path.
    Returns: (filename, filepath) or (None, None) on error
    """
    if file and allowed_file(file.filename):
        # Generate unique filename
        ext = file.filename.rsplit('.', 1)[1].lower()
        unique_filename = f"{uuid.uuid4().hex}.{ext}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        file.save(filepath)
        return unique_filename, filepath
    return None, None


# ============================================================================
# AUTHENTICATION HELPERS
# ============================================================================

def hash_password(password):
    """Hash a password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

def login_required(f):
    """Decorator to require user login"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session and 'admin_id' not in session:
            return jsonify({"error": "Authentication required"}), 401
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    """Decorator to require admin login"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'admin_id' not in session:
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return decorated_function

def require_auth(admin_only=False):
    """Flexible auth decorator supporting admin_only mode"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if admin_only:
                if 'admin_id' not in session:
                    return jsonify({"error": "Admin access required"}), 403
            else:
                if 'user_id' not in session and 'admin_id' not in session:
                    return jsonify({"error": "Authentication required"}), 401
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def get_current_user():
    """Get current logged-in user info"""
    if 'user_id' in session:
        username = session.get('username')
        user = db.get_user_by_username(username)
        return {"type": "user", "user": user} if user else None
    elif 'admin_id' in session:
        username = session.get('username')
        admin = db.get_admin_by_username(username)
        return {"type": "admin", "user": admin} if admin else None
    return None


# ============================================================================
# SMS NOTIFICATION FUNCTION (Fast2SMS)
# ============================================================================

def send_sms_notification(phone_number, message):
    """
    Send an SMS notification using Fast2SMS API.
    """
    if not FAST2SMS_API_KEY:
        print(f"[SMS] Fast2SMS not configured. Would send to {phone_number}: {message}")
        return False
    
    try:
        clean_phone = phone_number.replace('+91', '').replace(' ', '').replace('-', '').strip()
        if len(clean_phone) > 10:
            clean_phone = clean_phone[-10:]
        
        url = "https://www.fast2sms.com/dev/bulkV2"
        headers = {
            "authorization": FAST2SMS_API_KEY,
            "Content-Type": "application/json"
        }
        payload = {
            "route": "q",
            "message": message,
            "language": "english",
            "flash": 0,
            "numbers": clean_phone
        }
        
        response = requests.post(url, json=payload, headers=headers)
        result = response.json()
        
        if result.get('return'):
            print(f"[SMS] Notification sent to {clean_phone}")
            return True
        else:
            print(f"[SMS] Failed: {result.get('message', 'Unknown error')}")
            return False
            
    except Exception as e:
        print(f"[SMS] Failed to send notification: {e}")
        return False


def notify_issue_resolved(issue):
    """Send SMS notification when an issue is resolved."""
    username = issue.get("reported_by", "anonymous")
    if username == "anonymous":
        print(f"[SMS] Cannot notify - anonymous user")
        return
    
    user = db.get_user_by_username(username)
    if not user:
        print(f"[SMS] Cannot notify - user not found: {username}")
        return
    
    phone = user.get("phone")
    if not phone:
        print(f"[SMS] Cannot notify - no phone number for user: {username}")
        return
    
    message = f"CivicPulse: Great news! Your issue ({issue.get('issue_type')}) has been RESOLVED. Thank you for helping improve our city!"
    send_sms_notification(phone, message)


# ============================================================================
# PRIORITY SCORE CALCULATION
# ============================================================================

def priority_score(issue):
    """Calculate priority score for an issue based on severity and age."""
    score = 0
    
    severity = issue.get("severity", "Low")
    if severity == "High":
        score += 50
    elif severity == "Medium":
        score += 30
    else:
        score += 10
    
    try:
        created_at = datetime.fromisoformat(issue["created_at"])
        age = datetime.now() - created_at
        if age > timedelta(hours=1):
            score += 10
    except:
        pass
    
    return min(100, score)


# ============================================================================
# AUTHENTICATION ROUTES
# ============================================================================

@app.route("/api/auth/register", methods=["POST"])
def register():
    """Register a new user"""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    required = ["username", "password", "name", "email", "phone"]
    for field in required:
        if field not in data or not data[field]:
            return jsonify({"error": f"Missing field: {field}"}), 400
    
    username = data["username"].lower().strip()
    
    if db.user_exists(username):
        return jsonify({"error": "Username already exists"}), 400
    
    if len(data["password"]) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    
    user_id = db.create_user(
        username=username,
        password=data["password"],
        name=data["name"],
        email=data["email"],
        phone=data["phone"],
        address=data.get("address", "")
    )
    
    user = db.get_user_by_id(user_id)
    
    # Auto-login after registration
    session['user_id'] = user['id']
    session['username'] = username
    session['role'] = 'user'
    
    return jsonify({
        "message": "Registration successful",
        "user": {k: v for k, v in user.items() if k != 'password'}
    }), 201

@app.route("/api/auth/login", methods=["POST"])
def login():
    """User login"""
    data = request.get_json()
    
    if not data or "username" not in data or "password" not in data:
        return jsonify({"error": "Username and password required"}), 400
    
    username = data["username"].lower().strip()
    password_hash = hash_password(data["password"])
    
    user = db.get_user_by_username(username)
    if user and user["password"] == password_hash:
        session['user_id'] = user['id']
        session['username'] = username
        session['role'] = 'user'
        return jsonify({
            "message": "Login successful",
            "user": {k: v for k, v in user.items() if k != 'password'},
            "role": "user"
        }), 200
    
    return jsonify({"error": "Invalid username or password"}), 401

@app.route("/api/auth/admin/login", methods=["POST"])
def admin_login():
    """Admin login"""
    data = request.get_json()
    
    if not data or "username" not in data or "password" not in data:
        return jsonify({"error": "Username and password required"}), 400
    
    username = data["username"].lower().strip()
    password_hash = hash_password(data["password"])
    
    admin = db.get_admin_by_username(username)
    if admin and admin["password"] == password_hash:
        # Check if admin is blocked
        if admin.get("is_blocked"):
            return jsonify({
                "error": "Account blocked",
                "blocked": True,
                "reason": admin.get("blocked_reason", "Your account has been blocked due to unresolved issues."),
                "blocked_at": admin.get("blocked_at", "")
            }), 403
        
        session['admin_id'] = admin['id']
        session['username'] = username
        session['role'] = 'admin'
        return jsonify({
            "message": "Admin login successful",
            "admin": {k: v for k, v in admin.items() if k != 'password'},
            "role": "admin"
        }), 200
    
    return jsonify({"error": "Invalid admin credentials"}), 401

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    """Logout current user/admin"""
    session.clear()
    return jsonify({"message": "Logged out successfully"}), 200

@app.route("/api/auth/me", methods=["GET"])
def get_current_session():
    """Get current session info"""
    current = get_current_user()
    if current:
        user_data = {k: v for k, v in current["user"].items() if k != 'password'}
        return jsonify({
            "authenticated": True,
            "role": current["type"],
            "user": user_data
        }), 200
    return jsonify({"authenticated": False}), 200


# ============================================================================
# USER PROFILE ROUTES
# ============================================================================

@app.route("/api/user/profile", methods=["GET"])
@login_required
def get_profile():
    """Get user profile"""
    current = get_current_user()
    if not current:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_data = {k: v for k, v in current["user"].items() if k != 'password'}
    
    if current["type"] == "user":
        username = session.get('username')
        counts = db.count_user_issues(username)
        user_data["issues_reported"] = counts["total"]
        user_data["issues_resolved"] = counts["resolved"]
    
    return jsonify(user_data), 200

@app.route("/api/user/profile", methods=["PUT"])
@login_required
def update_profile():
    """Update user profile"""
    if 'user_id' not in session:
        return jsonify({"error": "User access required"}), 403
    
    data = request.get_json()
    username = session.get('username')
    
    user = db.get_user_by_username(username)
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    updates = {}
    if "name" in data:
        updates["name"] = data["name"]
    if "email" in data:
        updates["email"] = data["email"]
    if "phone" in data:
        updates["phone"] = data["phone"]
    if "address" in data:
        updates["address"] = data["address"]
    
    if updates:
        db.update_user(username, **updates)
    
    updated_user = db.get_user_by_username(username)
    return jsonify({
        "message": "Profile updated",
        "user": {k: v for k, v in updated_user.items() if k != 'password'}
    }), 200

@app.route("/api/user/issues", methods=["GET"])
@login_required
def get_user_issues():
    """Get issues reported by current user"""
    if 'user_id' not in session:
        return jsonify({"error": "User access required"}), 403
    
    username = session.get('username')
    user_issues = db.get_issues_by_user(username)
    
    for issue in user_issues:
        issue["priority_score"] = priority_score(issue)
    
    return jsonify(user_issues), 200

@app.route("/api/user/change-password", methods=["POST"])
@login_required
def change_password():
    """Change user password"""
    if 'user_id' not in session:
        return jsonify({"error": "User access required"}), 403
    
    data = request.get_json()
    
    if not data or "current_password" not in data or "new_password" not in data:
        return jsonify({"error": "Current and new password required"}), 400
    
    username = session.get('username')
    user = db.get_user_by_username(username)
    
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    if user["password"] != hash_password(data["current_password"]):
        return jsonify({"error": "Current password is incorrect"}), 400
    
    if len(data["new_password"]) < 6:
        return jsonify({"error": "New password must be at least 6 characters"}), 400
    
    db.update_user_password(username, data["new_password"])
    
    return jsonify({"message": "Password changed successfully"}), 200


# ============================================================================
# ADMIN ROUTES
# ============================================================================

@app.route("/admin")
def admin_page():
    """Serve admin dashboard page"""
    return render_template("admin.html")

@app.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_stats():
    """Get detailed admin statistics"""
    total_users = db.count_users()
    total_issues = db.count_issues()
    
    reported = db.count_issues_by_status("Reported")
    in_progress = db.count_issues_by_status("In Progress")
    resolved = db.count_issues_by_status("Resolved")
    
    high = db.count_issues_by_severity("High")
    medium = db.count_issues_by_severity("Medium")
    low = db.count_issues_by_severity("Low")
    
    by_type = db.get_issues_by_type_count()
    recent_issues = db.count_recent_issues(24)
    top_reporters = db.get_top_reporters(5)
    
    return jsonify({
        "total_users": total_users,
        "total_issues": total_issues,
        "issues_by_status": {
            "reported": reported,
            "in_progress": in_progress,
            "resolved": resolved
        },
        "issues_by_severity": {
            "high": high,
            "medium": medium,
            "low": low
        },
        "issues_by_type": by_type,
        "recent_issues_24h": recent_issues,
        "resolution_rate": round((resolved / total_issues * 100), 2) if total_issues > 0 else 0,
        "top_reporters": top_reporters
    }), 200

@app.route("/api/admin/users", methods=["GET"])
@admin_required
def get_all_users():
    """Get all registered users"""
    users = db.get_all_users()
    user_list = []
    
    for user in users:
        user_data = {k: v for k, v in user.items() if k != 'password'}
        counts = db.count_user_issues(user["username"])
        user_data["issues_count"] = counts["total"]
        user_list.append(user_data)
    
    return jsonify(user_list), 200

@app.route("/api/admin/users/<username>", methods=["DELETE"])
@admin_required
def delete_user_route(username):
    """Delete a user"""
    if not db.user_exists(username):
        return jsonify({"error": "User not found"}), 404
    
    db.delete_user(username)
    return jsonify({"message": f"User {username} deleted"}), 200

@app.route("/api/admin/issues/<int:issue_id>/assign", methods=["POST"])
@admin_required
def assign_issue_route(issue_id):
    """Assign an issue to a department/team"""
    data = request.get_json()
    
    issue = db.get_issue_by_id(issue_id)
    if not issue:
        return jsonify({"error": "Issue not found"}), 404
    
    updated = db.assign_issue(issue_id, data.get("assigned_to", ""), session.get('username'))
    return jsonify(updated), 200

@app.route("/api/admin/broadcast", methods=["POST"])
@admin_required
def send_broadcast():
    """Send a broadcast notification"""
    data = request.get_json()
    
    if not data or "message" not in data:
        return jsonify({"error": "Message required"}), 400
    
    broadcast = {
        "id": db.count_issues() + 1000,
        "message": data["message"],
        "type": data.get("type", "info"),
        "sent_by": session.get('username'),
        "sent_at": datetime.now().isoformat()
    }
    
    return jsonify({"message": "Broadcast sent", "broadcast": broadcast}), 200


# ============================================================================
# PAGE ROUTES
# ============================================================================

@app.route("/")
def index():
    """Serve the main HTML page."""
    return render_template("index.html")

@app.route("/login")
def login_page():
    """Serve the login/register page"""
    return render_template("login.html")


# ============================================================================
# ISSUE ROUTES
# ============================================================================

@app.route("/api/auto-severity", methods=["POST"])
def auto_detect_severity():
    """POST /api/auto-severity - Automatically detect severity based on issue details."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body is required"}), 400
    
    issue_type = data.get("issue_type", "Other")
    description = data.get("description", "")
    
    if not description:
        return jsonify({"error": "Description is required for severity detection"}), 400
    
    severity, confidence, keywords = detect_severity(issue_type, description)
    
    return jsonify({
        "severity": severity,
        "confidence": confidence,
        "matched_keywords": keywords,
        "issue_type": issue_type,
        "analysis": {
            "description_length": len(description),
            "is_emergency_type": issue_type in HIGH_SEVERITY_TYPES,
            "high_keywords_found": len([k for k in keywords if k in HIGH_SEVERITY_KEYWORDS]),
            "medium_keywords_found": len([k for k in keywords if k in MEDIUM_SEVERITY_KEYWORDS])
        }
    }), 200


@app.route("/api/analyze-image", methods=["POST"])
def analyze_image():
    """POST /api/analyze-image - Analyze uploaded image for severity detection.
    Returns severity analysis without creating an issue.
    """
    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400
    
    file = request.files['image']
    if not file or not file.filename:
        return jsonify({"error": "No image file selected"}), 400
    
    if not allowed_file(file.filename):
        return jsonify({"error": "Invalid file type. Allowed: png, jpg, jpeg, gif, webp"}), 400
    
    # Save temporarily for analysis
    filename, filepath = save_uploaded_image(file)
    if not filename:
        return jsonify({"error": "Failed to save image"}), 500
    
    # Analyze image
    severity, confidence, analysis = calculate_severity_from_image(filepath)
    
    if severity is None:
        # Clean up temp file
        try:
            os.remove(filepath)
        except:
            pass
        return jsonify({"error": analysis.get("error", "Failed to analyze image")}), 500
    
    # Return analysis results (keep the file for potential submission)
    return jsonify({
        "severity": severity,
        "confidence": confidence,
        "analysis": analysis,
        "image_path": f"/static/uploads/{filename}",
        "message": f"Image analyzed: {severity} severity detected with {confidence}% confidence"
    }), 200


@app.route("/api/issues", methods=["GET"])
def get_issues():
    """GET /api/issues - Retrieve all issues with priority scores."""
    try:
        issues = db.get_all_issues()
        
        for issue in issues:
            issue["priority_score"] = priority_score(issue)
        
        return jsonify(issues), 200
    except Exception as e:
        print(f"Error in get_issues: {e}")
        return jsonify([]), 200

@app.route("/api/issues", methods=["POST"])
def create_issue():
    """POST /api/issues - Create a new issue report.
    Supports both JSON and multipart/form-data for image uploads.
    If a garbage image is uploaded, severity is auto-detected using OpenCV.
    """
    image_filename = None
    image_analysis = None
    auto_severity = None
    
    # Check if this is a multipart form (file upload)
    if request.content_type and 'multipart/form-data' in request.content_type:
        # Handle form data with file upload
        data = {
            'issue_type': request.form.get('issue_type'),
            'description': request.form.get('description'),
            'severity': request.form.get('severity'),
            'latitude': request.form.get('latitude'),
            'longitude': request.form.get('longitude'),
            'reporter_name': request.form.get('reporter_name', ''),
            'reporter_contact': request.form.get('reporter_contact', '')
        }
        
        # Handle image upload
        if 'image' in request.files:
            file = request.files['image']
            if file and file.filename:
                filename, filepath = save_uploaded_image(file)
                if filename:
                    image_filename = f"/static/uploads/{filename}"
                    
                    # Auto-detect severity for garbage images using OpenCV
                    if data['issue_type'] == 'Garbage':
                        auto_severity, confidence, analysis = calculate_severity_from_image(filepath)
                        if auto_severity:
                            image_analysis = analysis
                            # Use auto-detected severity if no manual severity provided
                            if not data['severity'] or data['severity'] == '':
                                data['severity'] = auto_severity
    else:
        # Handle JSON data (legacy support)
        data = request.get_json()
        if not data:
            return jsonify({"error": "Request body is required"}), 400
        
        # Handle base64 image if provided (legacy)
        if data.get('image') and data['image'].startswith('data:image'):
            image_filename = data.get('image')
    
    # Validate required fields (severity is now optional for garbage - will be auto-detected)
    required_fields = ["issue_type", "description", "latitude", "longitude"]
    for field in required_fields:
        if field not in data or data[field] is None or data[field] == "":
            return jsonify({"error": f"Missing required field: {field}"}), 400
    
    # If severity is still missing, use keyword-based detection
    if not data.get('severity') or data['severity'] == '':
        auto_sev, _, _ = detect_severity(data['issue_type'], data['description'])
        data['severity'] = auto_sev
    
    if data["issue_type"] not in VALID_ISSUE_TYPES:
        return jsonify({"error": f"Invalid issue_type. Must be one of: {VALID_ISSUE_TYPES}"}), 400
    
    if data["severity"] not in VALID_SEVERITIES:
        return jsonify({"error": f"Invalid severity. Must be one of: {VALID_SEVERITIES}"}), 400
    
    try:
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
    except (ValueError, TypeError):
        return jsonify({"error": "Latitude and longitude must be valid numbers"}), 400
    
    new_issue = db.create_issue(
        issue_type=data["issue_type"],
        description=str(data["description"]),
        latitude=latitude,
        longitude=longitude,
        severity=data["severity"],
        image=image_filename,
        reported_by=session.get("username", "anonymous"),
        reporter_name=data.get("reporter_name", ""),
        reporter_contact=data.get("reporter_contact", "")
    )
    
    new_issue["priority_score"] = priority_score(new_issue)
    
    # Include image analysis in response if available
    if image_analysis:
        new_issue["image_analysis"] = image_analysis
        new_issue["auto_detected_severity"] = True
    return jsonify(new_issue), 201

@app.route("/api/issues/<int:issue_id>", methods=["PATCH"])
def update_issue_status_route(issue_id):
    """PATCH /api/issues/<id> - Update the status of an issue."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body is required"}), 400
    
    if "status" not in data:
        return jsonify({"error": "Missing required field: status"}), 400
    
    if data["status"] not in VALID_STATUSES:
        return jsonify({"error": f"Invalid status. Must be one of: {VALID_STATUSES}"}), 400
    
    issue = db.get_issue_by_id(issue_id)
    if not issue:
        return jsonify({"error": f"Issue with ID {issue_id} not found"}), 404
    
    old_status = issue["status"]
    new_status = data["status"]
    
    updated_issue = db.update_issue_status(issue_id, new_status)
    
    # Send SMS notification if status changed to Resolved
    if old_status != "Resolved" and new_status == "Resolved":
        notify_issue_resolved(updated_issue)
    
    return jsonify(updated_issue), 200

@app.route("/api/issues/<int:issue_id>", methods=["DELETE"])
def delete_issue_route(issue_id):
    """DELETE /api/issues/<id> - Delete an issue by ID."""
    issue = db.get_issue_by_id(issue_id)
    if not issue:
        return jsonify({"error": f"Issue with ID {issue_id} not found"}), 404
    
    db.delete_issue(issue_id)
    return jsonify({"message": f"Issue {issue_id} deleted successfully"}), 200

@app.route("/api/issues/<int:issue_id>/upvote", methods=["POST"])
def upvote_issue_route(issue_id):
    """POST /api/issues/<id>/upvote - Upvote an issue."""
    issue = db.get_issue_by_id(issue_id)
    if not issue:
        return jsonify({"error": f"Issue with ID {issue_id} not found"}), 404
    
    upvotes = db.upvote_issue(issue_id)
    return jsonify({"upvotes": upvotes}), 200


# ============================================================================
# STATS & EXPORT
# ============================================================================

@app.route("/api/stats", methods=["GET"])
def get_stats():
    """GET /api/stats - Retrieve statistics about all issues."""
    try:
        total_issues = db.count_issues()
        reported_count = db.count_issues_by_status("Reported")
        in_progress_count = db.count_issues_by_status("In Progress")
        resolved_count = db.count_issues_by_status("Resolved")
        
        if total_issues > 0:
            resolution_percentage = round((resolved_count / total_issues) * 100, 2)
        else:
            resolution_percentage = 0.0
        
        by_type = db.get_issues_by_type_count()
        
        by_severity = {
            "High": db.count_issues_by_severity("High"),
            "Medium": db.count_issues_by_severity("Medium"),
            "Low": db.count_issues_by_severity("Low")
        }
        
        return jsonify({
            "total_issues": total_issues,
            "reported_count": reported_count,
            "in_progress_count": in_progress_count,
            "resolved_count": resolved_count,
            "resolution_percentage": resolution_percentage,
            "by_type": by_type,
            "by_severity": by_severity
        }), 200
    except Exception as e:
        print(f"Error in get_stats: {e}")
        return jsonify({
            "total_issues": 0,
            "reported_count": 0,
            "in_progress_count": 0,
            "resolved_count": 0,
            "resolution_percentage": 0,
            "by_type": {},
            "by_severity": {"High": 0, "Medium": 0, "Low": 0}
        }), 200

@app.route("/api/issues/export", methods=["GET"])
def export_issues():
    """GET /api/issues/export - Export all issues as CSV."""
    issues = db.get_all_issues()
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    writer.writerow(["ID", "Type", "Description", "Latitude", "Longitude", 
                     "Severity", "Status", "Priority Score", "Upvotes", "Created At"])
    
    for issue in issues:
        writer.writerow([
            issue["id"],
            issue["issue_type"],
            issue["description"],
            issue["latitude"],
            issue["longitude"],
            issue["severity"],
            issue["status"],
            priority_score(issue),
            issue.get("upvotes", 0),
            issue["created_at"]
        ])
    
    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=civicpulse_issues.csv"}
    )


# ============================================================================
# ADMIN ACCOUNTABILITY & BLOCKING SYSTEM
# ============================================================================

@app.route("/api/admin/overdue-issues", methods=["GET"])
@require_auth(admin_only=True)
def get_overdue_issues():
    """Get issues that have been assigned but not resolved within deadline"""
    days = request.args.get('days', 3, type=int)
    overdue = db.get_overdue_issues(days)
    return jsonify({
        "overdue_issues": overdue,
        "count": len(overdue),
        "deadline_days": days
    }), 200

@app.route("/api/admin/list", methods=["GET"])
@require_auth(admin_only=True)
def get_all_admins():
    """Get all admin accounts with their status"""
    admins = db.get_all_admins()
    # Remove passwords from response
    safe_admins = [{k: v for k, v in admin.items() if k != 'password'} for admin in admins]
    return jsonify({"admins": safe_admins}), 200

@app.route("/api/admin/with-overdue", methods=["GET"])
@require_auth(admin_only=True)
def get_admins_with_overdue():
    """Get admins who have overdue issues"""
    days = request.args.get('days', 3, type=int)
    admins = db.get_admins_with_overdue_issues(days)
    safe_admins = [{k: v for k, v in admin.items() if k != 'password'} for admin in admins]
    return jsonify({
        "admins_with_overdue": safe_admins,
        "deadline_days": days
    }), 200

@app.route("/api/admin/<int:admin_id>/block", methods=["POST"])
@require_auth(admin_only=True)
def block_admin(admin_id):
    """Block an admin account"""
    data = request.get_json() or {}
    reason = data.get('reason', 'Blocked by administrator')
    
    # Prevent self-blocking
    if session.get('admin_id') == admin_id:
        return jsonify({"error": "Cannot block your own account"}), 400
    
    db.block_admin(admin_id, reason)
    return jsonify({"message": "Admin blocked successfully", "admin_id": admin_id}), 200

@app.route("/api/admin/<int:admin_id>/unblock", methods=["POST"])
@require_auth(admin_only=True)
def unblock_admin(admin_id):
    """Unblock an admin account"""
    db.unblock_admin(admin_id)
    return jsonify({"message": "Admin unblocked successfully", "admin_id": admin_id}), 200

@app.route("/api/admin/auto-block-check", methods=["POST"])
@require_auth(admin_only=True)
def auto_block_check():
    """Check and auto-block admins with overdue issues"""
    days = request.get_json().get('days', 3) if request.get_json() else 3
    blocked_count = db.auto_block_admins_with_overdue(days)
    return jsonify({
        "message": f"Auto-block check completed. {blocked_count} admin(s) blocked.",
        "blocked_count": blocked_count
    }), 200

@app.route("/api/admin/accountability-stats", methods=["GET"])
@require_auth(admin_only=True)
def get_accountability_stats():
    """Get admin accountability statistics"""
    days = request.args.get('days', 3, type=int)
    
    overdue_issues = db.get_overdue_issues(days)
    admins_with_overdue = db.get_admins_with_overdue_issues(days)
    all_admins = db.get_all_admins()
    
    blocked_count = sum(1 for a in all_admins if a.get('is_blocked'))
    
    return jsonify({
        "total_admins": len(all_admins),
        "blocked_admins": blocked_count,
        "active_admins": len(all_admins) - blocked_count,
        "admins_with_overdue": len(admins_with_overdue),
        "overdue_issues_count": len(overdue_issues),
        "deadline_days": days
    }), 200


# ============================================================================
# DATABASE INITIALIZATION (runs on import for gunicorn)
# ============================================================================

# Initialize database when app is imported (works with gunicorn)
try:
    print(f"Initializing database at: {db.DATABASE_PATH}")
    db.init_db()
    db.add_seed_data()
    print("CivicPulse database initialized successfully!")
except Exception as e:
    print(f"Database initialization error: {e}")


# ============================================================================
# APPLICATION ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    print("CivicPulse API started with SQLite database!")
    print(f"Database: {db.DATABASE_PATH}")
    print(f"Loaded {db.count_issues()} issues")
    
    # Run the Flask development server
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port)
