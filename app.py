"""
CivicPulse – Smart Public Issue & Emergency Intelligence System
Flask Backend API

This module provides a REST API for managing public issues and emergencies.
Features:
- CRUD operations for issues
- Priority scoring based on severity and age
- Statistics endpoint for dashboard
- User and Admin authentication
- Role-based access control
"""

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_cors import CORS
from datetime import datetime, timedelta
from functools import wraps
import hashlib
import secrets
import os

# Twilio WhatsApp API
from twilio.rest import Client

app = Flask(__name__)

# ============================================================================
# TWILIO WHATSAPP CONFIGURATION
# ============================================================================
# Set these environment variables or replace with your credentials
TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID', 'your_account_sid')
TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN', 'your_auth_token')
TWILIO_WHATSAPP_NUMBER = os.environ.get('TWILIO_WHATSAPP_NUMBER', 'whatsapp:+14155238886')  # Twilio sandbox number

# Initialize Twilio client (will be None if credentials not set)
try:
    twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) if TWILIO_ACCOUNT_SID != 'your_account_sid' else None
except Exception:
    twilio_client = None
app.secret_key = secrets.token_hex(32)  # Secret key for sessions

# Enable CORS for all routes to allow cross-origin requests from frontend
CORS(app, supports_credentials=True)

# ============================================================================
# IN-MEMORY DATA STORAGE
# ============================================================================

# List to store all issues (acts as our database for this prototype)
issues = []

# Auto-increment counter for issue IDs
next_id = 1

# User storage
users = {}
next_user_id = 1

# Admin storage (pre-seeded)
admins = {
    "admin": {
        "id": 1,
        "username": "admin",
        "password": hashlib.sha256("admin123".encode()).hexdigest(),
        "name": "System Administrator",
        "email": "admin@civicpulse.gov",
        "created_at": datetime.now().isoformat()
    }
}

# Valid values for issue fields (used for validation)
VALID_ISSUE_TYPES = ["Garbage", "Water Leak", "Road Damage", "Fire", "Accident", "Streetlight", "Noise Complaint", "Other"]
VALID_SEVERITIES = ["Low", "Medium", "High"]
VALID_STATUSES = ["Reported", "In Progress", "Resolved"]


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

def get_current_user():
    """Get current logged-in user info"""
    if 'user_id' in session:
        username = session.get('username')
        return {"type": "user", "user": users.get(username)}
    elif 'admin_id' in session:
        username = session.get('username')
        return {"type": "admin", "user": admins.get(username)}
    return None


# ============================================================================
# WHATSAPP NOTIFICATION FUNCTION
# ============================================================================

def send_whatsapp_notification(phone_number, message):
    """
    Send a WhatsApp notification to the user.
    
    Args:
        phone_number (str): User's phone number (with country code, e.g., +919876543210)
        message (str): The message to send
    
    Returns:
        bool: True if sent successfully, False otherwise
    """
    if not twilio_client:
        print(f"[WhatsApp] Twilio not configured. Would send to {phone_number}: {message}")
        return False
    
    try:
        # Format the phone number for WhatsApp
        whatsapp_number = f"whatsapp:{phone_number}" if not phone_number.startswith('whatsapp:') else phone_number
        
        # Send the message
        twilio_client.messages.create(
            body=message,
            from_=TWILIO_WHATSAPP_NUMBER,
            to=whatsapp_number
        )
        print(f"[WhatsApp] Notification sent to {phone_number}")
        return True
    except Exception as e:
        print(f"[WhatsApp] Failed to send notification: {e}")
        return False


def notify_issue_resolved(issue):
    """
    Send WhatsApp notification when an issue is resolved.
    
    Args:
        issue (dict): The issue that was resolved
    """
    # Get the user who reported the issue
    username = issue.get("reported_by", "anonymous")
    if username == "anonymous" or username not in users:
        print(f"[WhatsApp] Cannot notify - user not found: {username}")
        return
    
    user = users[username]
    phone = user.get("phone")
    
    if not phone:
        print(f"[WhatsApp] Cannot notify - no phone number for user: {username}")
        return
    
    # Create the notification message
    message = f"""🎉 *CivicPulse - Issue Resolved!*

Hello {user.get('name', 'Citizen')}!

Great news! Your reported issue has been resolved.

📋 *Issue Details:*
• Type: {issue.get('issue_type')}
• Description: {issue.get('description', '')[:100]}...
• Status: ✅ Resolved

Thank you for helping make our city better!

- CivicPulse Team"""
    
    send_whatsapp_notification(phone, message)


# ============================================================================
# AUTHENTICATION ROUTES
# ============================================================================

@app.route("/api/auth/register", methods=["POST"])
def register():
    """Register a new user"""
    global next_user_id
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    required = ["username", "password", "name", "email", "phone"]
    for field in required:
        if field not in data or not data[field]:
            return jsonify({"error": f"Missing field: {field}"}), 400
    
    username = data["username"].lower().strip()
    
    if username in users:
        return jsonify({"error": "Username already exists"}), 400
    
    if len(data["password"]) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    
    new_user = {
        "id": next_user_id,
        "username": username,
        "password": hash_password(data["password"]),
        "name": data["name"],
        "email": data["email"],
        "phone": data["phone"],
        "address": data.get("address", ""),
        "created_at": datetime.now().isoformat(),
        "issues_reported": 0,
        "issues_resolved": 0
    }
    
    users[username] = new_user
    next_user_id += 1
    
    # Auto-login after registration
    session['user_id'] = new_user['id']
    session['username'] = username
    session['role'] = 'user'
    
    return jsonify({
        "message": "Registration successful",
        "user": {k: v for k, v in new_user.items() if k != 'password'}
    }), 201

@app.route("/api/auth/login", methods=["POST"])
def login():
    """User login"""
    data = request.get_json()
    
    if not data or "username" not in data or "password" not in data:
        return jsonify({"error": "Username and password required"}), 400
    
    username = data["username"].lower().strip()
    password_hash = hash_password(data["password"])
    
    if username in users and users[username]["password"] == password_hash:
        user = users[username]
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
    
    if username in admins and admins[username]["password"] == password_hash:
        admin = admins[username]
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
    
    # Count user's issues
    if current["type"] == "user":
        username = session.get('username')
        user_issues = [i for i in issues if i.get("reported_by") == username]
        user_data["issues_reported"] = len(user_issues)
        user_data["issues_resolved"] = len([i for i in user_issues if i["status"] == "Resolved"])
    
    return jsonify(user_data), 200

@app.route("/api/user/profile", methods=["PUT"])
@login_required
def update_profile():
    """Update user profile"""
    if 'user_id' not in session:
        return jsonify({"error": "User access required"}), 403
    
    data = request.get_json()
    username = session.get('username')
    
    if username not in users:
        return jsonify({"error": "User not found"}), 404
    
    user = users[username]
    
    # Update allowed fields
    if "name" in data:
        user["name"] = data["name"]
    if "email" in data:
        user["email"] = data["email"]
    if "phone" in data:
        user["phone"] = data["phone"]
    if "address" in data:
        user["address"] = data["address"]
    
    return jsonify({
        "message": "Profile updated",
        "user": {k: v for k, v in user.items() if k != 'password'}
    }), 200

@app.route("/api/user/issues", methods=["GET"])
@login_required
def get_user_issues():
    """Get issues reported by current user"""
    if 'user_id' not in session:
        return jsonify({"error": "User access required"}), 403
    
    username = session.get('username')
    user_issues = [i for i in issues if i.get("reported_by") == username]
    
    # Add priority scores
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
    user = users.get(username)
    
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    if user["password"] != hash_password(data["current_password"]):
        return jsonify({"error": "Current password is incorrect"}), 400
    
    if len(data["new_password"]) < 6:
        return jsonify({"error": "New password must be at least 6 characters"}), 400
    
    user["password"] = hash_password(data["new_password"])
    
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
    total_users = len(users)
    total_issues = len(issues)
    
    # Issues by status
    reported = len([i for i in issues if i["status"] == "Reported"])
    in_progress = len([i for i in issues if i["status"] == "In Progress"])
    resolved = len([i for i in issues if i["status"] == "Resolved"])
    
    # Issues by severity
    high = len([i for i in issues if i["severity"] == "High"])
    medium = len([i for i in issues if i["severity"] == "Medium"])
    low = len([i for i in issues if i["severity"] == "Low"])
    
    # Issues by type
    by_type = {}
    for issue in issues:
        t = issue["issue_type"]
        by_type[t] = by_type.get(t, 0) + 1
    
    # Recent issues (last 24 hours)
    recent_cutoff = datetime.now() - timedelta(hours=24)
    recent_issues = len([i for i in issues if datetime.fromisoformat(i["created_at"]) > recent_cutoff])
    
    # Top reporters
    reporters = {}
    for issue in issues:
        r = issue.get("reported_by", "anonymous")
        reporters[r] = reporters.get(r, 0) + 1
    top_reporters = sorted(reporters.items(), key=lambda x: x[1], reverse=True)[:5]
    
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
        "top_reporters": [{"username": r[0], "count": r[1]} for r in top_reporters]
    }), 200

@app.route("/api/admin/users", methods=["GET"])
@admin_required
def get_all_users():
    """Get all registered users"""
    user_list = []
    for username, user in users.items():
        user_data = {k: v for k, v in user.items() if k != 'password'}
        # Count user's issues
        user_issues = [i for i in issues if i.get("reported_by") == username]
        user_data["issues_count"] = len(user_issues)
        user_list.append(user_data)
    
    return jsonify(user_list), 200

@app.route("/api/admin/users/<username>", methods=["DELETE"])
@admin_required
def delete_user(username):
    """Delete a user"""
    if username not in users:
        return jsonify({"error": "User not found"}), 404
    
    del users[username]
    return jsonify({"message": f"User {username} deleted"}), 200

@app.route("/api/admin/issues/<int:issue_id>/assign", methods=["POST"])
@admin_required
def assign_issue(issue_id):
    """Assign an issue to a department/team"""
    data = request.get_json()
    
    issue = next((i for i in issues if i["id"] == issue_id), None)
    if not issue:
        return jsonify({"error": "Issue not found"}), 404
    
    issue["assigned_to"] = data.get("assigned_to", "")
    issue["assigned_at"] = datetime.now().isoformat()
    issue["assigned_by"] = session.get('username')
    
    return jsonify(issue), 200

@app.route("/api/admin/broadcast", methods=["POST"])
@admin_required
def send_broadcast():
    """Send a broadcast notification (stored for demo)"""
    data = request.get_json()
    
    if not data or "message" not in data:
        return jsonify({"error": "Message required"}), 400
    
    # In a real app, this would send to all users via websockets/push
    broadcast = {
        "id": len(issues) + 1000,
        "message": data["message"],
        "type": data.get("type", "info"),
        "sent_by": session.get('username'),
        "sent_at": datetime.now().isoformat()
    }
    
    return jsonify({"message": "Broadcast sent", "broadcast": broadcast}), 200


# ============================================================================
# PRIORITY SCORE CALCULATION
# ============================================================================

def priority_score(issue):
    """
    Calculate priority score for an issue based on severity and age.
    
    Scoring rules:
    - High severity: 50 points
    - Medium severity: 30 points
    - Low severity: 10 points
    - Additional +10 points if issue is older than 1 hour
    
    Args:
        issue (dict): The issue dictionary containing 'severity' and 'created_at'
    
    Returns:
        int: Priority score capped at maximum of 100
    """
    score = 0
    
    # Add points based on severity level
    severity = issue.get("severity", "Low")
    if severity == "High":
        score += 50
    elif severity == "Medium":
        score += 30
    else:  # Low or unknown
        score += 10
    
    # Add bonus points if issue is older than 1 hour
    created_at = datetime.fromisoformat(issue["created_at"])
    age = datetime.now() - created_at
    if age > timedelta(hours=1):
        score += 10
    
    # Cap the score at 100
    return min(100, score)


# ============================================================================
# ROUTES
# ============================================================================

@app.route("/")
def index():
    """
    Serve the main HTML page.
    Returns the index.html template for the frontend application.
    """
    return render_template("index.html")


@app.route("/login")
def login_page():
    """Serve the login/register page"""
    return render_template("login.html")


@app.route("/api/issues", methods=["GET"])
def get_issues():
    """
    GET /api/issues - Retrieve all issues with priority scores.
    
    Returns:
        JSON array of all issues, each with an added 'priority_score' field.
        Issues are returned in order of creation (newest first for display).
    
    Response: 200 OK
    """
    # Create a copy of issues with priority_score added to each
    issues_with_scores = []
    for issue in issues:
        # Create a copy of the issue dict to avoid modifying the original
        issue_copy = issue.copy()
        # Add the calculated priority score
        issue_copy["priority_score"] = priority_score(issue)
        issues_with_scores.append(issue_copy)
    
    # Return all issues with their priority scores
    return jsonify(issues_with_scores), 200


@app.route("/api/issues", methods=["POST"])
def create_issue():
    """
    POST /api/issues - Create a new issue report.
    
    Expected JSON body:
        {
            "issue_type": string (one of VALID_ISSUE_TYPES),
            "description": string,
            "latitude": float,
            "longitude": float,
            "severity": string (one of VALID_SEVERITIES)
        }
    
    Returns:
        201 Created: Returns the newly created issue with its ID
        400 Bad Request: If required fields are missing or invalid
    """
    global next_id
    
    # Parse JSON data from request body
    data = request.get_json()
    
    # Validate that request body exists
    if not data:
        return jsonify({"error": "Request body is required"}), 400
    
    # Validate required fields are present
    required_fields = ["issue_type", "description", "latitude", "longitude", "severity"]
    for field in required_fields:
        if field not in data or data[field] is None or data[field] == "":
            return jsonify({"error": f"Missing required field: {field}"}), 400
    
    # Validate issue_type is one of the allowed values
    if data["issue_type"] not in VALID_ISSUE_TYPES:
        return jsonify({
            "error": f"Invalid issue_type. Must be one of: {VALID_ISSUE_TYPES}"
        }), 400
    
    # Validate severity is one of the allowed values
    if data["severity"] not in VALID_SEVERITIES:
        return jsonify({
            "error": f"Invalid severity. Must be one of: {VALID_SEVERITIES}"
        }), 400
    
    # Validate latitude and longitude are valid numbers
    try:
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
    except (ValueError, TypeError):
        return jsonify({"error": "Latitude and longitude must be valid numbers"}), 400
    
    # Create the new issue with auto-incremented ID
    new_issue = {
        "id": next_id,
        "issue_type": data["issue_type"],
        "description": str(data["description"]),
        "latitude": latitude,
        "longitude": longitude,
        "severity": data["severity"],
        "status": "Reported",  # New issues always start as "Reported"
        "created_at": datetime.now().isoformat(),
        "image": data.get("image", None),  # Optional image data (base64)
        "reported_by": session.get("username", "anonymous"),
        "reporter_name": data.get("reporter_name", ""),
        "reporter_contact": data.get("reporter_contact", "")
    }
    
    # Increment the ID counter for next issue
    next_id += 1
    
    # Add to our in-memory storage
    issues.append(new_issue)
    
    # Return the created issue with 201 status
    return jsonify(new_issue), 201


@app.route("/api/issues/<int:issue_id>", methods=["PATCH"])
def update_issue_status(issue_id):
    """
    PATCH /api/issues/<id> - Update only the status field of an issue.
    
    Args:
        issue_id (int): The ID of the issue to update (from URL)
    
    Expected JSON body:
        {
            "status": string (one of VALID_STATUSES)
        }
    
    Returns:
        200 OK: Returns the updated issue
        400 Bad Request: If status is missing or invalid
        404 Not Found: If issue with given ID doesn't exist
    """
    # Parse JSON data from request body
    data = request.get_json()
    
    # Validate that request body exists
    if not data:
        return jsonify({"error": "Request body is required"}), 400
    
    # Validate status field is present
    if "status" not in data:
        return jsonify({"error": "Missing required field: status"}), 400
    
    # Validate status is one of the allowed values
    if data["status"] not in VALID_STATUSES:
        return jsonify({
            "error": f"Invalid status. Must be one of: {VALID_STATUSES}"
        }), 400
    
    # Find the issue by ID
    issue = next((i for i in issues if i["id"] == issue_id), None)
    
    # Return 404 if issue not found
    if not issue:
        return jsonify({"error": f"Issue with ID {issue_id} not found"}), 404
    
    # Store old status for comparison
    old_status = issue["status"]
    new_status = data["status"]
    
    # Update only the status field
    issue["status"] = new_status
    
    # Send WhatsApp notification if status changed to Resolved
    if old_status != "Resolved" and new_status == "Resolved":
        notify_issue_resolved(issue)
    
    # Return the updated issue
    return jsonify(issue), 200


@app.route("/api/stats", methods=["GET"])
def get_stats():
    """
    GET /api/stats - Retrieve statistics about all issues.
    
    Returns:
        JSON object with:
        - total_issues: Total number of issues
        - reported_count: Number of issues with status "Reported"
        - in_progress_count: Number of issues with status "In Progress"
        - resolved_count: Number of issues with status "Resolved"
        - resolution_percentage: Percentage of resolved issues (rounded to 2 decimals)
        - by_type: Breakdown of issues by type
        - by_severity: Breakdown of issues by severity
    
    Response: 200 OK
    """
    # Calculate total number of issues
    total_issues = len(issues)
    
    # Count issues by status
    reported_count = len([i for i in issues if i["status"] == "Reported"])
    in_progress_count = len([i for i in issues if i["status"] == "In Progress"])
    resolved_count = len([i for i in issues if i["status"] == "Resolved"])
    
    # Calculate resolution percentage (avoid division by zero)
    if total_issues > 0:
        resolution_percentage = round((resolved_count / total_issues) * 100, 2)
    else:
        resolution_percentage = 0.0
    
    # Count issues by type
    by_type = {}
    for issue in issues:
        issue_type = issue["issue_type"]
        by_type[issue_type] = by_type.get(issue_type, 0) + 1
    
    # Count issues by severity
    by_severity = {"High": 0, "Medium": 0, "Low": 0}
    for issue in issues:
        severity = issue["severity"]
        by_severity[severity] = by_severity.get(severity, 0) + 1
    
    # Return statistics object
    return jsonify({
        "total_issues": total_issues,
        "reported_count": reported_count,
        "in_progress_count": in_progress_count,
        "resolved_count": resolved_count,
        "resolution_percentage": resolution_percentage,
        "by_type": by_type,
        "by_severity": by_severity
    }), 200


@app.route("/api/issues/<int:issue_id>", methods=["DELETE"])
def delete_issue(issue_id):
    """
    DELETE /api/issues/<id> - Delete an issue by ID.
    
    Args:
        issue_id (int): The ID of the issue to delete (from URL)
    
    Returns:
        200 OK: Returns success message
        404 Not Found: If issue with given ID doesn't exist
    """
    global issues
    
    # Find the issue by ID
    issue = next((i for i in issues if i["id"] == issue_id), None)
    
    # Return 404 if issue not found
    if not issue:
        return jsonify({"error": f"Issue with ID {issue_id} not found"}), 404
    
    # Remove the issue from list
    issues = [i for i in issues if i["id"] != issue_id]
    
    # Return success message
    return jsonify({"message": f"Issue {issue_id} deleted successfully"}), 200


@app.route("/api/issues/<int:issue_id>/upvote", methods=["POST"])
def upvote_issue(issue_id):
    """
    POST /api/issues/<id>/upvote - Increment the upvote count of an issue.
    
    Args:
        issue_id (int): The ID of the issue to upvote (from URL)
    
    Returns:
        200 OK: Returns the updated upvote count
        404 Not Found: If issue with given ID doesn't exist
    """
    # Find the issue by ID
    issue = next((i for i in issues if i["id"] == issue_id), None)
    
    # Return 404 if issue not found
    if not issue:
        return jsonify({"error": f"Issue with ID {issue_id} not found"}), 404
    
    # Initialize upvotes if not present
    if "upvotes" not in issue:
        issue["upvotes"] = 0
    
    # Increment upvote count
    issue["upvotes"] += 1
    
    # Return updated upvote count
    return jsonify({"upvotes": issue["upvotes"]}), 200


@app.route("/api/issues/export", methods=["GET"])
def export_issues():
    """
    GET /api/issues/export - Export all issues as CSV format.
    
    Returns:
        CSV text data with all issues
    """
    from flask import Response
    import csv
    import io
    
    # Create CSV output
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write header row
    writer.writerow(["ID", "Type", "Description", "Latitude", "Longitude", 
                     "Severity", "Status", "Priority Score", "Upvotes", "Created At"])
    
    # Write data rows
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
    
    # Return CSV response
    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=civicpulse_issues.csv"}
    )


# ============================================================================
# SEED DATA
# ============================================================================

def add_seed_data():
    """
    Add example seed issues on startup for demonstration purposes.
    Creates sample issues with different types, severities, and locations around Coimbatore.
    """
    global next_id
    
    # Sample issues to populate the system (Coimbatore, India coordinates)
    seed_issues = [
        {
            "issue_type": "Road Damage",
            "description": "Large pothole on Avinashi Road near Tidel Park. Approximately 2 feet wide and causing traffic hazards for two-wheelers.",
            "latitude": 11.0205,
            "longitude": 76.9629,
            "severity": "High",
            "status": "Reported",
            "upvotes": 15,
            "created_at": (datetime.now() - timedelta(hours=2)).isoformat()
        },
        {
            "issue_type": "Garbage",
            "description": "Overflowing garbage bins near RS Puram bus stand. Foul smell and health hazard for pedestrians.",
            "latitude": 11.0073,
            "longitude": 76.9535,
            "severity": "Medium",
            "status": "In Progress",
            "upvotes": 8,
            "created_at": (datetime.now() - timedelta(minutes=30)).isoformat()
        },
        {
            "issue_type": "Water Leak",
            "description": "Underground pipe leak on Gandhipuram main road. Water pooling on sidewalk causing slippery conditions.",
            "latitude": 11.0183,
            "longitude": 76.9725,
            "severity": "Low",
            "status": "Reported",
            "upvotes": 3,
            "created_at": datetime.now().isoformat()
        },
        {
            "issue_type": "Streetlight",
            "description": "Multiple streetlights not working on Race Course Road for past 3 days. Safety concern at night.",
            "latitude": 11.0122,
            "longitude": 76.9631,
            "severity": "Medium",
            "status": "Reported",
            "upvotes": 12,
            "created_at": (datetime.now() - timedelta(hours=5)).isoformat()
        },
        {
            "issue_type": "Fire",
            "description": "Small fire spotted near scrap yard in Ukkadam area. Smoke visible from nearby residential areas.",
            "latitude": 10.9954,
            "longitude": 76.9573,
            "severity": "High",
            "status": "In Progress",
            "upvotes": 25,
            "created_at": (datetime.now() - timedelta(minutes=45)).isoformat()
        },
        {
            "issue_type": "Accident",
            "description": "Traffic accident at Singanallur junction. Two vehicles involved, minor injuries reported.",
            "latitude": 11.0052,
            "longitude": 77.0087,
            "severity": "High",
            "status": "Resolved",
            "upvotes": 6,
            "created_at": (datetime.now() - timedelta(hours=8)).isoformat()
        },
        {
            "issue_type": "Noise Complaint",
            "description": "Loud construction noise from building site near Brookefields Mall starting at 6 AM daily.",
            "latitude": 11.0242,
            "longitude": 76.9886,
            "severity": "Low",
            "status": "Reported",
            "upvotes": 4,
            "created_at": (datetime.now() - timedelta(hours=12)).isoformat()
        }
    ]
    
    # Add each seed issue with proper ID
    for issue_data in seed_issues:
        issue = {
            "id": next_id,
            "issue_type": issue_data["issue_type"],
            "description": issue_data["description"],
            "latitude": issue_data["latitude"],
            "longitude": issue_data["longitude"],
            "severity": issue_data["severity"],
            "status": issue_data["status"],
            "upvotes": issue_data.get("upvotes", 0),
            "created_at": issue_data["created_at"]
        }
        issues.append(issue)
        next_id += 1


# ============================================================================
# APPLICATION ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    # Add seed data before starting the server
    add_seed_data()
    print("CivicPulse API started with seed data!")
    print(f"Loaded {len(issues)} sample issues")
    
    # Run the Flask development server
    app.run(debug=True, port=5000)

