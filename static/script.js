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
      <td class="${severityClass}">${issue.severity}</td>
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
 * Civic Health Score card color based on resolution rate
 */
function updateStatsDisplay(stats) {
  // Update stat values
  const totalEl = document.getElementById("stat-total");
  const reportedEl = document.getElementById("stat-reported");
  const inProgressEl = document.getElementById("stat-inprogress");
  const resolvedEl = document.getElementById("stat-resolved");
  const healthEl = document.getElementById("stat-health");

  if (totalEl) totalEl.textContent = stats.total_issues;
  if (reportedEl) reportedEl.textContent = stats.reported_count;
  if (inProgressEl) inProgressEl.textContent = stats.in_progress_count || 0;
  if (resolvedEl) resolvedEl.textContent = stats.resolved_count;

  // Calculate and display Civic Health Score
  const resolutionRate = stats.resolution_percentage;
  if (healthEl) {
    healthEl.textContent = `${resolutionRate}%`;
  }

  // Color the health card based on resolution rate
  const healthCard = document.querySelector(".health-card");
  if (healthCard) {
    // Apply color based on rate
    if (resolutionRate > 70) {
      healthCard.style.borderLeft = "4px solid #38a169"; // Green
      healthCard.style.background = "linear-gradient(135deg, #f0fff4, #ffffff)";
    } else if (resolutionRate >= 40) {
      healthCard.style.borderLeft = "4px solid #dd6b20"; // Yellow/Orange
      healthCard.style.background = "linear-gradient(135deg, #fffff0, #ffffff)";
    } else {
      healthCard.style.borderLeft = "4px solid #e53e3e"; // Red
      healthCard.style.background = "linear-gradient(135deg, #fff5f5, #ffffff)";
    }
  }

  console.log(`Stats updated - Health Score: ${resolutionRate}%`);
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
