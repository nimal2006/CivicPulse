/**
 * CivicPulse – Smart Public Issue & Emergency Intelligence System
 * Frontend JavaScript
 */

/* ============================================
   Global State
   ============================================ */
let map;
let markers = [];
let clusterCircles = [];
let issues = [];
let filteredIssues = [];
let currentStats = null;
let selectedIssue = null;

// Filter state
let filters = {
  search: "",
  type: "",
  severity: "",
  status: "",
};

// Severity colors for markers
const SEVERITY_COLORS = {
  High: "#e53e3e", // Red
  Medium: "#dd6b20", // Orange
  Low: "#38a169", // Green
};

// Issue type icons
const TYPE_ICONS = {
  Garbage: "🗑️",
  "Water Leak": "💧",
  "Road Damage": "🚧",
  Fire: "🔥",
  Accident: "🚨",
  Streetlight: "💡",
  "Noise Complaint": "📢",
  Other: "📋",
};

// Valid statuses for dropdown
const VALID_STATUSES = ["Reported", "In Progress", "Resolved"];

/* ============================================
   Map init
   ============================================ */

/**
 * Initialize Leaflet map centered on Coimbatore
 * Zoom level 13 for city-level view
 */
function initMap() {
  // Default center: Coimbatore, India
  const defaultCenter = [11.0168, 76.9558];
  const defaultZoom = 13;

  // Create map instance
  map = L.map("map").setView(defaultCenter, defaultZoom);

  // Add OpenStreetMap tiles
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  // Handle map clicks for location selection in report form
  map.on("click", handleMapClick);

  console.log("Map initialized at Coimbatore [11.0168, 76.9558]");
}

/**
 * Handle map click - auto-fill lat/lng in report form
 */
function handleMapClick(e) {
  const latInput = document.getElementById("latitude");
  const lngInput = document.getElementById("longitude");

  if (latInput && lngInput) {
    latInput.value = e.latlng.lat.toFixed(6);
    lngInput.value = e.latlng.lng.toFixed(6);
    showToast("Location selected from map!", "success");
  }
}

/* ============================================
   API fetches
   ============================================ */

/**
 * Fetch all issues from backend API
 * Each issue includes priority_score calculated by backend
 */
async function fetchIssues() {
  try {
    const response = await fetch("/api/issues");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    issues = await response.json();
    console.log(`Fetched ${issues.length} issues`);
    return issues;
  } catch (error) {
    console.error("Error fetching issues:", error);
    showToast("Failed to load issues", "error");
    return [];
  }
}

/**
 * Fetch statistics from backend API
 * Returns: total_issues, reported_count, resolved_count, resolution_percentage
 */
async function fetchStats() {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const stats = await response.json();
    console.log("Stats fetched:", stats);
    return stats;
  } catch (error) {
    console.error("Error fetching stats:", error);
    showToast("Failed to load statistics", "error");
    return null;
  }
}

/**
 * Refresh all data - issues, markers, table, and stats
 */
async function refreshAllData() {
  await fetchIssues();
  applyFilters();
  renderMarkers();
  renderClusters();
  renderIssueTable();

  const stats = await fetchStats();
  if (stats) {
    currentStats = stats;
    updateStatsDisplay(stats);
    renderAnalytics(stats);
  }
}

/**
 * Apply current filters to issues
 */
function applyFilters() {
  filteredIssues = issues.filter((issue) => {
    // Search filter (matches type or description)
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesType = issue.issue_type.toLowerCase().includes(searchLower);
      const matchesDesc = issue.description.toLowerCase().includes(searchLower);
      if (!matchesType && !matchesDesc) return false;
    }

    // Type filter
    if (filters.type && issue.issue_type !== filters.type) return false;

    // Severity filter
    if (filters.severity && issue.severity !== filters.severity) return false;

    // Status filter
    if (filters.status && issue.status !== filters.status) return false;

    return true;
  });

  console.log(`Filtered: ${filteredIssues.length} of ${issues.length} issues`);
}

/* ============================================
   Map Markers
   ============================================ */

/**
 * Create a custom colored marker icon based on severity
 * High → red, Medium → orange, Low → green
 */
function createMarkerIcon(severity) {
  const color = SEVERITY_COLORS[severity] || SEVERITY_COLORS.Low;

  return L.divIcon({
    html: `<div style="
            background-color: ${color};
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        "></div>`,
    className: "custom-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

/**
 * Render all issue markers on the map
 * Each marker shows popup with issue details on click
 */
function renderMarkers() {
  // Clear existing markers
  markers.forEach((marker) => map.removeLayer(marker));
  markers = [];

  // Add marker for each issue
  issues.forEach((issue) => {
    const icon = createMarkerIcon(issue.severity);

    const marker = L.marker([issue.latitude, issue.longitude], { icon }).addTo(
      map,
    );

    // Create popup content with issue details
    const popupContent = `
            <div class="map-popup">
                <div class="popup-title">${escapeHtml(issue.issue_type)}</div>
                <div class="popup-info">
                    <strong>Description:</strong> ${escapeHtml(issue.description.substring(0, 100))}${issue.description.length > 100 ? "..." : ""}
                </div>
                <div class="popup-info">
                    <strong>Priority Score:</strong> ${issue.priority_score}
                </div>
                <div class="popup-info">
                    <strong>Status:</strong> ${issue.status}
                </div>
                <div class="popup-info">
                    <strong>Severity:</strong> ${issue.severity}
                </div>
            </div>
        `;

    marker.bindPopup(popupContent);
    markers.push(marker);
  });

  console.log(`Rendered ${markers.length} markers`);
}

/* ============================================
   Clustering logic
   ============================================ */

/**
 * Simple clustering: detect areas with 3+ issues within 0.01 degrees
 * Draw red circle overlay for high-risk clusters
 */
function renderClusters() {
  // Clear existing cluster circles
  clusterCircles.forEach((circle) => map.removeLayer(circle));
  clusterCircles = [];

  if (issues.length < 3) return;

  // Grid-based clustering with 0.01 degree cells
  const gridSize = 0.01;
  const clusters = {};

  // Group issues into grid cells
  issues.forEach((issue) => {
    const gridX = Math.floor(issue.latitude / gridSize);
    const gridY = Math.floor(issue.longitude / gridSize);
    const key = `${gridX},${gridY}`;

    if (!clusters[key]) {
      clusters[key] = {
        issues: [],
        centerLat: 0,
        centerLng: 0,
      };
    }
    clusters[key].issues.push(issue);
    clusters[key].centerLat += issue.latitude;
    clusters[key].centerLng += issue.longitude;
  });

  // Draw circles for clusters with 3+ issues
  Object.values(clusters).forEach((cluster) => {
    if (cluster.issues.length >= 3) {
      // Calculate center of cluster
      const centerLat = cluster.centerLat / cluster.issues.length;
      const centerLng = cluster.centerLng / cluster.issues.length;

      // Draw red circle overlay
      const circle = L.circle([centerLat, centerLng], {
        color: "#e53e3e",
        fillColor: "#e53e3e",
        fillOpacity: 0.2,
        radius: 500, // 500 meters
        weight: 2,
      }).addTo(map);

      // Bind popup for cluster
      circle.bindPopup(`
                <div class="map-popup">
                    <div class="popup-title" style="color: #e53e3e;">⚠️ High Risk Cluster</div>
                    <div class="popup-info">
                        <strong>${cluster.issues.length} issues</strong> reported in this area
                    </div>
                </div>
            `);

      clusterCircles.push(circle);
    }
  });

  console.log(`Rendered ${clusterCircles.length} cluster zones`);
}

/* ============================================
   Issue Table
   ============================================ */

/**
 * Render issue table with filtered issues
 * Includes description, upvotes, and action buttons
 */
function renderIssueTable() {
  const tbody = document.getElementById("issues-tbody");
  const tableCount = document.getElementById("table-count");
  if (!tbody) return;

  // Update table count
  if (tableCount) {
    tableCount.textContent = `Showing ${filteredIssues.length} of ${issues.length} issues`;
  }

  // Clear existing rows
  tbody.innerHTML = "";

  if (filteredIssues.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: #718096;">
          ${issues.length === 0 ? "No issues reported yet" : "No issues match your filters"}
        </td>
      </tr>
    `;
    return;
  }

  // Create row for each filtered issue
  filteredIssues.forEach((issue) => {
    const row = document.createElement("tr");
    row.id = `issue-row-${issue.id}`;

    // Determine severity class for styling
    const severityClass = `severity-${issue.severity.toLowerCase()}`;

    // Format created time
    const createdTime = formatDateTime(issue.created_at);

    // Get type icon
    const typeIcon = TYPE_ICONS[issue.issue_type] || "📋";

    // Truncate description
    const shortDesc =
      issue.description.length > 50
        ? issue.description.substring(0, 50) + "..."
        : issue.description;

    // Create status dropdown HTML
    const statusOptions = VALID_STATUSES.map(
      (status) =>
        `<option value="${status}" ${issue.status === status ? "selected" : ""}>${status}</option>`,
    ).join("");

    // Upvote count
    const upvotes = issue.upvotes || 0;

    row.innerHTML = `
      <td>${typeIcon} ${escapeHtml(issue.issue_type)}</td>
      <td class="description-cell" title="${escapeHtml(issue.description)}">${escapeHtml(shortDesc)}</td>
      <td>
        <span class="severity-badge ${severityClass}">
          ${issue.severity}
        </span>
      </td>
      <td>
        <span class="priority-badge priority-${getPriorityLevel(issue.priority_score)}">
          ${issue.priority_score}
        </span>
      </td>
      <td>
        <span class="upvote-count">👍 ${upvotes}</span>
      </td>
      <td>
        <select class="status-select" data-issue-id="${issue.id}" onchange="handleStatusChange(this)">
          ${statusOptions}
        </select>
      </td>
      <td>${createdTime}</td>
      <td>
        <button class="action-btn view" onclick="openIssueModal(${issue.id})" title="View Details">👁️</button>
        <button class="action-btn upvote" onclick="handleUpvote(${issue.id})" title="Upvote">👍</button>
        <button class="action-btn delete" onclick="handleDelete(${issue.id})" title="Delete">🗑️</button>
      </td>
    `;

    tbody.appendChild(row);
  });

  console.log(`Rendered ${filteredIssues.length} table rows`);
}

/**
 * Get priority level for badge styling
 */
function getPriorityLevel(score) {
  if (score >= 50) return "high";
  if (score >= 30) return "medium";
  return "low";
}

/* ============================================
   Status update handler
   ============================================ */

/**
 * Handle status change from dropdown
 * Sends PATCH request to update issue status
 */
async function handleStatusChange(selectElement) {
  const issueId = selectElement.dataset.issueId;
  const newStatus = selectElement.value;

  console.log(`Updating issue ${issueId} status to: ${newStatus}`);

  try {
    const response = await fetch(`/api/issues/${issueId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: newStatus }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to update status");
    }

    const updatedIssue = await response.json();
    console.log("Issue updated:", updatedIssue);

    // Show success toast
    showToast(`Status updated to "${newStatus}"`, "success");

    // Refresh all data to update priority scores and stats
    await refreshAllData();
  } catch (error) {
    console.error("Error updating status:", error);
    showToast("Failed to update status", "error");

    // Revert dropdown on error
    await refreshAllData();
  }
}

/* ============================================
   Stats Display
   ============================================ */

/**
 * Update stats cards with fetched data
 * Response time card shows average issue handling time
 */
function updateStatsDisplay(stats) {
  // Update stat values
  const totalEl = document.getElementById("stat-total");
  const reportedEl = document.getElementById("stat-reported");
  const inProgressEl = document.getElementById("stat-inprogress");
  const resolvedEl = document.getElementById("stat-resolved");
  const responseEl = document.getElementById("stat-response");

  if (totalEl) totalEl.textContent = stats.total_issues;
  if (reportedEl) reportedEl.textContent = stats.reported_count;
  if (inProgressEl) inProgressEl.textContent = stats.in_progress_count || 0;
  if (resolvedEl) resolvedEl.textContent = stats.resolved_count;

  // Calculate and display Average Response Time
  // Using a simulated response time based on resolved issues ratio
  const resolvedRatio =
    stats.total_issues > 0 ? stats.resolved_count / stats.total_issues : 0;
  let avgResponseTime;
  if (stats.resolved_count === 0) {
    avgResponseTime = "--";
  } else if (resolvedRatio > 0.5) {
    avgResponseTime = "< 2h";
  } else if (resolvedRatio > 0.25) {
    avgResponseTime = "< 6h";
  } else {
    avgResponseTime = "< 24h";
  }

  if (responseEl) {
    responseEl.textContent = avgResponseTime;
  }

  console.log(`Stats updated - Avg Response: ${avgResponseTime}`);
}

/* ============================================
   Form submission
   ============================================ */

/**
 * Handle report form submission
 * POST to /api/issues, then refresh data
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  // Get form data
  const form = event.target;
  const formData = {
    issue_type: form.issue_type.value,
    description: form.description.value,
    severity: form.severity.value,
    latitude: parseFloat(form.latitude.value),
    longitude: parseFloat(form.longitude.value),
  };

  // Add image data if uploaded
  if (uploadedImageData) {
    formData.image = uploadedImageData;
  }

  // Validate required fields
  if (!formData.issue_type || !formData.description || !formData.severity) {
    showToast("Please fill in all required fields", "error");
    return;
  }

  if (isNaN(formData.latitude) || isNaN(formData.longitude)) {
    showToast("Please enter valid coordinates or click on the map", "error");
    return;
  }

  console.log("Submitting new issue:", formData);

  try {
    const response = await fetch("/api/issues", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to submit issue");
    }

    const newIssue = await response.json();
    console.log("Issue created:", newIssue);

    // Clear form
    form.reset();

    // Clear uploaded image
    clearImageUpload();

    // Show success message
    showToast("Issue reported successfully!", "success");

    // Switch back to dashboard view
    switchSection("dashboard");

    // Refresh all data without page reload
    await refreshAllData();

    // Pan map to new issue location
    map.setView([formData.latitude, formData.longitude], 15);
  } catch (error) {
    console.error("Error submitting issue:", error);
    showToast(error.message || "Failed to submit issue", "error");
  }
}

/* ============================================
   Navigation
   ============================================ */

/**
 * Switch between dashboard and report sections
 */
function switchSection(sectionName) {
  // Update nav links
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.remove("active");
    if (link.dataset.section === sectionName) {
      link.classList.add("active");
    }
  });

  // Show/hide sections
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.add("hidden");
  });

  const targetSection = document.getElementById(sectionName);
  if (targetSection) {
    targetSection.classList.remove("hidden");
  }

  // Invalidate map size when switching to dashboard (Leaflet fix)
  if (sectionName === "dashboard") {
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
  }
}

/* ============================================
   Toast Notifications
   ============================================ */

/**
 * Show toast notification
 */
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
        <span>${escapeHtml(message)}</span>
    `;

  container.appendChild(toast);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.style.animation = "slideInRight 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ============================================
   Utility Functions
   ============================================ */

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format ISO datetime to readable format
 */
function formatDateTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hr ago`;
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}

/* ============================================
   Modal Functions
   ============================================ */

/**
 * Open issue detail modal
 */
function openIssueModal(issueId) {
  selectedIssue = issues.find((i) => i.id === issueId);
  if (!selectedIssue) return;

  const modal = document.getElementById("issue-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");

  if (!modal || !modalBody) return;

  const typeIcon = TYPE_ICONS[selectedIssue.issue_type] || "📋";

  modalTitle.textContent = `${typeIcon} ${selectedIssue.issue_type}`;

  // Build image HTML if available
  const imageHtml = selectedIssue.image
    ? `
    <div class="detail-row">
      <span class="detail-label">Photo Evidence</span>
      <span class="detail-value">
        <img src="${selectedIssue.image}" alt="Issue photo" style="max-width: 100%; max-height: 200px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
      </span>
    </div>
  `
    : "";

  modalBody.innerHTML = `
    ${imageHtml}
    <div class="detail-row">
      <span class="detail-label">Description</span>
      <span class="detail-value">${escapeHtml(selectedIssue.description)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Severity</span>
      <span class="detail-value">
        <span class="severity-${selectedIssue.severity.toLowerCase()}" style="padding: 4px 12px; border-radius: 4px;">
          ${selectedIssue.severity}
        </span>
      </span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Status</span>
      <span class="detail-value">${selectedIssue.status}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Priority Score</span>
      <span class="detail-value">
        <span class="priority-badge priority-${getPriorityLevel(selectedIssue.priority_score)}">
          ${selectedIssue.priority_score}
        </span>
      </span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Upvotes</span>
      <span class="detail-value">👍 ${selectedIssue.upvotes || 0}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Location</span>
      <span class="detail-value">${selectedIssue.latitude.toFixed(6)}, ${selectedIssue.longitude.toFixed(6)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Created</span>
      <span class="detail-value">${formatDateTime(selectedIssue.created_at)}</span>
    </div>
  `;

  modal.classList.remove("hidden");
}

/**
 * Close issue modal
 */
function closeIssueModal() {
  const modal = document.getElementById("issue-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
  selectedIssue = null;
}

/* ============================================
   Delete and Upvote Functions
   ============================================ */

/**
 * Handle issue deletion
 */
async function handleDelete(issueId) {
  if (!confirm("Are you sure you want to delete this issue?")) return;

  try {
    const response = await fetch(`/api/issues/${issueId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to delete issue");
    }

    showToast("Issue deleted successfully", "success");
    closeIssueModal();
    await refreshAllData();
  } catch (error) {
    console.error("Error deleting issue:", error);
    showToast(error.message || "Failed to delete issue", "error");
  }
}

/**
 * Handle issue upvote
 */
async function handleUpvote(issueId) {
  try {
    const response = await fetch(`/api/issues/${issueId}/upvote`, {
      method: "POST",
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to upvote");
    }

    const data = await response.json();
    showToast(`Upvoted! Total: ${data.upvotes}`, "success");
    await refreshAllData();
  } catch (error) {
    console.error("Error upvoting:", error);
    showToast(error.message || "Failed to upvote", "error");
  }
}

/* ============================================
   Export Function
   ============================================ */

/**
 * Export issues to CSV
 */
function exportToCSV() {
  window.location.href = "/api/issues/export";
  showToast("Downloading issues as CSV...", "success");
}

/* ============================================
   Geolocation Function
   ============================================ */

/**
 * Get user's current location and fill form
 */
function useCurrentLocation() {
  const latInput = document.getElementById("latitude");
  const lngInput = document.getElementById("longitude");

  if (!navigator.geolocation) {
    showToast("Geolocation is not supported by your browser", "error");
    return;
  }

  showToast("Getting your location...", "info");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      if (latInput) latInput.value = latitude.toFixed(6);
      if (lngInput) lngInput.value = longitude.toFixed(6);

      // Pan map to user location
      map.setView([latitude, longitude], 15);

      showToast("Location detected successfully!", "success");
    },
    (error) => {
      console.error("Geolocation error:", error);
      let errorMsg = "Unable to get your location";
      if (error.code === 1) errorMsg = "Location access denied";
      if (error.code === 2) errorMsg = "Location unavailable";
      if (error.code === 3) errorMsg = "Location request timed out";
      showToast(errorMsg, "error");
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

/* ============================================
   Analytics Rendering
   ============================================ */

/**
 * Render analytics charts with stats data
 */
function renderAnalytics(stats) {
  renderTypeChart(stats.by_type || {});
  renderSeverityChart(stats.by_severity || {});
  renderStatusChart(stats);
  renderActivityTimeline();
}

/**
 * Render issues by type bar chart
 */
function renderTypeChart(byType) {
  const container = document.getElementById("chart-by-type");
  if (!container) return;

  const maxValue = Math.max(...Object.values(byType), 1);
  const colors = {
    Garbage: "#6b7280",
    "Water Leak": "#3b82f6",
    "Road Damage": "#f59e0b",
    Fire: "#ef4444",
    Accident: "#dc2626",
    Streetlight: "#fbbf24",
    "Noise Complaint": "#8b5cf6",
    Other: "#9ca3af",
  };

  container.innerHTML = `
    <div class="bar-chart">
      ${Object.entries(byType)
        .map(
          ([type, count]) => `
        <div class="bar-item">
          <span class="bar-label">${TYPE_ICONS[type] || "📋"} ${type}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${(count / maxValue) * 100}%; background: ${colors[type] || "#6b7280"}">
              ${count}
            </div>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

/**
 * Render issues by severity bar chart
 */
function renderSeverityChart(bySeverity) {
  const container = document.getElementById("chart-by-severity");
  if (!container) return;

  const total = Object.values(bySeverity).reduce((a, b) => a + b, 0) || 1;
  const colors = { High: "#e53e3e", Medium: "#dd6b20", Low: "#38a169" };

  container.innerHTML = `
    <div class="bar-chart">
      ${["High", "Medium", "Low"]
        .map(
          (severity) => `
        <div class="bar-item">
          <span class="bar-label">${severity}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${((bySeverity[severity] || 0) / total) * 100}%; background: ${colors[severity]}">
              ${bySeverity[severity] || 0}
            </div>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

/**
 * Render issues by status bar chart
 */
function renderStatusChart(stats) {
  const container = document.getElementById("chart-by-status");
  if (!container) return;

  const data = {
    Reported: stats.reported_count || 0,
    "In Progress": stats.in_progress_count || 0,
    Resolved: stats.resolved_count || 0,
  };
  const total = stats.total_issues || 1;
  const colors = {
    Reported: "#3b82f6",
    "In Progress": "#f59e0b",
    Resolved: "#22c55e",
  };

  container.innerHTML = `
    <div class="bar-chart">
      ${Object.entries(data)
        .map(
          ([status, count]) => `
        <div class="bar-item">
          <span class="bar-label">${status}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${(count / total) * 100}%; background: ${colors[status]}">
              ${count}
            </div>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

/**
 * Render recent activity timeline
 */
function renderActivityTimeline() {
  const container = document.getElementById("recent-activity");
  if (!container) return;

  // Sort issues by created_at descending
  const recentIssues = [...issues]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);

  if (recentIssues.length === 0) {
    container.innerHTML = '<p class="text-muted">No recent activity</p>';
    return;
  }

  container.innerHTML = recentIssues
    .map(
      (issue) => `
    <div class="activity-item">
      <div class="activity-icon ${issue.severity.toLowerCase()}">
        ${TYPE_ICONS[issue.issue_type] || "📋"}
      </div>
      <div class="activity-content">
        <div class="activity-title">${escapeHtml(issue.issue_type)}: ${escapeHtml(issue.description.substring(0, 60))}${issue.description.length > 60 ? "..." : ""}</div>
        <div class="activity-meta">${formatRelativeTime(issue.created_at)} · ${issue.status}</div>
      </div>
    </div>
  `,
    )
    .join("");
}

/* ============================================
   Filter Handlers
   ============================================ */

/**
 * Handle search input
 */
function handleSearch(event) {
  filters.search = event.target.value;
  applyFilters();
  renderIssueTable();
}

/**
 * Handle filter change
 */
function handleFilterChange() {
  filters.type = document.getElementById("filter-type")?.value || "";
  filters.severity = document.getElementById("filter-severity")?.value || "";
  filters.status = document.getElementById("filter-status")?.value || "";
  applyFilters();
  renderIssueTable();
}

/**
 * Clear all filters
 */
function clearFilters() {
  filters = { search: "", type: "", severity: "", status: "" };

  const searchInput = document.getElementById("search-input");
  const typeFilter = document.getElementById("filter-type");
  const severityFilter = document.getElementById("filter-severity");
  const statusFilter = document.getElementById("filter-status");

  if (searchInput) searchInput.value = "";
  if (typeFilter) typeFilter.value = "";
  if (severityFilter) severityFilter.value = "";
  if (statusFilter) statusFilter.value = "";

  applyFilters();
  renderIssueTable();
  showToast("Filters cleared", "info");
}

/* ============================================
   Event Listeners & Initialization
   ============================================ */

/**
 * Initialize application on DOM load
 */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("CivicPulse initializing...");

  // Initialize map
  initMap();

  // Fetch and display initial data
  await refreshAllData();

  // Setup navigation handlers
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      switchSection(section);
    });
  });

  // Setup form submission handler
  const reportForm = document.getElementById("report-form");
  if (reportForm) {
    reportForm.addEventListener("submit", handleFormSubmit);
  }

  // Setup search handler
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", handleSearch);
  }

  // Setup filter handlers
  const filterType = document.getElementById("filter-type");
  const filterSeverity = document.getElementById("filter-severity");
  const filterStatus = document.getElementById("filter-status");

  if (filterType) filterType.addEventListener("change", handleFilterChange);
  if (filterSeverity)
    filterSeverity.addEventListener("change", handleFilterChange);
  if (filterStatus) filterStatus.addEventListener("change", handleFilterChange);

  // Setup clear filters button
  const clearFiltersBtn = document.getElementById("clear-filters");
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", clearFilters);
  }

  // Setup export button
  const exportBtn = document.getElementById("export-btn");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportToCSV);
  }

  // Setup refresh button
  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      showToast("Refreshing data...", "info");
      await refreshAllData();
      showToast("Data refreshed!", "success");
    });
  }

  // Setup location button
  const locationBtn = document.getElementById("use-location-btn");
  if (locationBtn) {
    locationBtn.addEventListener("click", useCurrentLocation);
  }

  // Setup modal close handlers
  const modalClose = document.getElementById("modal-close");
  const modalCloseBtn = document.getElementById("modal-close-btn");
  const modalBackdrop = document.querySelector(".modal-backdrop");

  if (modalClose) modalClose.addEventListener("click", closeIssueModal);
  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeIssueModal);
  if (modalBackdrop) modalBackdrop.addEventListener("click", closeIssueModal);

  // Setup modal action buttons
  const modalUpvote = document.getElementById("modal-upvote");
  const modalDelete = document.getElementById("modal-delete");

  if (modalUpvote) {
    modalUpvote.addEventListener("click", () => {
      if (selectedIssue) handleUpvote(selectedIssue.id);
    });
  }

  if (modalDelete) {
    modalDelete.addEventListener("click", () => {
      if (selectedIssue) handleDelete(selectedIssue.id);
    });
  }

  // Escape key to close modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeIssueModal();
      closeAuthoritiesModal();
    }
  });

  // ============================================
  // IMAGE UPLOAD HANDLERS
  // ============================================
  initImageUpload();

  // ============================================
  // AUTHORITIES MODAL HANDLERS
  // ============================================
  initAuthoritiesModal();

  // ============================================
  // CURSOR EFFECTS & PARTICLES
  // ============================================
  initCursorEffects();
  initParticles();

  // Auto-refresh every 60 seconds
  setInterval(async () => {
    console.log("Auto-refreshing data...");
    await refreshAllData();
  }, 60000);

  console.log("CivicPulse ready!");
});

/* ============================================
   Cursor Glow & Trail Effect
   ============================================ */
function initCursorEffects() {
  const cursorGlow = document.getElementById("cursor-glow");
  const cursorTrail = document.getElementById("cursor-trail");

  if (!cursorGlow || !cursorTrail) return;

  // Check if mobile
  if (window.innerWidth <= 768) return;

  let mouseX = 0;
  let mouseY = 0;
  let glowX = 0;
  let glowY = 0;

  // Trail particles
  const trailParticles = [];
  const maxTrailParticles = 20;

  // Create trail dots
  for (let i = 0; i < maxTrailParticles; i++) {
    const dot = document.createElement("div");
    dot.className = "cursor-dot";
    dot.style.opacity = "0";
    cursorTrail.appendChild(dot);
    trailParticles.push({
      element: dot,
      x: 0,
      y: 0,
      scale: 1 - (i / maxTrailParticles) * 0.5,
    });
  }

  // Mouse move handler
  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    // Update trail particles
    trailParticles.forEach((particle, index) => {
      setTimeout(() => {
        particle.x = mouseX;
        particle.y = mouseY;
        particle.element.style.left = particle.x + "px";
        particle.element.style.top = particle.y + "px";
        particle.element.style.transform = `translate(-50%, -50%) scale(${particle.scale})`;
        particle.element.style.opacity = (1 - index / maxTrailParticles) * 0.6;
      }, index * 20);
    });
  });

  // Smooth glow follow
  function animateGlow() {
    const ease = 0.15;
    glowX += (mouseX - glowX) * ease;
    glowY += (mouseY - glowY) * ease;

    cursorGlow.style.left = glowX + "px";
    cursorGlow.style.top = glowY + "px";

    requestAnimationFrame(animateGlow);
  }
  animateGlow();

  // Click ripple effect
  document.addEventListener("click", (e) => {
    createRipple(e.clientX, e.clientY);
  });
}

function createRipple(x, y) {
  const ripple = document.createElement("div");
  ripple.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(99, 102, 241, 0.5), transparent);
    transform: translate(-50%, -50%) scale(0);
    pointer-events: none;
    z-index: 9999;
    animation: rippleEffect 0.6s ease-out forwards;
  `;

  document.body.appendChild(ripple);

  setTimeout(() => {
    ripple.remove();
  }, 600);
}

// Add ripple animation dynamically
const rippleStyle = document.createElement("style");
rippleStyle.textContent = `
  @keyframes rippleEffect {
    0% {
      transform: translate(-50%, -50%) scale(0);
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -50%) scale(15);
      opacity: 0;
    }
  }
`;
document.head.appendChild(rippleStyle);

/* ============================================
   Floating Particles Background
   ============================================ */
function initParticles() {
  const container = document.getElementById("particles");
  if (!container) return;

  const particleCount = 50;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";

    // Random position
    particle.style.left = Math.random() * 100 + "%";
    particle.style.top = Math.random() * 100 + "%";

    // Random size
    const size = Math.random() * 6 + 2;
    particle.style.width = size + "px";
    particle.style.height = size + "px";

    // Random animation duration and delay
    particle.style.animationDuration = Math.random() * 10 + 5 + "s";
    particle.style.animationDelay = Math.random() * 5 + "s";

    container.appendChild(particle);
  }
}

/* ============================================
   Image Upload Functionality
   ============================================ */
let uploadedImageData = null;

function initImageUpload() {
  const imageInput = document.getElementById("issue-image");
  const uploadBox = document.getElementById("image-upload-box");
  const previewContainer = document.getElementById("image-preview-container");
  const preview = document.getElementById("image-preview");
  const removeBtn = document.getElementById("remove-image");

  if (!imageInput || !uploadBox) return;

  // Click to upload
  uploadBox.addEventListener("click", () => {
    imageInput.click();
  });

  // File selected
  imageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      handleImageFile(file);
    }
  });

  // Drag and drop
  uploadBox.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadBox.classList.add("drag-over");
  });

  uploadBox.addEventListener("dragleave", (e) => {
    e.preventDefault();
    uploadBox.classList.remove("drag-over");
  });

  uploadBox.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadBox.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleImageFile(file);
    }
  });

  // Remove image
  if (removeBtn) {
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearImageUpload();
    });
  }
}

function handleImageFile(file) {
  // Validate file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    showToast("Image must be less than 5MB", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedImageData = e.target.result;

    const uploadBox = document.getElementById("image-upload-box");
    const previewContainer = document.getElementById("image-preview-container");
    const preview = document.getElementById("image-preview");

    if (uploadBox && previewContainer && preview) {
      preview.src = uploadedImageData;
      uploadBox.classList.add("hidden");
      previewContainer.classList.remove("hidden");
      showToast("Image uploaded successfully!", "success");
    }
  };
  reader.readAsDataURL(file);
}

function clearImageUpload() {
  uploadedImageData = null;
  const imageInput = document.getElementById("issue-image");
  const uploadBox = document.getElementById("image-upload-box");
  const previewContainer = document.getElementById("image-preview-container");

  if (imageInput) imageInput.value = "";
  if (uploadBox) uploadBox.classList.remove("hidden");
  if (previewContainer) previewContainer.classList.add("hidden");
}

/* ============================================
   Authorities Modal Functionality
   ============================================ */
function initAuthoritiesModal() {
  const escalateBtn = document.getElementById("modal-escalate");
  const closeBtn = document.getElementById("authorities-close");
  const closeFooterBtn = document.getElementById("authorities-close-btn");
  const backdrop = document.querySelector("#authorities-modal .modal-backdrop");

  if (escalateBtn) {
    escalateBtn.addEventListener("click", openAuthoritiesModal);
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", closeAuthoritiesModal);
  }

  if (closeFooterBtn) {
    closeFooterBtn.addEventListener("click", closeAuthoritiesModal);
  }

  if (backdrop) {
    backdrop.addEventListener("click", closeAuthoritiesModal);
  }
}

function openAuthoritiesModal() {
  const modal = document.getElementById("authorities-modal");
  if (modal) {
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
}

function closeAuthoritiesModal() {
  const modal = document.getElementById("authorities-modal");
  if (modal) {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }
}

function escalateToAuthority(authorityName, contactNumber) {
  // Close authorities modal
  closeAuthoritiesModal();

  // Create escalation record
  const escalationData = {
    authority: authorityName,
    contact: contactNumber,
    issue: selectedIssue,
    timestamp: new Date().toISOString(),
  };

  // Log for demo purposes
  console.log("🚨 Escalation Record:", escalationData);

  // Show success notification with animation
  showToast(
    `Issue escalated to ${authorityName}! Contact: ${contactNumber}`,
    "success",
  );

  // Simulate call initiation for demo
  setTimeout(() => {
    showToast(`📞 Connecting to ${authorityName}...`, "info");
  }, 1000);

  setTimeout(() => {
    showToast(
      `✅ ${authorityName} has been notified about Issue #${selectedIssue?.id || "N/A"}`,
      "success",
    );
  }, 2500);
}

// ============================================
// AUTHENTICATION FUNCTIONS
// ============================================

let currentUser = null;

// Check authentication on page load
async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    const data = await res.json();

    if (data.authenticated) {
      currentUser = data.user;
      showLoggedInUI(data.user, data.role);
    } else {
      showLoggedOutUI();
    }
  } catch (err) {
    console.log("Auth check failed:", err);
    showLoggedOutUI();
  }
}

function showLoggedInUI(user, role) {
  const authButtons = document.getElementById("auth-buttons");
  const userMenu = document.getElementById("user-menu");
  const userName = document.getElementById("user-name");

  if (authButtons) authButtons.style.display = "none";
  if (userMenu) userMenu.style.display = "block";
  if (userName) userName.textContent = user.name || user.username;
}

function showLoggedOutUI() {
  const authButtons = document.getElementById("auth-buttons");
  const userMenu = document.getElementById("user-menu");

  if (authButtons) authButtons.style.display = "flex";
  if (userMenu) userMenu.style.display = "none";
  currentUser = null;
}

// User menu dropdown toggle
document.addEventListener("DOMContentLoaded", () => {
  const userMenuBtn = document.getElementById("user-menu-btn");
  const userDropdown = document.getElementById("user-dropdown");

  if (userMenuBtn && userDropdown) {
    userMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle("active");
    });

    document.addEventListener("click", () => {
      userDropdown.classList.remove("active");
    });
  }

  // Check auth on load
  checkAuth();
});

// Logout function
async function logout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    currentUser = null;
    showLoggedOutUI();
    showToast("Logged out successfully", "success");
  } catch (err) {
    showToast("Logout failed", "error");
  }
}

// Profile Modal Functions
function openProfileModal() {
  if (!currentUser) {
    showToast("Please login first", "error");
    return;
  }

  const modal = document.getElementById("profile-modal");
  if (modal) {
    // Populate form fields
    document.getElementById("profile-name").value = currentUser.name || "";
    document.getElementById("profile-username").value =
      currentUser.username || "";
    document.getElementById("profile-email").value = currentUser.email || "";
    document.getElementById("profile-phone").value = currentUser.phone || "";
    document.getElementById("profile-address").value =
      currentUser.address || "";

    // Load stats
    loadProfileStats();

    modal.classList.add("active");
  }
}

function closeProfileModal() {
  const modal = document.getElementById("profile-modal");
  if (modal) modal.classList.remove("active");
}

async function loadProfileStats() {
  try {
    const res = await fetch("/api/user/profile", { credentials: "include" });
    const data = await res.json();

    document.getElementById("profile-issues-count").textContent =
      data.issues_reported || 0;
    document.getElementById("profile-resolved-count").textContent =
      data.issues_resolved || 0;
  } catch (err) {
    console.log("Failed to load profile stats:", err);
  }
}

// Profile form submission
document.addEventListener("DOMContentLoaded", () => {
  const profileForm = document.getElementById("profile-form");
  if (profileForm) {
    profileForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);

      try {
        const res = await fetch("/api/user/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          credentials: "include",
        });

        const result = await res.json();

        if (res.ok) {
          currentUser = result.user;
          document.getElementById("user-name").textContent = currentUser.name;
          showToast("Profile updated successfully", "success");
          closeProfileModal();
        } else {
          showToast(result.error || "Failed to update profile", "error");
        }
      } catch (err) {
        showToast("Connection error", "error");
      }
    });
  }
});

// Change Password Modal
function openChangePasswordModal() {
  const modal = document.getElementById("password-modal");
  if (modal) modal.classList.add("active");
}

function closeChangePasswordModal() {
  const modal = document.getElementById("password-modal");
  if (modal) modal.classList.remove("active");
}

document.addEventListener("DOMContentLoaded", () => {
  const passwordForm = document.getElementById("password-form");
  if (passwordForm) {
    passwordForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);

      try {
        const res = await fetch("/api/user/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          credentials: "include",
        });

        const result = await res.json();

        if (res.ok) {
          showToast("Password changed successfully", "success");
          closeChangePasswordModal();
          e.target.reset();
        } else {
          showToast(result.error || "Failed to change password", "error");
        }
      } catch (err) {
        showToast("Connection error", "error");
      }
    });
  }
});

// My Issues Modal
async function viewMyIssues() {
  if (!currentUser) {
    showToast("Please login first", "error");
    return;
  }

  const modal = document.getElementById("my-issues-modal");
  const list = document.getElementById("my-issues-list");

  if (modal && list) {
    modal.classList.add("active");
    list.innerHTML =
      '<p style="text-align: center; color: rgba(255,255,255,0.6);">Loading...</p>';

    try {
      const res = await fetch("/api/user/issues", { credentials: "include" });
      const issues = await res.json();

      if (issues.length === 0) {
        list.innerHTML =
          '<p style="text-align: center; color: rgba(255,255,255,0.6);">You haven\'t reported any issues yet.</p>';
      } else {
        list.innerHTML = issues
          .map(
            (issue) => `
          <div class="my-issue-card">
            <div class="my-issue-header">
              <span class="my-issue-type">${issue.issue_type}</span>
              <span class="my-issue-status ${issue.status.toLowerCase().replace(" ", "-")}">${issue.status}</span>
            </div>
            <div class="my-issue-description">${issue.description}</div>
            <div class="my-issue-meta">
              <span>📍 ${issue.latitude.toFixed(4)}, ${issue.longitude.toFixed(4)}</span>
              <span>🕐 ${new Date(issue.created_at).toLocaleDateString()}</span>
              <span>⚡ ${issue.severity}</span>
            </div>
          </div>
        `,
          )
          .join("");
      }
    } catch (err) {
      list.innerHTML =
        '<p style="text-align: center; color: #fca5a5;">Failed to load issues</p>';
    }
  }
}

function closeMyIssuesModal() {
  const modal = document.getElementById("my-issues-modal");
  if (modal) modal.classList.remove("active");
}

/* ============================================
   SMART CITY COMMAND CENTER FEATURES
   ============================================ */

// Timeline filter state
let timelineFilter = "all";

/* ============================================
   Custom Cursor Implementation
   ============================================ */
function initCustomCursor() {
  const cursor = document.getElementById("custom-cursor");
  if (!cursor) return;

  // Only enable on desktop
  if (window.innerWidth <= 768 || "ontouchstart" in window) return;

  cursor.classList.add("active");

  let mouseX = 0,
    mouseY = 0;
  let cursorX = 0,
    cursorY = 0;

  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  // Smooth cursor following
  function animateCursor() {
    const ease = 0.2;
    cursorX += (mouseX - cursorX) * ease;
    cursorY += (mouseY - cursorY) * ease;

    cursor.style.left = cursorX + "px";
    cursor.style.top = cursorY + "px";

    requestAnimationFrame(animateCursor);
  }
  animateCursor();

  // Hover effects
  const hoverElements = document.querySelectorAll(
    "a, button, .stat-card, .nav-link, .action-btn, .timeline-btn, .authority-card",
  );
  hoverElements.forEach((el) => {
    el.addEventListener("mouseenter", () => cursor.classList.add("hover"));
    el.addEventListener("mouseleave", () => cursor.classList.remove("hover"));
  });

  // Click effect
  document.addEventListener("mousedown", () => cursor.classList.add("click"));
  document.addEventListener("mouseup", () => cursor.classList.remove("click"));

  // Danger cursor on delete buttons
  const dangerElements = document.querySelectorAll(
    ".btn-delete, .action-btn.delete",
  );
  dangerElements.forEach((el) => {
    el.addEventListener("mouseenter", () => cursor.classList.add("danger"));
    el.addEventListener("mouseleave", () => cursor.classList.remove("danger"));
  });
}

/* ============================================
   Theme Toggle Implementation
   ============================================ */
function initThemeToggle() {
  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;

  // Load saved theme
  const savedTheme = localStorage.getItem("civicpulse-theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);

  toggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "dark" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("civicpulse-theme", newTheme);

    showToast(`Switched to ${newTheme} mode`, "info");
  });
}

/* ============================================
   Digital Clock Implementation
   ============================================ */
function initDigitalClock() {
  const clockEl = document.getElementById("digital-clock");
  if (!clockEl) return;

  function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    clockEl.textContent = `${hours}:${minutes}:${seconds}`;
  }

  updateClock();
  setInterval(updateClock, 1000);
}

/* ============================================
   Network Status Monitor
   ============================================ */
function initNetworkStatus() {
  const statusEl = document.getElementById("network-status");
  if (!statusEl) return;

  function updateStatus() {
    if (navigator.onLine) {
      statusEl.classList.remove("offline");
      statusEl.classList.add("online");
      statusEl.innerHTML =
        '<span class="network-dot"></span><span>Online</span>';
    } else {
      statusEl.classList.remove("online");
      statusEl.classList.add("offline");
      statusEl.innerHTML =
        '<span class="network-dot"></span><span>Offline</span>';
    }
  }

  updateStatus();
  window.addEventListener("online", updateStatus);
  window.addEventListener("offline", updateStatus);
}

/* ============================================
   City Status Banner Updates
   ============================================ */
function updateCityStatus(stats) {
  const banner = document.getElementById("city-status-banner");
  const statusText = document.getElementById("city-status-text");
  const activeCount = document.getElementById("active-issues-count");
  const htmlEl = document.documentElement;

  if (!banner || !stats) return;

  const activeIssues =
    (stats.reported_count || 0) + (stats.in_progress_count || 0);
  const healthScore = stats.resolution_percentage || 0;

  // Update active issues count
  if (activeCount) {
    activeCount.textContent = `${activeIssues} Active Issues`;
  }

  // Determine city status and mood
  banner.classList.remove("stable", "moderate", "critical");

  if (healthScore >= 70 && activeIssues < 10) {
    banner.classList.add("stable");
    if (statusText) statusText.textContent = "CITY STATUS: STABLE";
    htmlEl.setAttribute("data-mood", "calm");
  } else if (healthScore >= 40 || activeIssues < 25) {
    banner.classList.add("moderate");
    if (statusText) statusText.textContent = "CITY STATUS: MODERATE";
    htmlEl.setAttribute("data-mood", "moderate");
  } else {
    banner.classList.add("critical");
    if (statusText) statusText.textContent = "⚠️ CITY STATUS: CRITICAL";
    htmlEl.setAttribute("data-mood", "critical");
  }
}

/* ============================================
   Activity Ticker Updates
   ============================================ */
function updateActivityTicker() {
  const ticker = document.getElementById("ticker-content");
  if (!ticker || issues.length === 0) return;

  // Get 5 most recent issues
  const recentIssues = [...issues]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  let tickerHTML = "";
  recentIssues.forEach((issue, idx) => {
    const typeIcon = TYPE_ICONS[issue.issue_type] || "📋";
    const timeAgo = formatRelativeTime(issue.created_at);

    tickerHTML += `
      <div class="ticker-item">
        <span class="ticker-icon">${typeIcon}</span>
        <span>${issue.issue_type}: ${issue.description.substring(0, 40)}...</span>
        <span class="ticker-time">${timeAgo}</span>
      </div>
      <div class="ticker-separator"></div>
    `;
  });

  // Duplicate for seamless loop
  ticker.innerHTML = tickerHTML + tickerHTML;
}

/* ============================================
   Severity Heat Bar Updates
   ============================================ */
function updateSeverityHeatBar(stats) {
  const heatGradient = document.getElementById("heat-gradient");
  if (!heatGradient || !stats.by_severity) return;

  const high = stats.by_severity.High || 0;
  const medium = stats.by_severity.Medium || 0;
  const low = stats.by_severity.Low || 0;
  const total = high + medium + low || 1;

  const highRatio = high / total;

  if (highRatio > 0.3) {
    heatGradient.setAttribute("data-severity", "high");
  } else if (highRatio > 0.15) {
    heatGradient.setAttribute("data-severity", "medium");
  } else {
    heatGradient.setAttribute("data-severity", "low");
  }
}

/* ============================================
   Health Battery Gauge Animation (Horizontal)
   ============================================ */
function updateHealthGauge(percentage) {
  const batteryFill = document.getElementById("gauge-progress");
  const valueEl = document.getElementById("gauge-value");

  if (!batteryFill || !valueEl) return;

  // Update battery fill width (horizontal)
  batteryFill.style.width = `${percentage}%`;
  valueEl.textContent = `${percentage}%`;

  // Update color class
  batteryFill.classList.remove("healthy", "moderate", "critical");
  if (percentage >= 70) {
    batteryFill.classList.add("healthy");
  } else if (percentage >= 40) {
    batteryFill.classList.add("moderate");
  } else {
    batteryFill.classList.add("critical");
  }
}

/* ============================================
   Timeline Filter Implementation
   ============================================ */
function initTimelineFilter() {
  const buttons = document.querySelectorAll(".timeline-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      // Update active state
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Get time filter
      timelineFilter = btn.getAttribute("data-time");

      // Apply time-based filtering
      applyTimelineFilter();

      showToast(
        `Showing issues from ${timelineFilter === "all" ? "all time" : "last " + timelineFilter}`,
        "info",
      );
    });
  });
}

function applyTimelineFilter() {
  const now = new Date();
  let cutoffDate = null;

  switch (timelineFilter) {
    case "1h":
      cutoffDate = new Date(now - 60 * 60 * 1000);
      break;
    case "24h":
      cutoffDate = new Date(now - 24 * 60 * 60 * 1000);
      break;
    case "7d":
      cutoffDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      cutoffDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      cutoffDate = null;
  }

  if (cutoffDate) {
    filteredIssues = issues.filter((issue) => {
      const issueDate = new Date(issue.created_at);
      return issueDate >= cutoffDate;
    });
  } else {
    filteredIssues = [...issues];
  }

  // Re-apply other filters
  if (filters.search || filters.type || filters.severity || filters.status) {
    applyFilters();
  }

  renderIssueTable();
  renderMarkers();
}

/* ============================================
   Priority Leaderboard Updates
   ============================================ */
function updatePriorityLeaderboard() {
  const list = document.getElementById("leaderboard-list");
  if (!list) return;

  // Group by issue type and calculate total priority
  const typeScores = {};
  issues.forEach((issue) => {
    if (issue.status !== "Resolved") {
      const type = issue.issue_type;
      if (!typeScores[type]) {
        typeScores[type] = { count: 0, totalPriority: 0, highSeverity: 0 };
      }
      typeScores[type].count++;
      typeScores[type].totalPriority += issue.priority_score;
      if (issue.severity === "High") typeScores[type].highSeverity++;
    }
  });

  // Sort by total priority
  const sorted = Object.entries(typeScores)
    .sort((a, b) => b[1].totalPriority - a[1].totalPriority)
    .slice(0, 5);

  if (sorted.length === 0) {
    list.innerHTML =
      '<div class="leaderboard-item"><span style="color: var(--text-muted);">No active issues</span></div>';
    return;
  }

  list.innerHTML = sorted
    .map(([type, data], idx) => {
      const icon = TYPE_ICONS[type] || "📋";
      return `
      <div class="leaderboard-item">
        <span class="leaderboard-rank rank-${idx + 1}">${idx + 1}</span>
        <div class="leaderboard-info">
          <span class="leaderboard-type">${icon} ${type}</span>
          <span class="leaderboard-desc">${data.count} issues, ${data.highSeverity} high severity</span>
        </div>
        <span class="leaderboard-score">${data.totalPriority}</span>
      </div>
    `;
    })
    .join("");
}

/* ============================================
   AI Insights Updates
   ============================================ */
function updateAIInsights() {
  const container = document.getElementById("ai-insights");
  if (!container || issues.length === 0) return;

  const insights = generateAIInsights();

  container.innerHTML = insights
    .map(
      (insight) => `
    <div class="insight-item">
      <span class="insight-icon">${insight.icon}</span>
      <span>${insight.text}</span>
    </div>
  `,
    )
    .join("");
}

function generateAIInsights() {
  const insights = [];

  // Calculate stats
  const highSeverityCount = issues.filter(
    (i) => i.severity === "High" && i.status !== "Resolved",
  ).length;
  const resolvedToday = issues.filter((i) => {
    const date = new Date(i.updated_at || i.created_at);
    const today = new Date();
    return (
      i.status === "Resolved" && date.toDateString() === today.toDateString()
    );
  }).length;

  // Find most common issue type
  const typeCounts = {};
  issues.forEach((i) => {
    typeCounts[i.issue_type] = (typeCounts[i.issue_type] || 0) + 1;
  });
  const mostCommonType = Object.entries(typeCounts).sort(
    (a, b) => b[1] - a[1],
  )[0];

  // Generate insights
  if (highSeverityCount > 5) {
    insights.push({
      icon: "⚠️",
      text: `Alert: ${highSeverityCount} high-severity issues require immediate attention.`,
    });
  }

  if (mostCommonType) {
    insights.push({
      icon: "📊",
      text: `${mostCommonType[0]} is the most reported issue type (${mostCommonType[1]} reports).`,
    });
  }

  if (resolvedToday > 0) {
    insights.push({
      icon: "✅",
      text: `Great progress! ${resolvedToday} issues resolved today.`,
    });
  }

  // Cluster detection
  if (clusterCircles.length > 0) {
    insights.push({
      icon: "🎯",
      text: `${clusterCircles.length} high-risk cluster zone(s) detected. Consider targeted intervention.`,
    });
  }

  // Prediction insight
  const avgIssuesPerDay = issues.length / 30;
  insights.push({
    icon: "🔮",
    text: `Based on trends, expect approximately ${Math.round(avgIssuesPerDay)} new issues per day.`,
  });

  return insights.slice(0, 4);
}

/* ============================================
   Cluster Alert Toast
   ============================================ */
function showClusterAlert(clusterCount) {
  const toast = document.getElementById("cluster-alert-toast");
  const message = document.getElementById("cluster-alert-message");

  if (!toast || clusterCount === 0) return;

  message.textContent = `${clusterCount} high-risk cluster zone(s) detected. Multiple issues in concentrated areas require attention.`;

  toast.classList.add("visible");

  setTimeout(() => {
    toast.classList.remove("visible");
  }, 8000);
}

/* ============================================
   Side Drawer Implementation
   ============================================ */
function initSideDrawer() {
  const drawer = document.getElementById("side-drawer");
  const backdrop = document.getElementById("drawer-backdrop");
  const closeBtn = document.getElementById("drawer-close");

  if (!drawer || !backdrop || !closeBtn) return;

  closeBtn.addEventListener("click", closeSideDrawer);
  backdrop.addEventListener("click", closeSideDrawer);
}

function openSideDrawer(issue) {
  const drawer = document.getElementById("side-drawer");
  const backdrop = document.getElementById("drawer-backdrop");
  const detailsContainer = document.getElementById("drawer-issue-details");

  if (!drawer || !issue) return;

  // Update lifecycle tracker
  updateLifecycleTracker(issue.status);

  // Update danger meter based on priority
  updateDangerMeter(issue.priority_score);

  // Populate issue details
  if (detailsContainer) {
    const typeIcon = TYPE_ICONS[issue.issue_type] || "📋";
    detailsContainer.innerHTML = `
      <h4 class="drawer-section-title">Issue Information</h4>
      <div class="detail-row">
        <span class="detail-label">Type</span>
        <span class="detail-value">${typeIcon} ${issue.issue_type}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Description</span>
        <span class="detail-value">${escapeHtml(issue.description)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Severity</span>
        <span class="detail-value">
          <span class="severity-badge ${issue.severity.toLowerCase()}">${issue.severity}</span>
        </span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Priority Score</span>
        <span class="detail-value">${issue.priority_score}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Upvotes</span>
        <span class="detail-value">👍 ${issue.upvotes || 0}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Reported</span>
        <span class="detail-value">${formatDateTime(issue.created_at)}</span>
      </div>
    `;
  }

  drawer.classList.add("open");
  backdrop.classList.add("visible");
}

function closeSideDrawer() {
  const drawer = document.getElementById("side-drawer");
  const backdrop = document.getElementById("drawer-backdrop");

  if (drawer) drawer.classList.remove("open");
  if (backdrop) backdrop.classList.remove("visible");
}

function updateLifecycleTracker(status) {
  const stepReported = document.getElementById("step-reported");
  const stepProgress = document.getElementById("step-progress");
  const stepResolved = document.getElementById("step-resolved");
  const connector1 = document.getElementById("connector-1");
  const connector2 = document.getElementById("connector-2");

  // Reset all
  [stepReported, stepProgress, stepResolved].forEach((step) => {
    if (step) {
      step.classList.remove("completed", "active");
    }
  });
  [connector1, connector2].forEach((conn) => {
    if (conn) conn.classList.remove("completed");
  });

  // Set based on status
  if (status === "Reported") {
    if (stepReported) stepReported.classList.add("active");
  } else if (status === "In Progress") {
    if (stepReported) stepReported.classList.add("completed");
    if (connector1) connector1.classList.add("completed");
    if (stepProgress) stepProgress.classList.add("active");
  } else if (status === "Resolved") {
    if (stepReported) stepReported.classList.add("completed");
    if (connector1) connector1.classList.add("completed");
    if (stepProgress) stepProgress.classList.add("completed");
    if (connector2) connector2.classList.add("completed");
    if (stepResolved) stepResolved.classList.add("completed");
  }
}

function updateDangerMeter(priorityScore) {
  const fill = document.getElementById("danger-meter-fill");
  const label = document.getElementById("danger-meter-label");

  if (!fill || !label) return;

  // Calculate percentage (max score ~100)
  const percentage = Math.min(priorityScore, 100);
  fill.style.width = percentage + "%";

  // Update class and label
  fill.classList.remove("low", "moderate", "critical");

  if (priorityScore >= 60) {
    fill.classList.add("critical");
    label.textContent = "Critical";
  } else if (priorityScore >= 35) {
    fill.classList.add("moderate");
    label.textContent = "Moderate";
  } else {
    fill.classList.add("low");
    label.textContent = "Low Risk";
  }
}

/* ============================================
   Map Control Buttons
   ============================================ */
function initMapControls() {
  const centerBtn = document.getElementById("btn-center");
  const clusterBtn = document.getElementById("btn-clusters");
  const heatmapBtn = document.getElementById("btn-heatmap");
  const satelliteBtn = document.getElementById("btn-satellite");

  if (centerBtn) {
    centerBtn.addEventListener("click", () => {
      map.setView([11.0168, 76.9558], 13);
      showToast("Map centered to default view", "info");
    });
  }

  if (clusterBtn) {
    clusterBtn.addEventListener("click", () => {
      clusterBtn.classList.toggle("active");
      const isActive = clusterBtn.classList.contains("active");

      if (isActive) {
        renderClusters();
        showToast("Cluster zones visible", "info");
      } else {
        clusterCircles.forEach((circle) => map.removeLayer(circle));
        clusterCircles = [];
        showToast("Cluster zones hidden", "info");
      }
    });
  }
}

/* ============================================
   Cluster Badge Updates
   ============================================ */
function updateClusterBadge() {
  const badge = document.getElementById("cluster-badge");
  const countEl = document.getElementById("cluster-count");
  const heartbeat = document.getElementById("city-heartbeat");

  if (!badge) return;

  if (clusterCircles.length > 0) {
    badge.style.display = "block";
    if (countEl) countEl.textContent = clusterCircles.length;
    if (heartbeat) heartbeat.classList.add("active");

    // Show cluster alert
    showClusterAlert(clusterCircles.length);
  } else {
    badge.style.display = "none";
    if (heartbeat) heartbeat.classList.remove("active");
  }
}

/* ============================================
   Enhanced refreshAllData
   ============================================ */
const originalRefreshAllData = refreshAllData;
refreshAllData = async function () {
  await fetchIssues();
  applyTimelineFilter();
  renderMarkers();
  renderClusters();
  renderIssueTable();

  const stats = await fetchStats();
  if (stats) {
    currentStats = stats;
    updateStatsDisplay(stats);
    renderAnalytics(stats);

    // Update command center elements
    updateCityStatus(stats);
    updateSeverityHeatBar(stats);
    updateHealthGauge(stats.resolution_percentage || 0);
  }

  // Update other UI elements
  updateActivityTicker();
  updatePriorityLeaderboard();
  updateAIInsights();
  updateClusterBadge();
};

/* ============================================
   Initialize Command Center Features
   ============================================ */
document.addEventListener("DOMContentLoaded", () => {
  // Initialize all command center features
  setTimeout(() => {
    initCustomCursor();
    initThemeToggle();
    initDigitalClock();
    initNetworkStatus();
    initTimelineFilter();
    initSideDrawer();
    initMapControls();

    // Initialize Innovative Features
    initFAB();
    initLiveFeed();
    initGamification();
    initWeatherWidget();
    initScrollHideWidgets();

    console.log("✅ Smart City Command Center initialized!");
  }, 100);
});

/* ============================================
   INNOVATIVE FEATURES - JavaScript
   ============================================ */

// 0. Scroll Hide Widgets
function initScrollHideWidgets() {
  const widgets = document.querySelectorAll(
    ".citizen-badge-panel, .weather-widget, .health-battery-fixed",
  );
  let lastScrollTop = 0;
  const scrollThreshold = 100; // Pixels scrolled before hiding

  window.addEventListener(
    "scroll",
    () => {
      const scrollTop =
        window.pageYOffset || document.documentElement.scrollTop;

      if (scrollTop > scrollThreshold) {
        // Scrolled down past threshold - hide widgets
        widgets.forEach((widget) => {
          widget.classList.add("scroll-hidden");
        });
      } else {
        // Back to top - show widgets
        widgets.forEach((widget) => {
          widget.classList.remove("scroll-hidden");
        });
      }

      lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
    },
    { passive: true },
  );
}

// 1. Floating Action Button (FAB)
function initFAB() {
  const fabMain = document.getElementById("fab-main");
  const fabContainer = document.querySelector(".fab-container");
  const fabActions = document.querySelectorAll(".fab-action");

  if (!fabMain) return;

  fabMain.addEventListener("click", () => {
    fabContainer.classList.toggle("open");
  });

  // Close FAB when clicking outside
  document.addEventListener("click", (e) => {
    if (!fabContainer.contains(e.target)) {
      fabContainer.classList.remove("open");
    }
  });

  // FAB action handlers
  fabActions.forEach((action) => {
    action.addEventListener("click", () => {
      const actionType = action.dataset.action;
      handleFABAction(actionType);
      fabContainer.classList.remove("open");
    });
  });
}

function handleFABAction(action) {
  switch (action) {
    case "voice":
      startVoiceReport();
      break;
    case "photo":
      showToast("📷 Photo capture coming soon!", "info");
      break;
    case "quick":
      // Navigate to report section
      document.querySelector('[data-section="report"]')?.click();
      break;
    case "sos":
      triggerSOS();
      break;
  }
}

function triggerSOS() {
  // SOS emergency report
  showToast("🆘 Emergency services notified! Help is on the way.", "danger");
  triggerConfetti(["#ef4444", "#f97316", "#fbbf24"]);
}

// 2. Live Activity Feed
const activityFeed = [];
const MAX_FEED_ITEMS = 20;

function initLiveFeed() {
  const toggle = document.getElementById("live-feed-toggle");
  const panel = document.getElementById("live-feed-panel");
  const closeBtn = document.getElementById("feed-close");

  if (!toggle || !panel) return;

  toggle.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      renderLiveFeed();
    }
  });

  closeBtn?.addEventListener("click", () => {
    panel.classList.remove("open");
  });

  // Simulate live activities
  setInterval(() => {
    if (Math.random() > 0.7) {
      addFeedActivity(generateRandomActivity());
    }
  }, 5000);
}

function generateRandomActivity() {
  const activities = [
    { type: "📝 New Report", action: "Road damage reported in RS Puram" },
    { type: "✅ Resolved", action: "Water leak fixed at Gandhi Park" },
    { type: "⚙️ In Progress", action: "Garbage cleanup started" },
    { type: "👍 Upvoted", action: "Streetlight issue got 5 upvotes" },
    { type: "🚨 Alert", action: "High priority issue detected" },
    { type: "📊 Analysis", action: "AI detected cluster formation" },
  ];
  return activities[Math.floor(Math.random() * activities.length)];
}

function addFeedActivity(activity) {
  activityFeed.unshift({
    ...activity,
    time: new Date(),
    isNew: true,
  });

  if (activityFeed.length > MAX_FEED_ITEMS) {
    activityFeed.pop();
  }

  renderLiveFeed();
}

function renderLiveFeed() {
  const container = document.getElementById("live-feed-content");
  if (!container) return;

  container.innerHTML = activityFeed
    .map(
      (item, index) => `
    <div class="feed-item ${item.isNew ? "new" : ""}" style="animation-delay: ${index * 0.05}s">
      <div class="feed-item-header">
        <span class="feed-item-type">${item.type}</span>
        <span class="feed-item-time">${formatTimeAgo(item.time)}</span>
      </div>
      <div class="feed-item-action">${item.action}</div>
    </div>
  `,
    )
    .join("");

  // Mark all as seen
  setTimeout(() => {
    activityFeed.forEach((item) => (item.isNew = false));
  }, 1000);
}

function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// 3. Gamification System
const CITIZEN_LEVELS = [
  { level: 1, name: "Newcomer", xpRequired: 0, badge: "🌱" },
  { level: 2, name: "Contributor", xpRequired: 100, badge: "🌿" },
  { level: 3, name: "Guardian", xpRequired: 300, badge: "🌳" },
  { level: 4, name: "Champion", xpRequired: 600, badge: "⭐" },
  { level: 5, name: "Hero", xpRequired: 1000, badge: "🏆" },
  { level: 6, name: "Legend", xpRequired: 2000, badge: "👑" },
];

const ACHIEVEMENTS = [
  {
    id: "first_report",
    name: "First Report",
    icon: "📝",
    description: "Submit your first issue report",
  },
  {
    id: "early_bird",
    name: "Early Bird",
    icon: "🌅",
    description: "Report an issue before 7 AM",
  },
  {
    id: "night_owl",
    name: "Night Owl",
    icon: "🦉",
    description: "Report an issue after 10 PM",
  },
  {
    id: "cluster_buster",
    name: "Cluster Buster",
    icon: "💥",
    description: "Help resolve a cluster of issues",
  },
  {
    id: "community_hero",
    name: "Community Hero",
    icon: "🦸",
    description: "Get 50 upvotes on your reports",
  },
  {
    id: "streak_master",
    name: "Streak Master",
    icon: "🔥",
    description: "7 day reporting streak",
  },
  {
    id: "area_expert",
    name: "Area Expert",
    icon: "📍",
    description: "Report 10 issues in one area",
  },
  {
    id: "quick_responder",
    name: "Quick Responder",
    icon: "⚡",
    description: "Report within 5 min of seeing",
  },
];

let citizenXP = parseInt(localStorage.getItem("citizenXP") || "0");
let unlockedAchievements = JSON.parse(
  localStorage.getItem("achievements") || "[]",
);

function initGamification() {
  updateGamificationUI();
  renderBadges();

  // Add some initial XP for demo
  if (citizenXP === 0) {
    addXP(50); // Welcome bonus
  }
}

function updateGamificationUI() {
  const currentLevel = getCurrentLevel();
  const nextLevel = CITIZEN_LEVELS[currentLevel.level] || currentLevel;

  const levelBadge = document.querySelector(".level-badge");
  const levelName = document.querySelector(".level-name");
  const xpFill = document.getElementById("xp-fill");

  if (levelBadge) levelBadge.textContent = `Lv.${currentLevel.level}`;
  if (levelName) levelName.textContent = currentLevel.name;

  if (xpFill) {
    const progress =
      ((citizenXP - currentLevel.xpRequired) /
        (nextLevel.xpRequired - currentLevel.xpRequired)) *
      100;
    xpFill.style.width = `${Math.min(progress, 100)}%`;
  }
}

function getCurrentLevel() {
  for (let i = CITIZEN_LEVELS.length - 1; i >= 0; i--) {
    if (citizenXP >= CITIZEN_LEVELS[i].xpRequired) {
      return CITIZEN_LEVELS[i];
    }
  }
  return CITIZEN_LEVELS[0];
}

function addXP(amount) {
  const oldLevel = getCurrentLevel();
  citizenXP += amount;
  localStorage.setItem("citizenXP", citizenXP.toString());

  const newLevel = getCurrentLevel();
  updateGamificationUI();

  if (newLevel.level > oldLevel.level) {
    showAchievement(`Level Up! ${newLevel.name}`);
    triggerConfetti();
  }
}

function unlockAchievement(achievementId) {
  if (unlockedAchievements.includes(achievementId)) return;

  const achievement = ACHIEVEMENTS.find((a) => a.id === achievementId);
  if (!achievement) return;

  unlockedAchievements.push(achievementId);
  localStorage.setItem("achievements", JSON.stringify(unlockedAchievements));

  showAchievement(achievement.name);
  addXP(50);
  renderBadges();
  triggerConfetti();
}

function renderBadges() {
  const container = document.getElementById("earned-badges");
  if (!container) return;

  container.innerHTML = ACHIEVEMENTS.slice(0, 6)
    .map((achievement) => {
      const unlocked = unlockedAchievements.includes(achievement.id);
      return `
      <div class="earned-badge ${unlocked ? "" : "locked"}" title="${achievement.name}: ${achievement.description}">
        ${achievement.icon}
      </div>
    `;
    })
    .join("");
}

function showAchievement(name) {
  const toast = document.getElementById("achievement-toast");
  const nameEl = document.getElementById("achievement-name");

  if (!toast || !nameEl) return;

  nameEl.textContent = name;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 4000);
}

// 4. Weather Widget
function initWeatherWidget() {
  updateWeather();
  setInterval(updateWeather, 600000); // Update every 10 minutes
}

async function updateWeather() {
  // Simulated weather data (in production, use a real API)
  const weatherConditions = [
    { icon: "☀️", temp: 32, condition: "Sunny", impact: "Normal" },
    { icon: "⛅", temp: 28, condition: "Partly Cloudy", impact: "Normal" },
    {
      icon: "🌧️",
      temp: 24,
      condition: "Rainy",
      impact: "High",
      impactClass: "danger",
    },
    { icon: "🌤️", temp: 30, condition: "Clear", impact: "Normal" },
    {
      icon: "⛈️",
      temp: 22,
      condition: "Thunderstorm",
      impact: "Critical",
      impactClass: "danger",
    },
  ];

  const weather =
    weatherConditions[Math.floor(Math.random() * weatherConditions.length)];

  const iconEl = document.getElementById("weather-icon");
  const tempEl = document.getElementById("weather-temp");
  const conditionEl = document.getElementById("weather-condition");
  const impactEl = document.querySelector(".impact-value");

  if (iconEl) iconEl.textContent = weather.icon;
  if (tempEl) tempEl.textContent = `${weather.temp}°C`;
  if (conditionEl) conditionEl.textContent = weather.condition;
  if (impactEl) {
    impactEl.textContent = weather.impact;
    impactEl.className = `impact-value ${weather.impactClass || ""}`;
  }
}

// 5. Voice Command
let recognition;

function startVoiceReport() {
  if (
    !("webkitSpeechRecognition" in window) &&
    !("SpeechRecognition" in window)
  ) {
    showToast("🎤 Voice recognition not supported in this browser", "warning");
    return;
  }

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  const modal = document.getElementById("voice-modal");
  const transcript = document.getElementById("voice-transcript");
  const voiceText = document.getElementById("voice-text");

  modal?.classList.add("active");
  if (voiceText) voiceText.textContent = "Listening...";
  if (transcript) transcript.textContent = "";

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    if (transcript) transcript.textContent = result[0].transcript;

    if (result.isFinal) {
      processVoiceCommand(result[0].transcript);
    }
  };

  recognition.onerror = (event) => {
    console.error("Voice recognition error:", event.error);
    cancelVoiceReport();
    showToast("🎤 Voice recognition failed. Please try again.", "error");
  };

  recognition.onend = () => {
    if (voiceText) voiceText.textContent = "Processing...";
  };

  recognition.start();
}

function cancelVoiceReport() {
  if (recognition) recognition.stop();
  document.getElementById("voice-modal")?.classList.remove("active");
}

function processVoiceCommand(text) {
  cancelVoiceReport();

  // Simple command processing
  const lowerText = text.toLowerCase();

  if (lowerText.includes("report") || lowerText.includes("issue")) {
    document.querySelector('[data-section="report"]')?.click();

    // Try to auto-fill based on keywords
    const descField = document.getElementById("description");
    if (descField) descField.value = text;

    showToast("📝 Voice report started! Please complete the form.", "success");
    unlockAchievement("first_report");
  } else if (lowerText.includes("dashboard") || lowerText.includes("home")) {
    document.querySelector('[data-section="dashboard"]')?.click();
    showToast("🏠 Navigated to Dashboard", "info");
  } else if (lowerText.includes("analytics") || lowerText.includes("stats")) {
    document.querySelector('[data-section="analytics"]')?.click();
    showToast("📊 Navigated to Analytics", "info");
  } else {
    showToast(`🎤 Heard: "${text}"`, "info");
  }
}

// Make cancelVoiceReport available globally
window.cancelVoiceReport = cancelVoiceReport;

// 7. Confetti Celebration
function triggerConfetti(
  colors = ["#6366f1", "#a855f7", "#ec4899", "#22c55e", "#f59e0b"],
) {
  const container = document.getElementById("confetti-container");
  if (!container) return;

  const confettiCount = 50;

  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement("div");
    confetti.className = "confetti";
    confetti.style.left = `${Math.random() * 100}%`;
    confetti.style.background =
      colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDelay = `${Math.random() * 0.5}s`;
    confetti.style.animationDuration = `${2 + Math.random() * 2}s`;

    const shapes = ["circle", "square", "rect"];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    if (shape === "circle") confetti.style.borderRadius = "50%";
    if (shape === "rect") {
      confetti.style.width = "15px";
      confetti.style.height = "8px";
    }

    container.appendChild(confetti);

    // Remove confetti after animation
    setTimeout(() => confetti.remove(), 3500);
  }
}

// Hook into existing functions for gamification
const originalHandleSubmit = window.handleReportSubmit;
if (typeof originalHandleSubmit === "function") {
  window.handleReportSubmit = async function (...args) {
    const result = await originalHandleSubmit.apply(this, args);
    if (result !== false) {
      addXP(25);
      unlockAchievement("first_report");
      addFeedActivity({
        type: "📝 New Report",
        action: "You submitted a new issue!",
      });

      const hour = new Date().getHours();
      if (hour < 7) unlockAchievement("early_bird");
      if (hour >= 22) unlockAchievement("night_owl");
    }
    return result;
  };
}

// Export functions for global access
window.triggerConfetti = triggerConfetti;
window.addXP = addXP;
window.unlockAchievement = unlockAchievement;
window.showAchievement = showAchievement;
