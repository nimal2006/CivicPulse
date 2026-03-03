"""
CivicPulse – Smart Public Issue & Emergency Intelligence System
Flask Backend API

This module provides a REST API for managing public issues and emergencies.
Features:
- CRUD operations for issues
- Priority scoring based on severity and age
- Statistics endpoint for dashboard
"""

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from datetime import datetime, timedelta

app = Flask(__name__)

# Enable CORS for all routes to allow cross-origin requests from frontend
CORS(app)

# ============================================================================
# IN-MEMORY DATA STORAGE
# ============================================================================

# List to store all issues (acts as our database for this prototype)
issues = []

# Auto-increment counter for issue IDs
next_id = 1

# Valid values for issue fields (used for validation)
VALID_ISSUE_TYPES = ["Garbage", "Water Leak", "Road Damage", "Fire", "Accident", "Streetlight", "Noise Complaint", "Other"]
VALID_SEVERITIES = ["Low", "Medium", "High"]
VALID_STATUSES = ["Reported", "In Progress", "Resolved"]


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
        "image": data.get("image", None)  # Optional image data (base64)
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
    
    # Update only the status field
    issue["status"] = data["status"]
    
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

