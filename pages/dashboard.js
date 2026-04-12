// Dashboard JavaScript - CCS Sit-in Monitoring System

// =============================================
// Global Variables
// =============================================
let currentUser = null;
let sessionToken = null;
let allHistoryData = [];
let notifications = [];

// =============================================
// Initialization
// =============================================
document.addEventListener("DOMContentLoaded", function () {
  // Check if session token exists
  sessionToken = localStorage.getItem("session_token");

  if (!sessionToken) {
    // Redirect to login if not authenticated
    window.location.href = "login.html";
    return;
  }

  // Validate session and get user data from server
  validateSession();
});

async function validateSession() {
  showLoading(true);

  try {
    const response = await fetch(`/api/session/validate?token=${sessionToken}`);

    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;

      // Initialize dashboard with user data from database
      initializeDashboard();
    } else {
      // Session invalid, redirect to login
      localStorage.removeItem("session_token");
      window.location.href = "login.html";
    }
  } catch (error) {
    console.error("Error validating session:", error);
    // Redirect to login on error
    localStorage.removeItem("session_token");
    window.location.href = "login.html";
  }

  showLoading(false);
}

function initializeDashboard() {
  // Get user role
  const userRole = currentUser.role || "student";

  // Display user information
  displayUserInfo();

  if (userRole === "admin") {
    // Show admin dashboard directly
    showSection("adminDashboard");
    // Load admin dashboard data
    loadAdminStats();
    loadAdminAnnouncements();
  } else {
    // Show student dashboard
    showSection("dashboard");
    // Load student dashboard data
    loadSitInHistory();
    loadNotifications();
    loadAnnouncements();
  }

  // Setup event listeners
  setupEventListeners();
}

// =============================================
// Admin Functions
// =============================================
async function loadAdminStats() {
  try {
    const response = await fetch("/api/admin/stats");
    if (response.ok) {
      const stats = await response.json();
      document.getElementById("totalStudents").textContent =
        stats.totalStudents || 0;
      document.getElementById("activeSitins").textContent =
        stats.activeSitins || 0;
      document.getElementById("todayReservations").textContent =
        stats.todayReservations || 0;
      document.getElementById("totalFeedbacks").textContent =
        stats.totalFeedbacks || 0;
    }
  } catch (error) {
    console.error("Error loading admin stats:", error);
  }
}

async function loadAllStudents() {
  try {
    const response = await fetch("/api/admin/students");
    if (response.ok) {
      const students = await response.json();
      displayStudents(students);
    }
  } catch (error) {
    console.error("Error loading students:", error);
  }
}

function displayStudents(students) {
  const tbody = document.getElementById("studentsTableBody");
  if (!tbody) return;

  // Update statistics
  if (students) {
    document.getElementById("mgmtTotalStudents").textContent = students.length;
    // Simple heuristic for "active" - students who have at least one sit-in record in the last 30 days
    // For now, we'll just show the total registered count in multiple stats since we don't have complex activity tracking yet
    document.getElementById("mgmtActiveStudents").textContent = students.filter(
      (s) => s.is_active,
    ).length;
    document.getElementById("mgmtNewStudents").textContent =
      students.slice(-5).length; // Last 5 added
  }

  if (!students || students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No students found</td></tr>';
    return;
  }

  tbody.innerHTML = students
    .map((student, index) => {
      const delay = (index * 0.03).toFixed(2);
      const statusClass = student.is_active
        ? "status-active"
        : "status-inactive";
      const statusText = student.is_active ? "Active" : "Inactive";

      return `
            <tr class="animate__animated animate__fadeInUp" style="animation-delay: ${delay}s">
                <td><span class="id-badge">${student.id_number}</span></td>
                <td>
                    <div class="user-info-cell">
                        <div class="avatar-mini">${student.first_name.charAt(0)}</div>
                        <div class="name-details">
                            <span class="full-name">${student.first_name} ${student.last_name}</span>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="course-cell">
                        <span class="course-code">${student.course}</span>
                        <span class="year-level">${student.course_level} Year</span>
                    </div>
                </td>
                <td><span class="email-text">${student.email}</span></td>
                <td>
                    <div class="sessions-cell">
                        <span class="session-count ${student.remaining_sessions < 5 ? "low" : ""}">${student.remaining_sessions || 0}</span>
                        <span class="session-label">left</span>
                    </div>
                </td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action reset" onclick="resetStudentSessions(${student.id}, '${student.first_name} ${student.last_name}')" title="Reset Sessions">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button class="btn-action edit" onclick="editStudentSessions(${student.id}, ${student.remaining_sessions || 0})" title="Edit Sessions">
                            <i class="fas fa-plus-circle"></i>
                        </button>
                        <button class="btn-action view" onclick="viewStudent(${student.id})" title="View Profile">
                            <i class="fas fa-user"></i>
                        </button>
                        <button class="btn-action delete" onclick="deleteStudent(${student.id}, '${student.first_name} ${student.last_name}')" title="Delete">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    })
    .join("");
}

function filterStudentTable() {
  const input = document.getElementById("studentMgmtSearch");
  const filter = input.value.toLowerCase();
  const tbody = document.getElementById("studentsTableBody");
  const rows = tbody.getElementsByTagName("tr");

  for (let i = 0; i < rows.length; i++) {
    const text = rows[i].textContent.toLowerCase();
    rows[i].style.display = text.includes(filter) ? "" : "none";
  }
}

async function loadAllRecords() {
  try {
    const response = await fetch("/api/admin/records");
    if (response.ok) {
      const records = await response.json();
      displayRecords(records);
    }
  } catch (error) {
    console.error("Error loading records:", error);
  }
}

function displayRecords(records) {
  const tbody = document.getElementById("recordsTableBody");
  if (!tbody) return;

  // Update Statistics
  if (records) {
    document.getElementById("archiveTotalRecords").textContent = records.length;

    // Calculate total hours
    let totalMinutes = 0;
    const labCounts = {};

    records.forEach((r) => {
      if (r.time_out) {
        const [inH, inM] = r.time_in.split(":").map(Number);
        const [outH, outM] = r.time_out.split(":").map(Number);
        totalMinutes += outH * 60 + outM - (inH * 60 + inM);
      }
      labCounts[r.lab_room] = (labCounts[r.lab_room] || 0) + 1;
    });

    const hours = Math.floor(totalMinutes / 60);
    document.getElementById("totalLabHours").textContent = `${hours}h`;

    // Find most active lab
    let bestLab = "N/A";
    let max = 0;
    for (const lab in labCounts) {
      if (labCounts[lab] > max) {
        max = labCounts[lab];
        bestLab = lab;
      }
    }
    document.getElementById("mostActiveLab").textContent = bestLab;
  }

  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8">No records found</td></tr>';
    return;
  }

  tbody.innerHTML = records
    .map((record, index) => {
      const delay = (index * 0.02).toFixed(2);
      const duration = record.time_out
        ? calculateDuration(record.time_in, record.time_out)
        : '<span class="live-tag">Live</span>';

      return `
            <tr class="animate__animated animate__fadeIn" style="animation-delay: ${delay}s">
                <td><span class="date-chip">${record.date}</span></td>
                <td>
                    <div class="student-info-mini">
                        <span class="name">${record.first_name} ${record.last_name}</span>
                    </div>
                </td>
                <td><span class="id-text">${record.id_number}</span></td>
                <td><span class="lab-badge">${record.lab_room}</span></td>
                <td>
                    <div class="time-bundle">
                        <span class="in"><i class="far fa-clock"></i> ${record.time_in}</span>
                        <span class="arrow"><i class="fas fa-long-arrow-alt-right"></i></span>
                        <span class="out">${record.time_out || "Present"}</span>
                    </div>
                </td>
                <td><span class="duration-text">${duration}</span></td>
                <td><span class="duration-text" style="color: #64748b;">${record.remaining_sessions || 0}</span></td>
                <td><span class="purpose-tag">${record.purpose}</span></td>
            </tr>
        `;
    })
    .join("");
}

function exportToCSV() {
  const table = document.getElementById("recordsTable");
  let csv = [];
  const rows = table.querySelectorAll("tr");

  for (const row of rows) {
    const cols = row.querySelectorAll("td, th");
    const rowData = Array.from(cols).map(
      (col) => `"${col.innerText.replace(/"/g, '""')}"`,
    );
    csv.push(rowData.join(","));
  }

  const csvContent = "data:text/csv;charset=utf-8," + csv.join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute(
    "download",
    `sit_in_records_${new Date().toISOString().split("T")[0]}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function calculateDuration(timeIn, timeOut) {
  const [inH, inM] = timeIn.split(":").map(Number);
  const [outH, outM] = timeOut.split(":").map(Number);
  const diffMinutes = outH * 60 + outM - (inH * 60 + inM);
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return `${hours}h ${minutes}m`;
}

async function loadFeedbacks() {
  try {
    const response = await fetch("/api/admin/feedbacks");
    if (response.ok) {
      const feedbacks = await response.json();
      displayFeedbacks(feedbacks);
      const totalCountEl = document.getElementById("totalFeedbacksCount");
      if (totalCountEl) totalCountEl.textContent = feedbacks.length || 0;

      // Legacy counter for main dashboard
      const legacyCountEl = document.getElementById("totalFeedbacks");
      if (legacyCountEl) legacyCountEl.textContent = feedbacks.length || 0;
    }
  } catch (error) {
    console.error("Error loading feedbacks:", error);
  }
}

function displayFeedbacks(feedbacks) {
  const grid = document.getElementById("adminFeedbackGrid");
  if (!grid) return;

  if (!feedbacks || feedbacks.length === 0) {
    grid.innerHTML = `
            <div class="empty-monitor">
                <i class="fas fa-comment-slash"></i>
                <p>No student feedback reports currently available.</p>
            </div>
        `;
    return;
  }

  grid.innerHTML = feedbacks
    .map((feedback, index) => {
      const delay = (index * 0.05).toFixed(2);
      const initial = feedback.first_name
        ? feedback.first_name.charAt(0).toUpperCase()
        : "?";

      return `
            <div class="admin-feedback-card animate__animated animate__fadeInUp" style="animation-delay: ${delay}s">
                <div class="feedback-card-header">
                    <div class="feedback-user">
                        <div class="feedback-avatar">${initial}</div>
                        <div class="user-meta">
                            <h4>${escapeHtml(feedback.first_name)} ${escapeHtml(feedback.last_name)}</h4>
                            <span>ID: ${escapeHtml(feedback.id_number)}</span>
                        </div>
                    </div>
                    <span class="feedback-date">${formatDate(feedback.created_at)}</span>
                </div>
                <div class="feedback-card-body">
                    <p class="feedback-comment">"${escapeHtml(feedback.comment || "No comment provided.")}"</p>
                </div>
                <div class="feedback-card-footer">
                    <button class="btn-action view" title="Reply to student">
                        <i class="fas fa-reply"></i>
                    </button>
                    <button class="btn-action delete" title="Dismiss feedback">
                        <i class="fas fa-check"></i>
                    </button>
                </div>
            </div>
        `;
    })
    .join("");
}

// Search student by ID number or name (admin)
async function adminSearchStudent() {
  const query = document.getElementById("adminSearchInput").value.trim();
  if (!query) {
    alert("Please enter a student ID number or name");
    return;
  }

  const searchResults = document.getElementById("searchResults");
  const studentInfoForm = document.getElementById("studentInfoForm");

  try {
    const response = await fetch(
      `/api/admin/students/search?q=${encodeURIComponent(query)}`,
    );

    if (response.ok) {
      const students = await response.json();

      if (students.length === 0) {
        studentInfoForm.style.display = "none";
        searchResults.innerHTML =
          '<p class="no-data-message">No student found with that ID number or name</p>';
      } else if (students.length === 1) {
        // Single result - show student info
        const student = students[0];
        displayStudentInfo(student);
        document.getElementById("searchResults").innerHTML = "";
        studentInfoForm.style.display = "block";
      } else {
        // Multiple results - show list
        studentInfoForm.style.display = "none";
        displaySearchResultsListWithSitIn(students);
      }
    } else if (response.status === 404) {
      studentInfoForm.style.display = "none";
      searchResults.innerHTML =
        '<p class="no-data-message">No student found with that ID number or name</p>';
    } else {
      throw new Error("Search failed");
    }
  } catch (error) {
    console.error("Error searching:", error);
    studentInfoForm.style.display = "none";
    searchResults.innerHTML =
      '<p class="no-data-message">Error searching for student</p>';
  }
}

// Redirect to sit-in form with student pre-filled
function redirectToSitInForm(student) {
  // Hide search results
  document.getElementById("searchResults").innerHTML = "";
  document.getElementById("studentInfoForm").style.display = "none";

  // Open modal and populate
  redirectToSitInFormFromModal(student);
}

// Display search results list with option to go to sit-in
function displaySearchResultsListWithSitIn(students) {
  const searchResults = document.getElementById("searchResults");
  searchResults.innerHTML = students
    .map(
      (student) => `
        <div class="search-result-item" onclick="selectStudentForSitIn(${student.id})">
            <div class="search-result-info">
                <strong>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</strong>
                <span>ID: ${escapeHtml(student.id_number)}</span>
                <span>${escapeHtml(student.course)} - ${student.course_level} Year</span>
            </div>
            <button class="btn-primary btn-small">
                <i class="fas fa-sign-in-alt"></i> Check In
            </button>
        </div>
    `,
    )
    .join("");
}

// Select a student from search results for sit-in
async function selectStudentForSitIn(studentId) {
  try {
    const response = await fetch(`/api/user/${studentId}`);

    if (response.ok) {
      const student = await response.json();
      // Show student info instead of redirecting to sit-in
      document.getElementById("searchResults").innerHTML = "";
      displayStudentInfo(student);
      document.getElementById("studentInfoForm").style.display = "block";
    }
  } catch (error) {
    console.error("Error loading student:", error);
  }
}

// Display list of search results
function displaySearchResultsList(students) {
  const searchResults = document.getElementById("searchResults");
  searchResults.innerHTML = students
    .map(
      (student) => `
        <div class="search-result-item" onclick="selectStudent(${student.id})">
            <div class="search-result-info">
                <strong>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</strong>
                <span>ID: ${escapeHtml(student.id_number)}</span>
                <span>${escapeHtml(student.course)} - ${student.course_level} Year</span>
            </div>
        </div>
    `,
    )
    .join("");
}

// Select a student from search results
async function selectStudent(studentId) {
  const token =
    localStorage.getItem("session_token") ||
    sessionStorage.getItem("session_token");

  try {
    const response = await fetch(`/api/user/${studentId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const student = await response.json();
      displayStudentInfo(student);
      document.getElementById("searchResults").innerHTML = "";
      document.getElementById("studentInfoForm").style.display = "block";
    }
  } catch (error) {
    console.error("Error loading student:", error);
  }
}

function displayStudentInfo(student) {
  document.getElementById("studentIdNumber").textContent = student.id_number;
  document.getElementById("studentName").textContent =
    `${student.first_name} ${student.middle_name || ""} ${student.last_name}`.trim();
  document.getElementById("studentCourse").textContent =
    student.course || "N/A";
  document.getElementById("studentYear").textContent = student.course_level
    ? `${student.course_level} Year`
    : "N/A";
  document.getElementById("studentEmail").textContent = student.email || "N/A";
  document.getElementById("studentStatus").textContent = student.is_active
    ? "Active"
    : "Inactive";
  document.getElementById("studentStatus").style.color = student.is_active
    ? "#28a745"
    : "#dc3545";

  // Store student data for check-in
  window.currentStudentInfo = student;
}

function checkInStudentFromInfo() {
  const student = window.currentStudentInfo;
  if (!student) return;

  redirectToSitInFormFromModal(student);
}

function closeStudentInfo() {
  document.getElementById("studentInfoForm").style.display = "none";
  document.getElementById("adminSearchInput").value = "";
}

// =============================================
// Search Modal Functions
// =============================================
function openSearchModal() {
  const modal = document.getElementById("searchModal");
  modal.classList.remove("hidden");
  document.getElementById("modalSearchInput").value = "";
  document.getElementById("modalSearchResults").innerHTML = "";
  document.getElementById("modalSearchInput").focus();

  // Add enter key listener
  document.getElementById("modalSearchInput").onkeypress = function (e) {
    if (e.key === "Enter") {
      modalSearchStudent();
    }
  };
}

function closeSearchModal() {
  const modal = document.getElementById("searchModal");
  modal.classList.add("hidden");
}

// =============================================
// Student Management Functions
// =============================================
function showAddStudentForm() {
  const modal = document.getElementById("addStudentModal");
  modal.classList.remove("hidden");
}

function closeAddStudentModal() {
  const modal = document.getElementById("addStudentModal");
  modal.classList.add("hidden");
  document.getElementById("addStudentForm").reset();
}

async function submitAddStudent(event) {
  event.preventDefault();

  const studentData = {
    id_number: document.getElementById("newStudentId").value.trim(),
    first_name: document.getElementById("newStudentFirstName").value.trim(),
    last_name: document.getElementById("newStudentLastName").value.trim(),
    middle_name: document.getElementById("newStudentMiddleName").value.trim(),
    email: document.getElementById("newStudentEmail").value.trim(),
    course: document.getElementById("newStudentCourse").value,
    course_level: parseInt(document.getElementById("newStudentYear").value),
    address: document.getElementById("newStudentAddress").value.trim(),
    password: document.getElementById("newStudentPassword").value,
    remaining_sessions:
      parseInt(document.getElementById("newStudentSessions").value) || 30,
  };

  try {
    const response = await fetch("/api/admin/students", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(studentData),
    });

    if (response.ok) {
      showSuccessModal(
        "Student Added",
        `${studentData.first_name} ${studentData.last_name} has been added successfully!`,
      );
      closeAddStudentModal();
      loadAllStudents(); // Refresh the table
    } else {
      const error = await response.json();
      showErrorModal("Error", error.error || "Failed to add student");
    }
  } catch (error) {
    console.error("Error adding student:", error);
    showErrorModal("Error", "An error occurred while adding student");
  }
}

async function deleteStudent(studentId, studentName) {
  if (!confirm(`Are you sure you want to delete student: ${studentName}?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/students/${studentId}`, {
      method: "DELETE",
    });

    if (response.ok) {
      showSuccessModal(
        "Student Deleted",
        `${studentName} has been deleted successfully!`,
      );
      loadAllStudents(); // Refresh the table
    } else {
      const error = await response.json();
      showErrorModal("Error", error.error || "Failed to delete student");
    }
  } catch (error) {
    console.error("Error deleting student:", error);
    showErrorModal("Error", "An error occurred while deleting student");
  }
}

// Edit student remaining sessions
function editStudentSessions(studentId, currentSessions) {
  const newSessions = prompt(
    `Enter new remaining sessions for student (current: ${currentSessions}):`,
    currentSessions,
  );

  if (newSessions === null || newSessions === "") {
    return;
  }

  const sessions = parseInt(newSessions, 10);

  if (isNaN(sessions) || sessions < 0) {
    showErrorModal("Invalid Value", "Please enter a valid positive number");
    return;
  }

  updateStudentSessions(studentId, sessions);
}

// Reset student sessions to default (30)
async function resetStudentSessions(studentId, studentName) {
  if (
    !confirm(
      `Are you sure you want to reset remaining sessions for ${studentName} to 30?`,
    )
  ) {
    return;
  }

  showLoading(true);
  try {
    const response = await fetch(`/api/admin/students/${studentId}/sessions`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ remaining_sessions: 30 }),
    });

    if (response.ok) {
      showSuccessModal(
        "Sessions Reset",
        `${studentName}'s remaining sessions have been reset to 30 successfully!`,
      );
      loadAllStudents(); // Refresh the table
    } else {
      const error = await response.json();
      showErrorModal("Error", error.error || "Failed to reset sessions");
    }
  } catch (error) {
    console.error("Error resetting sessions:", error);
    showErrorModal("Error", "An error occurred while resetting sessions");
  }
  showLoading(false);
}

async function updateStudentSessions(studentId, sessions) {
  try {
    const response = await fetch(`/api/admin/students/${studentId}/sessions`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ remaining_sessions: sessions }),
    });

    if (response.ok) {
      showSuccessModal(
        "Sessions Updated",
        `Student's remaining sessions have been updated to ${sessions}!`,
      );
      loadAllStudents(); // Refresh the table
    } else {
      const error = await response.json();
      showErrorModal(
        "Error",
        error.error || "Failed to update remaining sessions",
      );
    }
  } catch (error) {
    console.error("Error updating sessions:", error);
    showErrorModal("Error", "An error occurred while updating sessions");
  }
}

// Show success modal
function showSuccessModal(title, message) {
  const modalHtml = `
        <div id="successModal" class="modal">
            <div class="modal-content animate__animated animate__fadeInUp" style="max-width: 400px; text-align: center;">
                <div style="text-align: center; margin-bottom: 15px;">
                    <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #28a745 0%, #20c997 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(40, 167, 69, 0.3);">
                        <i class="fas fa-check" style="font-size: 30px; color: white;"></i>
                    </div>
                </div>
                <h2 style="color: #28a745; margin: 0 0 15px 0;">${escapeHtml(title)}</h2>
                <p style="color: #666; margin-bottom: 20px;">${escapeHtml(message)}</p>
                <button class="btn-primary" style="width: 100%; padding: 12px; font-size: 16px;" onclick="closeSuccessModal()">
                    <i class="fas fa-check"></i> OK
                </button>
            </div>
        </div>
    `;

  const existingModal = document.getElementById("successModal");
  if (existingModal) {
    existingModal.remove();
  }

  document.body.insertAdjacentHTML("beforeend", modalHtml);
}

function closeSuccessModal() {
  const modal = document.getElementById("successModal");
  if (modal) {
    modal.remove();
  }
}

// Search student from modal
async function modalSearchStudent() {
  const query = document.getElementById("modalSearchInput").value.trim();
  if (!query) {
    alert("Please enter a student ID number or name");
    return;
  }

  const resultsContainer = document.getElementById("modalSearchResults");

  try {
    const response = await fetch(
      `/api/admin/students/search?q=${encodeURIComponent(query)}`,
    );

    if (response.ok) {
      const students = await response.json();

      if (students.length === 0) {
        resultsContainer.innerHTML =
          '<p class="no-data-message">No student found with that ID number or name</p>';
        document.getElementById("modalStudentDetails").classList.add("hidden");
      } else if (students.length === 1) {
        // Single result - show detailed info in modal
        const student = students[0];
        displayModalStudentInfo(student);
      } else {
        // Multiple results - show list
        displayModalSearchResults(students);
        document.getElementById("modalStudentDetails").classList.add("hidden");
      }
    } else if (response.status === 404) {
      resultsContainer.innerHTML =
        '<p class="no-data-message">No student found with that ID number or name</p>';
    } else {
      throw new Error("Search failed");
    }
  } catch (error) {
    console.error("Error searching:", error);
    resultsContainer.innerHTML =
      '<p class="no-data-message">Error searching for student</p>';
  }
}

// Display search results in modal
function displayModalSearchResults(students) {
  const resultsContainer = document.getElementById("modalSearchResults");
  resultsContainer.innerHTML = students
    .map(
      (student) => `
        <div class="modal-search-result-item" onclick="selectStudentForSitInFromModal(${student.id})">
            <div class="result-info">
                <strong>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</strong>
                <span>ID: ${escapeHtml(student.id_number)}</span>
                <span>${escapeHtml(student.course)} - ${student.course_level} Year</span>
                <span>Sessions: ${student.remaining_sessions || 0}</span>
            </div>
            <button class="btn-primary btn-small">
                <i class="fas fa-eye"></i> View Details
            </button>
        </div>
    `,
    )
    .join("");
}

// Display detailed student info in modal
function displayModalStudentInfo(student) {
  const resultsContainer = document.getElementById("modalSearchResults");
  const detailsContainer = document.getElementById("modalStudentDetails");

  // Store current student for the check-in button
  window.currentModalStudent = student;

  // Clear list
  resultsContainer.innerHTML = "";

  // Create detailed card
  const initial = student.first_name
    ? student.first_name.charAt(0).toUpperCase()
    : "?";
  const statusClass = student.is_active ? "status-active" : "status-inactive";
  const statusText = student.is_active ? "Active" : "Inactive";

  detailsContainer.innerHTML = `
        <div class="student-detail-card animate__animated animate__fadeIn">
            <div class="detail-header">
                <div class="detail-avatar">${initial}</div>
                <div class="detail-title">
                    <h3>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</h3>
                    <span class="detail-id">ID: ${escapeHtml(student.id_number)}</span>
                </div>
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="detail-grid">
                <div class="detail-item">
                    <label>Course & Level</label>
                    <p>${escapeHtml(student.course)} - ${student.course_level} Year</p>
                </div>
                <div class="detail-item">
                    <label>Email Address</label>
                    <p>${escapeHtml(student.email)}</p>
                </div>
                <div class="detail-item">
                    <label>Sessions Remaining</label>
                    <p class="sessions-highlight">${student.remaining_sessions || 0} left</p>
                </div>
                <!-- New Dropdowns for Direct Check-in -->
                <div class="detail-item">
                    <label for="modalLabRoom">Laboratory Room</label>
                    <select id="modalLabRoom" class="modal-dropdown">
                        <option value="" disabled selected>Select Room</option>
                        <option value="Lab 524">Lab 524</option>
                        <option value="Lab 526">Lab 526</option>
                        <option value="Lab 528">Lab 528</option>
                        <option value="Lab 530">Lab 530</option>
                        <option value="Lab 544">Lab 542</option>
                        <option value="Lab 542">Lab 544</option>
                    </select>
                </div>
                <div class="detail-item full-width">
                    <label for="modalPurpose">Purpose of Sit-in</label>
                    <select id="modalPurpose" class="modal-dropdown">
                        <option value="" disabled selected>Select Purpose</option>
                        <option value="C-Programming">C-Programming</option>
                        <option value="Java Programming">Java Programming</option>
                        <option value="Python Programming">Python Programming</option>
                        <option value="Web Development">Web Development</option>
                        <option value="Database Management">Database Management</option>
                        <option value="Networking">Networking</option>
                        <option value="Machine Learning">Machine Learning</option>
                        <option value="Research/Thesis">Research/Thesis</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
            </div>
            <div class="detail-actions">
                <button class="btn-primary-gradient" onclick='checkInFromModal()'>
                    <i class="fas fa-check-circle"></i> Sit-in
                </button>
                <div class="secondary-actions">
                    <button class="btn-link" onclick='redirectToSitInFormFromModal(window.currentModalStudent)'>
                        Advanced Check-in
                    </button>
                    <button class="btn-link" onclick="openSearchModal()">
                        <i class="fas fa-arrow-left"></i> Back to Search
                    </button>
                </div>
            </div>
        </div>
    `;

  detailsContainer.classList.remove("hidden");
}

// Perform direct check-in from the search modal card
async function checkInFromModal() {
  const student = window.currentModalStudent;
  if (!student) return;

  const labRoom = document.getElementById("modalLabRoom").value;
  const purpose = document.getElementById("modalPurpose").value;

  if (!labRoom || !purpose) {
    showErrorModal(
      "Missing Fields",
      "Please select both Laboratory Room and Purpose.",
    );
    return;
  }

  try {
    const response = await fetch("/api/sitin/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: student.id,
        lab_room: labRoom,
        purpose: purpose,
      }),
    });

    if (response.ok) {
      closeSearchModal();
      showCheckInSuccessModal(student, labRoom, purpose);

      // Refresh stats if on admin dashboard
      if (typeof loadAdminStats === "function") loadAdminStats();
      if (typeof loadActiveSitins === "function") loadActiveSitins();
    } else {
      const error = await response.json();
      showErrorModal("Check-in Failed", error.error || "Server error occurred");
    }
  } catch (error) {
    console.error("Error checking in:", error);
    showErrorModal("Network Error", "Could not connect to the server");
  }
}

// Redirect to sit-in form from modal
function redirectToSitInFormFromModal(student) {
  closeSearchModal();

  // Get the sit-in modal form elements
  const sitInModal = document.getElementById("sitInModal");
  const studentIdInput = sitInModal.querySelector("#sitInStudentId");
  const studentNameInput = sitInModal.querySelector("#sitInStudentName");
  const studentSessionInput = sitInModal.querySelector("#sitInStudentSession");
  const labRoomInput = sitInModal.querySelector("#labRoom");
  const sitInPurposeInput = sitInModal.querySelector("#sitInPurpose");

  // Populate student data in the modal
  if (studentIdInput) {
    studentIdInput.value = student.id_number;
    studentIdInput.dataset.studentId = student.id;
    studentIdInput.dataset.studentName = `${student.first_name} ${student.last_name}`;
    studentIdInput.dataset.studentCourse = student.course;
    studentIdInput.dataset.studentYear = student.course_level;
  }

  // Populate student name and remaining sessions
  if (studentNameInput) {
    studentNameInput.value = `${student.first_name} ${student.last_name}`;
  }
  if (studentSessionInput) {
    studentSessionInput.value = student.remaining_sessions || 0;
  }

  // Clear lab room and purpose
  if (labRoomInput) labRoomInput.value = "";
  if (sitInPurposeInput) sitInPurposeInput.value = "";

  // Open the sit-in modal
  openSitInModal();
}

// Open sit-in modal
function openSitInModal() {
  const modal = document.getElementById("sitInModal");
  modal.classList.remove("hidden");
}

// Close sit-in modal
function closeSitInModal() {
  const modal = document.getElementById("sitInModal");
  modal.classList.add("hidden");
  // Reset form
  document.getElementById("adminSitInForm").reset();
}

// Show check-in success modal
function showCheckInSuccessModal(student, labRoom, purpose) {
  const modalHtml = `
        <div id="checkInSuccessModal" class="modal">
            <div class="modal-content animate__animated animate__fadeInUp" style="max-width: 450px;">
                <div style="text-align: center; margin-bottom: 20px;">
                    <div style="width: 70px; height: 70px; background: linear-gradient(135deg, #28a745 0%, #20c997 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 15px; box-shadow: 0 4px 15px rgba(40, 167, 69, 0.3);">
                        <i class="fas fa-check" style="font-size: 35px; color: white;"></i>
                    </div>
                    <h2 style="color: #28a745; margin: 0;">Check-in Successful!</h2>
                </div>
                <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                    <div style="display: grid; gap: 12px;">
                        <div style="display: flex; justify-content: space-between; background: white; padding: 12px 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                            <span style="color: #666; font-size: 14px;">Student</span>
                            <span style="font-weight: 600; color: #333;">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; background: white; padding: 12px 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                            <span style="color: #666; font-size: 14px;">ID Number</span>
                            <span style="font-weight: 600; color: #333;">${escapeHtml(student.id_number)}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; background: white; padding: 12px 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                            <span style="color: #666; font-size: 14px;">Lab Room</span>
                            <span style="font-weight: 600; color: #333;">${escapeHtml(labRoom)}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; background: white; padding: 12px 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                            <span style="color: #666; font-size: 14px;">Purpose</span>
                            <span style="font-weight: 600; color: #333;">${escapeHtml(purpose)}</span>
                        </div>
                    </div>
                </div>
                <button class="btn-primary" style="width: 100%; padding: 14px; font-size: 16px;" onclick="closeCheckInSuccessModal()">
                    <i class="fas fa-check"></i> Done
                </button>
            </div>
        </div>
    `;

  const existingModal = document.getElementById("checkInSuccessModal");
  if (existingModal) {
    existingModal.remove();
  }

  document.body.insertAdjacentHTML("beforeend", modalHtml);
}

function closeCheckInSuccessModal() {
  const modal = document.getElementById("checkInSuccessModal");
  if (modal) {
    modal.remove();
  }
}

// Show error modal
function showErrorModal(title, message) {
  const modalHtml = `
        <div id="errorModal" class="modal">
            <div class="modal-content animate__animated animate__fadeInUp" style="max-width: 400px; text-align: center;">
                <div style="text-align: center; margin-bottom: 15px;">
                    <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(220, 53, 69, 0.3);">
                        <i class="fas fa-exclamation-triangle" style="font-size: 30px; color: white;"></i>
                    </div>
                </div>
                <h2 style="color: #dc3545; margin: 0 0 15px 0;">${escapeHtml(title)}</h2>
                <p style="color: #666; margin-bottom: 20px;">${escapeHtml(message)}</p>
                <button class="btn-primary" style="background: #dc3545; width: 100%; padding: 12px; font-size: 16px;" onclick="closeErrorModal()">
                    <i class="fas fa-check"></i> OK
                </button>
            </div>
        </div>
    `;

  const existingModal = document.getElementById("errorModal");
  if (existingModal) {
    existingModal.remove();
  }

  document.body.insertAdjacentHTML("beforeend", modalHtml);
}

function closeErrorModal() {
  const modal = document.getElementById("errorModal");
  if (modal) {
    modal.remove();
  }
}

// Select student from modal results
async function selectStudentForSitInFromModal(studentId) {
  try {
    const response = await fetch(`/api/user/${studentId}`);

    if (response.ok) {
      const student = await response.json();
      displayModalStudentInfo(student);
    }
  } catch (error) {
    console.error("Error loading student:", error);
  }
}

// Legacy function for backward compatibility
async function adminSearch() {
  const query = document.getElementById("adminSearchInput").value;
  if (!query) return;

  try {
    const response = await fetch(
      `/api/admin/search?q=${encodeURIComponent(query)}`,
    );
    if (response.ok) {
      const results = await response.json();
      displaySearchResults(results);
    }
  } catch (error) {
    console.error("Error searching:", error);
  }
}

function displaySearchResults(results) {
  const container = document.getElementById("searchResults");
  if (!container) return;

  if (!results || results.length === 0) {
    container.innerHTML = '<p class="no-data-message">No results found</p>';
    return;
  }

  container.innerHTML = results
    .map(
      (result) => `
        <div class="search-result-item">
            <div class="result-info">
                <strong>${result.first_name} ${result.last_name}</strong>
                <span>ID: ${result.id_number}</span>
                <span>${result.course} - ${result.course_level} Year</span>
            </div>
            <button class="btn-icon" onclick="viewStudent(${result.id})">
                <i class="fas fa-eye"></i>
            </button>
        </div>
    `,
    )
    .join("");
}

// =============================================
// Announcements Functions
// =============================================

// Load announcements for admin
async function loadAdminAnnouncements() {
  try {
    const token =
      localStorage.getItem("session_token") ||
      sessionStorage.getItem("session_token");
    const response = await fetch("/api/admin/announcements", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.ok) {
      const announcements = await response.json();
      displayAdminAnnouncements(announcements);
      displayDashboardAnnouncements(announcements);
    }
  } catch (error) {
    console.error("Error loading announcements:", error);
  }
}

// Display announcements in the admin dashboard list
function displayDashboardAnnouncements(announcements) {
  const container = document.getElementById("dashboardAnnouncementsList");
  if (!container) return;

  if (!announcements || announcements.length === 0) {
    container.innerHTML = '<p class="no-data-message">No announcements yet</p>';
    return;
  }

  container.innerHTML = announcements
    .slice(0, 5)
    .map(
      (announcement) => `
        <div class="dashboard-announcement-item ${announcement.priority || "normal"}">
            <div class="dashboard-announcement-item-header">
                <h5>${escapeHtml(announcement.title)}</h5>
                <span class="dashboard-announcement-item-date">${formatDate(announcement.created_at)}</span>
            </div>
            <p class="dashboard-announcement-item-content">${escapeHtml(announcement.content)}</p>
            <div class="dashboard-announcement-item-actions">
                <button class="btn-remove" onclick="deleteAnnouncement(${announcement.id})">
                    <i class="fas fa-trash"></i> Remove
                </button>
            </div>
        </div>
    `,
    )
    .join("");
}

// Display announcements in the admin dashboard list
function displayAdminAnnouncements(announcements) {
  const container = document.getElementById("announcementsList");
  if (!container) return;

  if (!announcements || announcements.length === 0) {
    container.innerHTML = '<p class="no-data-message">No announcements yet</p>';
    return;
  }

  container.innerHTML = announcements
    .map(
      (announcement) => `
        <div class="announcement-item">
            <div class="announcement-item-header">
                <h4>${escapeHtml(announcement.title)}</h4>
                <span class="announcement-item-date">${formatDate(announcement.created_at)}</span>
            </div>
            <p class="announcement-item-admin">Posted by: ${announcement.admin_first_name} ${announcement.admin_last_name}</p>
            <p class="announcement-item-content">${escapeHtml(announcement.content)}</p>
            <div class="announcement-item-actions">
                <button class="btn-danger" onclick="deleteAnnouncement(${announcement.id})">
                    <i class="fas fa-trash"></i> Remove
                </button>
            </div>
        </div>
    `,
    )
    .join("");
}

// Create new announcement (from dashboard form)
async function createAnnouncement(title, content, priority) {
  try {
    const token =
      localStorage.getItem("session_token") ||
      sessionStorage.getItem("session_token");
    const response = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title, content, priority }),
    });

    if (response.ok) {
      // Reset dashboard form
      const dashboardForm = document.getElementById("createAnnouncementForm");
      if (dashboardForm) {
        dashboardForm.reset();
      }
      // Reset other form if exists
      const otherForm = document.getElementById("announcementForm");
      if (otherForm) {
        otherForm.reset();
      }
      loadAdminAnnouncements();
      alert("Announcement posted successfully!");
    } else {
      const error = await response.json();
      alert("Error: " + error.error);
    }
  } catch (error) {
    console.error("Error creating announcement:", error);
    alert("Failed to create announcement");
  }
}

// Delete announcement
async function deleteAnnouncement(id) {
  if (!confirm("Are you sure you want to remove this announcement?")) {
    return;
  }

  try {
    const token =
      localStorage.getItem("session_token") ||
      sessionStorage.getItem("session_token");
    const response = await fetch(`/api/admin/announcements/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      loadAdminAnnouncements();
      alert("Announcement removed successfully!");
    } else {
      const error = await response.json();
      alert("Error: " + error.error);
    }
  } catch (error) {
    console.error("Error deleting announcement:", error);
    alert("Failed to delete announcement");
  }
}

// Set up announcement form handler
function setupAnnouncementForm() {
  const form = document.getElementById("announcementForm");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const title = document.getElementById("announcementTitle").value.trim();
      const content = document
        .getElementById("announcementContent")
        .value.trim();

      if (title && content) {
        createAnnouncement(title, content);
      }
    });
  }
}

// Utility function to escape HTML
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Utility function to format date
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function filterRecords() {
  const date = document.getElementById("filterDate").value;
  const labRoom = document.getElementById("filterLabRoom").value;

  let url = "/api/admin/records?";
  if (date) url += `date=${date}&`;
  if (labRoom) url += `lab_room=${labRoom}`;

  fetch(url)
    .then((res) => res.json())
    .then((records) => displayRecords(records))
    .catch((err) => console.error("Error filtering records:", err));
}

function clearRecordFilters() {
  document.getElementById("filterDate").value = "";
  document.getElementById("filterLabRoom").value = "";
  loadAllRecords();
}

// =============================================
// User Information Display
// =============================================
function displayUserInfo() {
  // Get user role (default to 'student')
  const userRole = currentUser.role || "student";

  // Show/hide navigation based on role
  const studentNav = document.getElementById("studentNav");
  const adminNav = document.getElementById("adminNav");

  if (userRole === "admin") {
    // Show admin navigation, hide student navigation
    if (studentNav) studentNav.style.display = "none";
    if (adminNav) adminNav.style.display = "flex";

    // Update admin name
    document.getElementById("adminUserName").textContent =
      currentUser.name || "Admin";
  } else {
    // Show student navigation, hide admin navigation
    if (studentNav) studentNav.style.display = "flex";
    if (adminNav) adminNav.style.display = "none";

    // Update student name
    document.getElementById("userName").textContent =
      currentUser.name || "Student";
  }

  // Update student information card
  document.getElementById("infoName").textContent =
    currentUser.name || "Student Name";
  document.getElementById("infoCourse").textContent =
    currentUser.course || "Course";
  document.getElementById("infoYear").textContent = getYearLevel(
    currentUser.course_level,
  );
  document.getElementById("infoAddress").textContent =
    currentUser.address || "Not specified";

  // Update profile picture display
  updateProfilePictureDisplay();

  // Populate edit profile form
  populateEditForm();
}

function updateProfilePictureDisplay() {
  const profilePicture = currentUser.profile_picture;

  // Dashboard student info card
  const displayImg = document.getElementById("profilePictureDisplay");
  const defaultIcon = document.getElementById("defaultAvatarIcon");

  // Edit profile section
  const editImg = document.getElementById("editProfilePicture");
  const editDefaultIcon = document.getElementById("editDefaultAvatar");
  const removeBtn = document.getElementById("removePhotoBtn");

  console.log("Profile picture path:", profilePicture);
  console.log("Current user:", currentUser);

  // Ensure profile picture path has leading slash for absolute path
  let correctPath = profilePicture;
  if (
    profilePicture &&
    !profilePicture.startsWith("/") &&
    !profilePicture.startsWith("http")
  ) {
    correctPath = "/" + profilePicture;
    console.log("Corrected profile picture path:", correctPath);
  }

  if (correctPath) {
    // Show profile picture
    if (displayImg) {
      displayImg.src = correctPath;
      displayImg.style.display = "block";
      // Add error handling
      displayImg.onerror = function () {
        console.error("Failed to load profile picture:", correctPath);
        this.style.display = "none";
        if (defaultIcon) defaultIcon.style.display = "block";
      };
    }
    if (defaultIcon) defaultIcon.style.display = "none";

    if (editImg) {
      editImg.src = correctPath;
      editImg.style.display = "block";
      editImg.onerror = function () {
        console.error("Failed to load edit profile picture:", correctPath);
        this.style.display = "none";
        if (editDefaultIcon) editDefaultIcon.style.display = "block";
      };
    }
    if (editDefaultIcon) editDefaultIcon.style.display = "none";
    if (removeBtn) removeBtn.style.display = "inline-flex";
  } else {
    // Show default icon
    if (displayImg) {
      displayImg.style.display = "none";
      displayImg.src = "";
    }
    if (defaultIcon) defaultIcon.style.display = "block";

    if (editImg) {
      editImg.style.display = "none";
      editImg.src = "";
    }
    if (editDefaultIcon) editDefaultIcon.style.display = "block";
    if (removeBtn) removeBtn.style.display = "none";
  }
}

function getYearLevel(level) {
  const levels = {
    1: "1st Year",
    2: "2nd Year",
    3: "3rd Year",
    4: "4th Year",
  };
  return levels[level] || "Unknown";
}

// =============================================
// Navigation & Section Management
// =============================================
function showSection(sectionName) {
  // Get user role
  const userRole = currentUser.role || "student";

  // Hide all sections
  const sections = document.querySelectorAll(".content-section");
  sections.forEach((section) => section.classList.add("hidden"));

  // Remove active class from all nav links (skip Home link which is index 0)
  const navLinks = document.querySelectorAll(".nav-link");
  navLinks.forEach((link) => link.classList.remove("active"));

  // Show selected section and activate nav link
  switch (sectionName) {
    case "dashboard":
    case "adminDashboard":
      if (userRole === "admin") {
        document
          .getElementById("adminDashboardSection")
          .classList.remove("hidden");
      } else {
        document.getElementById("dashboardSection").classList.remove("hidden");
      }
      activateNavLink(1);
      break;
    case "search":
      if (userRole === "admin") {
        document.getElementById("searchSection").classList.remove("hidden");
        activateAdminNavLink(1);
      }
      break;
    case "student":
      if (userRole === "admin") {
        document
          .getElementById("studentMgmtSection")
          .classList.remove("hidden");
        loadAllStudents(); // Load students when section is shown
        activateAdminNavLink(2);
      }
      break;
    case "sitIn":
      if (userRole === "admin") {
        document.getElementById("sitInSection").classList.remove("hidden");
        activateAdminNavLink(3);
        loadActiveSitins(); // Load active sit-ins when section is shown
      }
      break;
    case "viewRecords":
      if (userRole === "admin") {
        document
          .getElementById("viewRecordsSection")
          .classList.remove("hidden");
        activateAdminNavLink(4);
        loadAllRecords(); // Load records when section is shown
      }
      break;
    case "feedbacks":
      if (userRole === "admin") {
        document.getElementById("feedbacksSection").classList.remove("hidden");
        activateAdminNavLink(5);
        loadFeedbacks(); // Load feedbacks when section is shown
      }
      break;
    case "sitinReports":
      if (userRole === "admin") {
        document
          .getElementById("sitinReportsSection")
          .classList.remove("hidden");
        activateAdminNavLink(6);
        loadSitInReports(); // Load sit-in reports when section is shown
      }
      break;
    case "reservation":
      const reservationSection = document.getElementById("reservationSection");
      reservationSection.classList.remove("hidden");

      if (userRole === "admin") {
        document.getElementById("adminReservationView").style.display = "block";
        document.getElementById("studentReservationView").style.display =
          "none";
        activateAdminNavLink(7);
        switchReservationTab("computerControl"); // Default admin tab
      } else {
        document.getElementById("adminReservationView").style.display = "none";
        document.getElementById("studentReservationView").style.display =
          "block";
        activateNavLink(2);
        loadUserReservations();
      }
      break;
    case "notifications":
      document
        .getElementById("notificationsSection")
        .classList.remove("hidden");
      activateNavLink(3);
      break;
    case "editProfile":
      document.getElementById("editProfileSection").classList.remove("hidden");
      activateNavLink(4);
      break;
    case "history":
      document.getElementById("historySection").classList.remove("hidden");
      activateNavLink(5);
      displayFullHistory();
      break;
  }
}

function activateNavLink(index) {
  const navLinks = document.querySelectorAll(".nav-link");
  if (navLinks[index]) {
    navLinks[index].classList.add("active");
  }
}

function activateAdminNavLink(index) {
  // Get admin nav links (skip Home link which is index 0)
  const adminNavLinks = document.querySelectorAll("#adminNav .nav-link");
  if (adminNavLinks[index]) {
    adminNavLinks[index].classList.add("active");
  }
}

// =============================================
// Sit-in History
// =============================================
async function loadSitInHistory() {
  showLoading(true);

  try {
    const response = await fetch(`/api/sitin/records/user/${currentUser.id}`);

    if (response.ok) {
      const data = await response.json();
      allHistoryData = data.records || data;

      // Update sessions remaining
      updateSessionsRemaining(allHistoryData);
    } else {
      console.error("Failed to load sit-in history");
    }
  } catch (error) {
    console.error("Error loading history:", error);
  }

  showLoading(false);
}

function updateSessionsRemaining(records) {
  if (!records || !records.length) return;

  const totalSitins = records.length;

  // Calculate remaining sessions (assuming 30 max sessions per semester)
  const maxSessions = 30;
  const sessionsRemaining = Math.max(0, maxSessions - totalSitins);

  const sessionsElement = document.getElementById("infoSessionsRemaining");
  if (sessionsElement) {
    sessionsElement.textContent = sessionsRemaining;
  }
}

function displayFullHistory() {
  renderHistoryTable(allHistoryData);
  updateHistoryStats(allHistoryData);
}

function updateHistoryStats(records) {
  const totalSessionsEl = document.getElementById("historyTotalSessions");
  const totalTimeEl = document.getElementById("historyTotalTime");
  const lastSessionEl = document.getElementById("historyLastSession");

  if (!records || records.length === 0) {
    if (totalSessionsEl) totalSessionsEl.textContent = "0";
    if (totalTimeEl) totalTimeEl.textContent = "0h 0m";
    if (lastSessionEl) lastSessionEl.textContent = "None";
    return;
  }

  // Total Sessions
  if (totalSessionsEl) totalSessionsEl.textContent = records.length;

  // Total Time
  let totalMinutes = 0;
  records.forEach((record) => {
    if (record.time_in && record.time_out) {
      const [inH, inM] = record.time_in.split(":").map(Number);
      const [outH, outM] = record.time_out.split(":").map(Number);
      totalMinutes += outH * 60 + outM - (inH * 60 + inM);
    }
  });
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (totalTimeEl) totalTimeEl.textContent = `${hours}h ${mins}m`;

  // Last Session
  const sortedRecords = [...records].sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  );
  if (lastSessionEl)
    lastSessionEl.textContent = formatDateShort(sortedRecords[0].date);
}

function renderHistoryTable(records) {
  const tableBody = document.getElementById("fullHistoryTableBody");
  const emptyState = document.getElementById("noFullHistoryMessage");

  if (!records || records.length === 0) {
    tableBody.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  tableBody.innerHTML = records
    .map((record, index) => {
      const duration = calculateDuration(record.time_in, record.time_out);
      const delay = (index * 0.05).toFixed(2);
      return `
            <tr class="animate__animated animate__fadeInUp" style="animation-delay: ${delay}s">
                <td style="font-weight: 600; color: #5e3b71;">${formatDate(record.date)}</td>
                <td><span class="status-badge" style="background: #f1f5f9; color: #475569;">${record.lab_room || "N/A"}</span></td>
                <td>${record.purpose || "N/A"}</td>
                <td><i class="far fa-clock" style="color: #10b981; margin-right: 5px;"></i> ${formatTime(record.time_in)}</td>
                <td><i class="far fa-clock" style="color: #ef4444; margin-right: 5px;"></i> ${record.time_out ? formatTime(record.time_out) : "-"}</td>
                <td style="font-weight: 700; color: #1e293b;">${duration}</td>
                <td class="action-cell">
                    <button class="btn-action view" onclick="openHistoryFeedbackModal(${record.id}, '${record.date}', '${record.lab_room}')" title="Leave Feedback">
                        <i class="fas fa-comment-medical"></i>
                    </button>
                </td>
            </tr>
        `;
    })
    .join("");
}

function filterHistory() {
  const monthFilter = document.getElementById("filterMonth").value;
  const labFilter = document.getElementById("filterLab").value;

  let filteredData = [...allHistoryData];

  if (monthFilter) {
    filteredData = filteredData.filter((record) => {
      const recordDate = new Date(record.date);
      const recordMonth = recordDate.toISOString().slice(0, 7);
      return recordMonth === monthFilter;
    });
  }

  if (labFilter) {
    filteredData = filteredData.filter(
      (record) => record.lab_room === labFilter,
    );
  }

  renderHistoryTable(filteredData);
  updateHistoryStats(filteredData);
}

function clearFilters() {
  const monthInput = document.getElementById("filterMonth");
  const labSelect = document.getElementById("filterLab");
  if (monthInput) monthInput.value = "";
  if (labSelect) labSelect.value = "";
  displayFullHistory();
}

function formatDateShort(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function exportHistory() {
  if (!allHistoryData || allHistoryData.length === 0) {
    alert("No data to export");
    return;
  }

  // Basic CSV export
  let csv = "Date,Lab Room,Purpose,Time In,Time Out,Duration\n";
  allHistoryData.forEach((r) => {
    csv += `${r.date},"${r.lab_room}","${r.purpose}",${r.time_in},${r.time_out},${calculateDuration(r.time_in, r.time_out)}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.setAttribute("hidden", "");
  a.setAttribute("href", url);
  a.setAttribute(
    "download",
    `SitIn_History_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// =============================================
// Profile Picture Upload
// =============================================
async function handleProfilePictureChange(event) {
  const file = event.target.files[0];

  if (!file) return;

  console.log("Uploading file:", file.name, file.size, file.type);
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    showMessage("Only image files (JPG, PNG, GIF) are allowed!", "error");
    return;
  }

  // Validate file size (5MB max)
  if (file.size > 5 * 1024 * 1024) {
    showMessage("File size must be less than 5MB!", "error");
    return;
  }

  // Show preview immediately
  const reader = new FileReader();
  reader.onload = function (e) {
    const editImg = document.getElementById("editProfilePicture");
    const editDefaultIcon = document.getElementById("editDefaultAvatar");
    const removeBtn = document.getElementById("removePhotoBtn");

    editImg.src = e.target.result;
    editImg.style.display = "block";
    editDefaultIcon.style.display = "none";
    removeBtn.style.display = "inline-flex";
  };
  reader.readAsDataURL(file);

  // Upload to server
  showLoading(true);

  try {
    const formData = new FormData();
    formData.append("profilePicture", file);

    const response = await fetch(
      `/api/user/${currentUser.id}/profile-picture`,
      {
        method: "POST",
        body: formData,
      },
    );

    console.log("Response status:", response.status);

    const data = await response.json();
    console.log("Response data:", data);

    if (response.ok) {
      // Update current user data
      currentUser.profile_picture = data.profile_picture;
      localStorage.setItem("user", JSON.stringify(currentUser));

      console.log("Profile picture updated to:", data.profile_picture);

      // Update all profile picture displays
      updateProfilePictureDisplay();

      showMessage("Profile picture updated successfully!", "success");
    } else {
      showMessage(data.error || "Failed to upload profile picture", "error");
      // Revert preview on error
      updateProfilePictureDisplay();
    }
  } catch (error) {
    console.error("Error uploading profile picture:", error);
    showMessage("An error occurred while uploading", "error");
    // Revert preview on error
    updateProfilePictureDisplay();
  }

  showLoading(false);

  // Clear the input so the same file can be selected again
  event.target.value = "";
}

async function removeProfilePicture() {
  if (!confirm("Are you sure you want to remove your profile picture?")) {
    return;
  }

  showLoading(true);

  try {
    // Update user with null profile picture
    const response = await fetch(`/api/user/${currentUser.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        first_name: currentUser.first_name,
        last_name: currentUser.last_name,
        middle_name: currentUser.middle_name,
        email: currentUser.email,
        course: currentUser.course,
        course_level: currentUser.course_level,
        address: currentUser.address,
        remove_profile_picture: true,
      }),
    });

    if (response.ok) {
      currentUser.profile_picture = null;
      localStorage.setItem("user", JSON.stringify(currentUser));
      updateProfilePictureDisplay();
      showMessage("Profile picture removed successfully!", "success");
    } else {
      const data = await response.json();
      showMessage(data.error || "Failed to remove profile picture", "error");
    }
  } catch (error) {
    console.error("Error removing profile picture:", error);
    showMessage("An error occurred", "error");
  }

  showLoading(false);
}

// =============================================
// Admin Sit-in Management
// =============================================
async function loadActiveSitins() {
  try {
    const response = await fetch("/api/admin/active-sitins");
    if (response.ok) {
      const records = await response.json();
      displayActiveSitins(records);

      const countBadge = document.getElementById("activeSitinsCount");
      if (countBadge) countBadge.textContent = records.length || 0;

      const dashboardActiveDisp = document.getElementById("activeSitins");
      if (dashboardActiveDisp)
        dashboardActiveDisp.textContent = records.length || 0;
    }
  } catch (error) {
    console.error("Error loading active sit-ins:", error);
  }
}

function displayActiveSitins(records) {
  const grid = document.getElementById("activeSitinsGrid");
  if (!grid) return;

  if (!records || records.length === 0) {
    grid.innerHTML = `
            <div class="empty-monitor">
                <i class="fas fa-desktop"></i>
                <p>No active sessions. All labs are currently available.</p>
            </div>
        `;
    return;
  }

  grid.innerHTML = records
    .map((record, index) => {
      const delay = (index * 0.05).toFixed(2);
      const initial = record.first_name
        ? record.first_name.charAt(0).toUpperCase()
        : "?";

      return `
            <div class="active-monitor-card animate__animated animate__fadeInUp" style="animation-delay: ${delay}s">
                <div class="monitor-card-header">
                    <div class="student-profile">
                        <div class="monitor-avatar">${initial}</div>
                        <div class="monitor-info">
                            <h4>${escapeHtml(record.first_name)} ${escapeHtml(record.last_name)}</h4>
                            <span>ID: ${escapeHtml(record.id_number)}</span>
                        </div>
                    </div>
                    <div class="lab-indicator">
                        <span class="lab-tag">${escapeHtml(record.lab_room)}</span>
                    </div>
                </div>
                
                <div class="monitor-card-body">
                    <div class="monitor-detail">
                        <i class="fas fa-bookmark"></i>
                        <div class="detail-text">
                            <label>Purpose</label>
                            <p>${escapeHtml(record.purpose)}</p>
                        </div>
                    </div>
                    <div class="monitor-detail">
                        <i class="far fa-clock"></i>
                        <div class="detail-text">
                            <label>Time Started</label>
                            <p>${formatTime(record.time_in)}</p>
                        </div>
                    </div>
                </div>
                
                <div class="monitor-card-footer">
                    <div class="session-stat">
                        <i class="fas fa-hourglass-start"></i>
                        <span>${record.remaining_sessions || 0} left</span>
                    </div>
                    <button class="btn-checkout" onclick="handleAdminCheckout(${record.id})">
                        <i class="fas fa-sign-out-alt"></i> End Session
                    </button>
                </div>
            </div>
        `;
    })
    .join("");
}

async function handleAdminCheckout(recordId) {
  if (!confirm("Are you sure you want to log out this student?")) return;

  showLoading(true);
  try {
    const response = await fetch("/api/sitin/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ record_id: recordId }),
    });

    if (response.ok) {
      showSuccessModal(
        "Checkout Successful",
        "Student has been logged out successfully.",
      );
      loadActiveSitins(); // Refresh current list
      loadAllRecords(); // Refresh history list
      loadAdminStats(); // Update dashboard stats
      loadAllStudents(); // Refresh student management list for session count
    } else {
      const error = await response.json();
      showErrorModal(
        "Checkout Failed",
        error.error || "Failed to check out student",
      );
    }
  } catch (error) {
    console.error("Error during admin checkout:", error);
    showErrorModal("Error", "An error occurred during checkout");
  }
  showLoading(false);
}

// =============================================
// Feedbacks Logic Redesigned
// =============================================
// Functions consolidated at the top (lines 301-336)

// =============================================
// Reservations
// =============================================

// Switch between admin reservation tabs
function switchReservationTab(tabName) {
  // Hide all tab content
  const contents = document.querySelectorAll(".tab-content");
  contents.forEach((c) => c.classList.add("hidden"));

  // Deactivate all tab buttons
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((b) => b.classList.remove("active"));

  // Show selected tab
  document.getElementById(tabName + "Tab").classList.remove("hidden");

  // Find and activate the correct button
  buttons.forEach((b) => {
    if (b.getAttribute("onclick").includes(tabName)) {
      b.classList.add("active");
    }
  });

  // Load data for the tab
  if (tabName === "computerControl") loadComputerStatus();
  if (tabName === "requests") loadAdminReservations("pending");
  if (tabName === "logs") loadAdminReservations();
}

async function loadComputerStatus() {
  try {
    const response = await fetch("/api/admin/computer-status");
    if (response.ok) {
      const labs = await response.json();
      displayComputerStatus(labs);

      // Calculate overall capacity
      let totalAvailable = 0;
      let totalCapacity = 0;
      labs.forEach((lab) => {
        totalAvailable += lab.available_pcs;
        totalCapacity += lab.total_pcs;
      });

      const capacityPercent =
        totalCapacity > 0
          ? Math.round(((totalCapacity - totalAvailable) / totalCapacity) * 100)
          : 0;
      const capEl = document.getElementById("resOverallCapacity");
      if (capEl) capEl.textContent = `${capacityPercent}%`;
    }
  } catch (error) {
    console.error("Error loading computer status:", error);
  }
}

function displayComputerStatus(labs) {
  const grid = document.getElementById("labStatusGrid");
  if (!grid) return;

  grid.innerHTML = labs
    .map((lab, index) => {
      const delay = (index * 0.05).toFixed(2);
      const percent = Math.round((lab.available_pcs / lab.total_pcs) * 100);
      const statusClass =
        percent > 50 ? "available" : percent > 10 ? "warning" : "full";

      return `
            <div class="lab-health-card animate__animated animate__fadeInUp" style="animation-delay: ${delay}s">
                <div class="lab-card-header">
                    <div class="lab-title">
                        <h4>${escapeHtml(lab.lab_name)}</h4>
                        <span class="room-tag">${lab.lab_name.includes("524") ? "Rm 1" : "Rm " + (index + 1)}</span>
                    </div>
                    <div class="status-dot ${statusClass}"></div>
                </div>
                
                <div class="lab-card-body">
                    <div class="pc-visualization">
                        <div class="pc-icon-grid">
                            ${Array(12)
          .fill(0)
          .map(
            (_, i) =>
              `<i class="fas fa-desktop pc-dot ${i < 12 - Math.round((lab.available_pcs / lab.total_pcs) * 12) ? "busy" : ""}"></i>`,
          )
          .join("")}
                        </div>
                        <div class="usage-stats">
                            <span class="percent">${100 - percent}%</span>
                            <p>Used</p>
                        </div>
                    </div>
                    
                    <div class="stats-row">
                        <div class="mini-stat">
                            <label>Available</label>
                            <span>${lab.available_pcs} PC</span>
                        </div>
                        <div class="mini-stat">
                            <label>Active Sit-ins</label>
                            <span>${lab.active_sitins}</span>
                        </div>
                    </div>
                    
                    <div class="health-progress">
                        <div class="progress-fill ${statusClass}" style="width: ${percent}%"></div>
                    </div>
                </div>
                
                <div class="lab-card-footer">
                    <span>Capacity: ${lab.total_pcs} Seats</span>
                    <button class="btn-view-lab" onclick="viewLabDetails('${lab.lab_name}')">
                        <i class="fas fa-external-link-alt"></i>
                    </button>
                </div>
            </div>
        `;
    })
    .join("");
}

async function loadUserReservations() {
  try {
    const response = await fetch(`/api/reservations/user/${currentUser.id}`);
    if (response.ok) {
      const reservations = await response.json();
      // Could display these in a table or list for students
      console.log("User reservations:", reservations);
    }
  } catch (error) {
    console.error("Error loading user reservations:", error);
  }
}

async function loadAdminReservations(filterStatus = null) {
  try {
    const response = await fetch("/api/admin/reservations");
    if (response.ok) {
      let reservations = await response.json();

      // Calculate overall reservations stats
      const pendingCount = reservations.filter(
        (r) => r.status === "pending",
      ).length;
      const confirmedToday = reservations.filter(
        (r) =>
          r.status === "approved" &&
          formatDate(r.date) === formatDate(new Date().toISOString()),
      ).length;

      const pendingEl = document.getElementById("resPendingCount");
      if (pendingEl) pendingEl.textContent = pendingCount;

      const confirmedEl = document.getElementById("resConfirmedToday");
      if (confirmedEl) confirmedEl.textContent = confirmedToday;

      if (filterStatus) {
        reservations = reservations.filter((r) => r.status === filterStatus);
        displayReservationRequests(reservations);
      } else {
        displayReservationLogs(reservations);
      }
    }
  } catch (error) {
    console.error("Error loading admin reservations:", error);
  }
}

function displayReservationRequests(requests) {
  const grid = document.getElementById("reservationRequestsGrid");
  if (!grid) return;

  if (!requests || requests.length === 0) {
    grid.innerHTML = `
            <div class="empty-monitor">
                <i class="fas fa-inbox"></i>
                <p>All requests processed! Your inbox is clear.</p>
            </div>
        `;
    return;
  }

  grid.innerHTML = requests
    .map((r, index) => {
      const delay = (index * 0.05).toFixed(2);
      const initial = r.first_name ? r.first_name.charAt(0).toUpperCase() : "?";

      return `
            <div class="admin-res-card animate__animated animate__fadeInUp" style="animation-delay: ${delay}s">
                <div class="res-card-header">
                    <div class="student-brief">
                        <div class="res-avatar">${initial}</div>
                        <div class="res-user-info">
                            <h4>${escapeHtml(r.first_name)} ${escapeHtml(r.last_name)}</h4>
                            <span>ID: ${escapeHtml(r.id_number)}</span>
                        </div>
                    </div>
                </div>
                
                <div class="res-card-body">
                    <div class="res-detail">
                        <i class="fas fa-door-open"></i>
                        <p><strong>${escapeHtml(r.lab_room)}</strong></p>
                    </div>
                    <div class="res-detail">
                        <i class="far fa-calendar-alt"></i>
                        <p>${formatDate(r.date)} at ${formatTime(r.time)}</p>
                    </div>
                    <div class="res-detail purpose">
                        <i class="fas fa-quote-left"></i>
                        <p>${escapeHtml(r.purpose)}</p>
                    </div>
                </div>
                
                <div class="res-card-footer">
                    <button class="btn-res-deny" onclick="updateReservationStatus(${r.id}, 'denied')">
                        <i class="fas fa-times"></i> Deny
                    </button>
                    <button class="btn-res-approve" onclick="updateReservationStatus(${r.id}, 'approved')">
                        <i class="fas fa-check"></i> Approve
                    </button>
                </div>
            </div>
        `;
    })
    .join("");
}

function displayReservationLogs(logs) {
  const tbody = document.getElementById("reservationLogsTableBody");
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No reservation logs found</td></tr>';
    return;
  }

  tbody.innerHTML = logs
    .map((l, index) => {
      const delay = (index * 0.02).toFixed(2);
      return `
            <tr class="animate__animated animate__fadeIn" style="animation-delay: ${delay}s">
                <td><span class="date-chip">${formatDate(l.date)}</span></td>
                <td><span class="time-text">${formatTime(l.time)}</span></td>
                <td>
                    <div class="user-info-cell">
                        <div class="avatar-mini">${l.first_name.charAt(0)}</div>
                        <span class="full-name">${l.first_name} ${l.last_name}</span>
                    </div>
                </td>
                <td><span class="lab-badge">${l.lab_room}</span></td>
                <td><span class="status-badge ${l.status}">${l.status}</span></td>
            </tr>
        `;
    })
    .join("");
}

async function updateReservationStatus(id, status) {
  try {
    const response = await fetch(`/api/admin/reservations/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (response.ok) {
      showSuccessModal("Success", `Reservation ${status} successfully.`);
      switchReservationTab(
        status === "approved" || status === "denied" ? "requests" : "logs",
      );
    }
  } catch (error) {
    console.error("Error updating reservation status:", error);
  }
}

// =============================================
// Notifications
// =============================================
async function loadNotifications() {
  try {
    const response = await fetch(`/api/notifications/${currentUser.id}`);

    if (response.ok) {
      notifications = await response.json();
      displayNotificationCount();
      displayNotificationList();
    } else {
      // Load mock notifications
      loadMockNotifications();
    }
  } catch (error) {
    console.error("Error loading notifications:", error);
    loadMockNotifications();
  }
}

function loadMockNotifications() {
  notifications = [
    {
      id: 1,
      title: "Welcome to CCS Sit-in System",
      message:
        "Thank you for registering! You can now use the laboratory sit-in services.",
      time: "2026-03-15 08:00:00",
      read: false,
    },
    {
      id: 2,
      title: "Lab Schedule Update",
      message: "Lab 3 will be closed for maintenance on March 20, 2026.",
      time: "2026-03-14 10:30:00",
      read: false,
    },
    {
      id: 3,
      title: "Sit-in Reminder",
      message: "You have an active sit-in session in Lab 2.",
      time: "2026-03-13 09:00:00",
      read: true,
    },
  ];

  displayNotificationCount();
  displayNotificationList();
}

function displayNotificationCount() {
  const unreadCount = notifications.filter((n) => !n.read).length;
  const countElement = document.getElementById("notificationCount");
  countElement.textContent = unreadCount;
  countElement.setAttribute("data-count", unreadCount);
}

function displayNotificationList() {
  const listElement = document.getElementById("notificationList");

  if (notifications.length === 0) {
    listElement.innerHTML = '<p class="no-notifications">No notifications</p>';
    return;
  }

  // Show only 5 most recent notifications
  const recentNotifications = notifications.slice(0, 5);

  listElement.innerHTML = recentNotifications
    .map(
      (notification) => `
        <div class="notification-item ${notification.read ? "" : "unread"}" 
             onclick="markAsRead(${notification.id})">
            <h4>${notification.title}</h4>
            <p>${notification.message}</p>
            <span class="time">${formatDateTime(notification.time)}</span>
        </div>
    `,
    )
    .join("");
}

function displayAllNotifications() {
  const listElement = document.getElementById("notificationsListFull");

  if (notifications.length === 0) {
    listElement.innerHTML = '<p class="no-notifications">No notifications</p>';
    return;
  }

  listElement.innerHTML = notifications
    .map(
      (notification) => `
        <div class="notification-item-full ${notification.read ? "" : "unread"}"
             onclick="markAsRead(${notification.id})">
            <h4>${notification.title}</h4>
            <p>${notification.message}</p>
            <span class="time">${formatDateTime(notification.time)}</span>
        </div>
    `,
    )
    .join("");
}

function toggleNotifications() {
  const panel = document.getElementById("notificationPanel");
  panel.classList.toggle("show");
}

function markAsRead(notificationId) {
  const notification = notifications.find((n) => n.id === notificationId);
  if (notification) {
    notification.read = true;
    displayNotificationCount();
    displayNotificationList();

    // Update on server
    updateNotificationOnServer(notificationId);
  }
}

async function updateNotificationOnServer(notificationId) {
  try {
    await fetch(`/api/notifications/${notificationId}/read`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error updating notification:", error);
  }
}

function markAllRead() {
  notifications.forEach((n) => (n.read = true));
  displayNotificationCount();
  displayNotificationList();
  displayAllNotifications();
}

function clearAllNotifications() {
  if (confirm("Are you sure you want to clear all notifications?")) {
    notifications = [];
    displayNotificationCount();
    displayNotificationList();
    displayAllNotifications();
  }
}

// =============================================
// Announcements
// =============================================
async function loadAnnouncements() {
  try {
    const response = await fetch("/api/announcements");

    if (response.ok) {
      const announcements = await response.json();
      displayAnnouncements(announcements);
    } else {
      // Load mock announcements
      loadMockAnnouncements();
    }
  } catch (error) {
    console.error("Error loading announcements:", error);
    loadMockAnnouncements();
  }
}

function loadMockAnnouncements() {
  const announcements = [
    {
      id: 1,
      title: "Laboratory Schedule Update",
      message:
        "Lab 3 will be closed for maintenance on March 20-21, 2026. Please use other laboratories during this period.",
      date: "2026-03-15",
    },
    {
      id: 2,
      title: "New Software Installed",
      message:
        "Visual Studio Code and Node.js have been updated to the latest versions in all laboratories.",
      date: "2026-03-14",
    },
    {
      id: 3,
      title: "Extended Laboratory Hours",
      message:
        "Starting next week, laboratories will be open until 8:00 PM on weekdays to accommodate more students.",
      date: "2026-03-12",
    },
    {
      id: 4,
      title: "Sit-in Monitoring System Launch",
      message:
        "Welcome to the new CCS Sit-in Monitoring System! Please report any issues to the laboratory supervisor.",
      date: "2026-03-10",
    },
  ];

  displayAnnouncements(announcements);
}

function displayAnnouncements(announcements) {
  const listElement = document.getElementById("announcementList");
  const adminListElement = document.getElementById("adminAnnouncementList");

  if (!announcements || announcements.length === 0) {
    if (listElement)
      listElement.innerHTML =
        '<p class="no-data-message">No announcements available.</p>';
    if (adminListElement)
      adminListElement.innerHTML =
        '<p class="no-data-message">No announcements available.</p>';
    return;
  }

  const html = announcements
    .map(
      (announcement) => `
        <div class="announcement-item priority-${announcement.priority || "normal"}">
            <div class="announcement-header">
                <h4>${escapeHtml(announcement.title)}</h4>
                <span class="priority-badge ${announcement.priority || "normal"}">${(announcement.priority || "normal").toUpperCase()}</span>
            </div>
            <p>${escapeHtml(announcement.content)}</p>
            <div class="announcement-footer">
                <span class="announcement-author"><i class="fas fa-user-shield"></i> ${announcement.admin_first_name} ${announcement.admin_last_name}</span>
                <span class="announcement-date"><i class="far fa-calendar-alt"></i> ${formatDate(announcement.created_at)}</span>
            </div>
        </div>
    `,
    )
    .join("");

  if (listElement) listElement.innerHTML = html;
  if (adminListElement) adminListElement.innerHTML = html;
}

// =============================================
// Edit Profile
// =============================================
function populateEditForm() {
  document.getElementById("editFirstName").value = currentUser.first_name || "";
  document.getElementById("editLastName").value = currentUser.last_name || "";
  document.getElementById("editMiddleName").value =
    currentUser.middle_name || "";
  document.getElementById("editEmail").value = currentUser.email || "";
  document.getElementById("editCourse").value = currentUser.course || "";
  document.getElementById("editCourseLevel").value =
    currentUser.course_level || "";
  document.getElementById("editAddress").value = currentUser.address || "";
}

async function handleEditProfile(event) {
  event.preventDefault();

  const formData = {
    first_name: document.getElementById("editFirstName").value,
    last_name: document.getElementById("editLastName").value,
    middle_name: document.getElementById("editMiddleName").value,
    email: document.getElementById("editEmail").value,
    course: document.getElementById("editCourse").value,
    course_level: parseInt(document.getElementById("editCourseLevel").value),
    address: document.getElementById("editAddress").value,
    current_password: document.getElementById("currentPassword").value,
    new_password: document.getElementById("newPassword").value,
  };

  showLoading(true);

  try {
    const response = await fetch(`/api/user/${currentUser.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formData),
    });

    const data = await response.json();

    if (response.ok) {
      // Update local storage
      currentUser.first_name = formData.first_name;
      currentUser.last_name = formData.last_name;
      currentUser.name = `${formData.first_name} ${formData.last_name}`;
      currentUser.email = formData.email;
      currentUser.course = formData.course;
      currentUser.course_level = formData.course_level;

      localStorage.setItem("user", JSON.stringify(currentUser));

      // Update display
      displayUserInfo();

      showMessage("Profile updated successfully!", "success");

      // Clear password fields
      document.getElementById("currentPassword").value = "";
      document.getElementById("newPassword").value = "";
    } else {
      showMessage(data.error || "Failed to update profile", "error");
    }
  } catch (error) {
    console.error("Error updating profile:", error);
    showMessage("An error occurred. Please try again.", "error");
  }

  showLoading(false);
}

function resetForm() {
  populateEditForm();
  document.getElementById("currentPassword").value = "";
  document.getElementById("newPassword").value = "";
  document.getElementById("profileMessage").className = "message-container";
  document.getElementById("profileMessage").textContent = "";
}

function showMessage(message, type) {
  const messageDiv = document.getElementById("profileMessage");
  messageDiv.textContent = message;
  messageDiv.className = `message-container ${type}`;

  // Auto-hide after 5 seconds
  setTimeout(() => {
    messageDiv.className = "message-container";
    messageDiv.textContent = "";
  }, 5000);
}

// =============================================
// Logout
// =============================================
async function handleLogout() {
  if (!confirm("Are you sure you want to logout?")) {
    return;
  }

  showLoading(true);

  try {
    const response = await fetch("/api/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session_token: sessionToken }),
    });

    if (response.ok) {
      // Clear session token from local storage
      localStorage.removeItem("session_token");

      // Redirect to login page
      window.location.href = "login.html";
    } else {
      console.error("Logout failed on server");
      // Still clear and redirect
      localStorage.removeItem("session_token");
      window.location.href = "login.html";
    }
  } catch (error) {
    console.error("Error during logout:", error);
    // Clear and redirect anyway
    localStorage.removeItem("session_token");
    window.location.href = "login.html";
  }

  showLoading(false);
}

// =============================================
// Event Listeners Setup
// =============================================
function setupEventListeners() {
  // Edit profile form submission
  const editForm = document.getElementById("editProfileForm");
  if (editForm) {
    editForm.addEventListener("submit", handleEditProfile);
  }

  // Admin sit-in form submission
  const adminSitInForm = document.getElementById("adminSitInForm");
  if (adminSitInForm) {
    // Add listener to student ID to enable session editing when manually changed
    const studentIdInput = document.getElementById("studentIdNumber");
    if (studentIdInput) {
      studentIdInput.addEventListener("input", function () {
        document.getElementById("studentSession").readOnly = false;
        document.getElementById("studentName").value = "";
        document.getElementById("studentSession").value = "";
      });
    }

    adminSitInForm.addEventListener("submit", async function (e) {
      e.preventDefault();

      const studentIdNumber = document
        .getElementById("studentIdNumber")
        .value.trim();
      const studentName = document.getElementById("studentName").value.trim();
      const studentSession = document
        .getElementById("studentSession")
        .value.trim();
      const labRoom = document.getElementById("labRoom").value;
      const purpose = document.getElementById("sitInPurpose").value;

      if (!studentIdNumber || !labRoom || !purpose) {
        showErrorModal("Missing Fields", "Please fill in all fields");
        return;
      }

      // First, get the student by ID number
      try {
        const searchResponse = await fetch(
          `/api/admin/student/${encodeURIComponent(studentIdNumber)}`,
        );

        let student;
        if (searchResponse.ok) {
          student = await searchResponse.json();
        }

        // If student exists, update their remaining sessions if changed
        if (student) {
          const newSessions = parseInt(studentSession, 10);
          const currentSessions = student.remaining_sessions || 0;

          // Only update if sessions have changed
          if (
            !isNaN(newSessions) &&
            newSessions >= 0 &&
            newSessions !== currentSessions
          ) {
            await fetch(`/api/admin/students/${student.id}/sessions`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ remaining_sessions: newSessions }),
            });
          }
        }

        if (!searchResponse.ok) {
          showErrorModal(
            "Student Not Found",
            "Please search for the student first.",
          );
          return;
        }

        // Now create the sit-in record
        const checkInResponse = await fetch("/api/sitin/checkin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: student.id,
            lab_room: labRoom,
            purpose: purpose,
          }),
        });

        if (checkInResponse.ok) {
          const result = await checkInResponse.json();
          showCheckInSuccessModal(student, labRoom, purpose);

          // Switch to Sit-in Management section to see the new record
          showSection("sitIn");

          // Refresh active sit-in records table
          loadActiveSitins();

          // Also refresh all records table if needed
          loadAllRecords();

          // Close modal and reset form
          closeSitInModal();
        } else {
          const error = await checkInResponse.json();
          showErrorModal(
            "Check-in Failed",
            error.error || "Unable to check in student",
          );
        }
      } catch (error) {
        console.error("Error during check-in:", error);
        showErrorModal("Check-in Error", "An error occurred during check-in");
      }
    });
  }

  // Dashboard announcement form submission
  const createAnnouncementForm = document.getElementById(
    "createAnnouncementForm",
  );
  if (createAnnouncementForm) {
    createAnnouncementForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const title = document.getElementById("announcementTitle").value.trim();
      const content = document
        .getElementById("announcementContent")
        .value.trim();
      const priority = document.getElementById("announcementPriority").value;

      if (title && content) {
        createAnnouncement(title, content, priority);
      }
    });
  }

  // Student Reservation form submission
  const resForm = document.getElementById("reservationForm");
  if (resForm) {
    resForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const formData = {
        user_id: currentUser.id,
        lab_room: document.getElementById("resLabRoom").value,
        date: document.getElementById("resDate").value,
        time: document.getElementById("resTime").value,
        purpose: document.getElementById("resPurpose").value,
      };

      try {
        const response = await fetch("/api/reservations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (response.ok) {
          showSuccessModal("Success", "Reservation request submitted!");
          resForm.reset();
        }
      } catch (error) {
        console.error("Error submitting reservation:", error);
      }
    });
  }

  // Close notification panel when clicking outside
  document.addEventListener("click", function (event) {
    const panel = document.getElementById("notificationPanel");
    const bell = document.querySelector(".notification-bell");

    if (!panel.contains(event.target) && !bell.contains(event.target)) {
      panel.classList.remove("show");
    }
  });
}

// =============================================
// Sit-in Reports Functions
// =============================================
async function loadSitInReports() {
  const dateFrom = document.getElementById("reportDateFrom").value;
  const dateTo = document.getElementById("reportDateTo").value;
  const labRoom = document.getElementById("reportLabRoom").value;
  const course = document.getElementById("reportCourse").value;

  const params = new URLSearchParams();
  if (dateFrom) params.append("dateFrom", dateFrom);
  if (dateTo) params.append("dateTo", dateTo);
  if (labRoom) params.append("labRoom", labRoom);
  if (course) params.append("course", course);

  try {
    const response = await fetch(`/api/admin/sitin-reports?${params}`);
    if (response.ok) {
      const records = await response.json();
      displaySitInReports(records);
    }
  } catch (error) {
    console.error("Error loading sit-in reports:", error);
  }
}

function displaySitInReports(records) {
  if (!records || records.length === 0) {
    // Reset all stats
    document.getElementById("reportTotalSitins").textContent = "0";
    document.getElementById("reportAvgDuration").textContent = "0h 0m";
    document.getElementById("reportTotalHours").textContent = "0h 0m";
    document.getElementById("reportTopLab").textContent = "N/A";
    document.getElementById("reportUniqueStudents").textContent = "0";

    // Show empty states
    document.getElementById("labUsageChart").innerHTML = `
            <div class="empty-chart">
                <i class="fas fa-chart-bar"></i>
                <p>No data available for selected filters</p>
            </div>
        `;
    document.getElementById("purposeChart").innerHTML = `
            <div class="empty-chart">
                <i class="fas fa-chart-pie"></i>
                <p>No data available for selected filters</p>
            </div>
        `;
    document.getElementById("dailyTrendsChart").innerHTML = `
            <div class="empty-chart">
                <i class="fas fa-chart-line"></i>
                <p>No data available for selected filters</p>
            </div>
        `;
    document.getElementById("topStudentsTableBody").innerHTML = `
            <tr><td colspan="6" class="no-data">No data available</td></tr>
        `;
    return;
  }

  // Calculate statistics
  let totalMinutes = 0;
  let completedRecords = 0;
  const labCounts = {};
  const purposeCounts = {};
  const studentStats = {};
  const dailyCounts = {};
  const uniqueStudents = new Set();

  records.forEach((r) => {
    uniqueStudents.add(r.id_number);

    if (r.time_out) {
      const [inH, inM] = r.time_in.split(":").map(Number);
      const [outH, outM] = r.time_out.split(":").map(Number);
      const diff = outH * 60 + outM - (inH * 60 + inM);
      if (diff > 0) {
        totalMinutes += diff;
        completedRecords++;
      }
    }

    labCounts[r.lab_room] = (labCounts[r.lab_room] || 0) + 1;
    purposeCounts[r.purpose || "Other"] =
      (purposeCounts[r.purpose || "Other"] || 0) + 1;

    // Daily counts
    if (r.date) {
      dailyCounts[r.date] = (dailyCounts[r.date] || 0) + 1;
    }

    // Student stats
    const studentKey = r.id_number;
    if (!studentStats[studentKey]) {
      studentStats[studentKey] = {
        name: `${r.first_name} ${r.last_name}`,
        course: r.course,
        sessions: 0,
        minutes: 0,
      };
    }
    studentStats[studentKey].sessions++;
    if (r.time_out) {
      const [inH, inM] = r.time_in.split(":").map(Number);
      const [outH, outM] = r.time_out.split(":").map(Number);
      const diff = outH * 60 + outM - (inH * 60 + inM);
      if (diff > 0) {
        studentStats[studentKey].minutes += diff;
      }
    }
  });

  // Update summary stats
  document.getElementById("reportTotalSitins").textContent = records.length;

  const avgMinutes =
    completedRecords > 0 ? Math.round(totalMinutes / completedRecords) : 0;
  const totalHours = Math.floor(totalMinutes / 60);
  const totalMins = totalMinutes % 60;
  const avgHrs = Math.floor(avgMinutes / 60);
  const avgMins = avgMinutes % 60;

  document.getElementById("reportAvgDuration").textContent =
    `${avgHrs}h ${avgMins}m`;
  document.getElementById("reportTotalHours").textContent =
    `${totalHours}h ${totalMins}m`;
  document.getElementById("reportUniqueStudents").textContent =
    uniqueStudents.size;

  // Find top lab
  let topLab = "N/A";
  let maxCount = 0;
  for (const lab in labCounts) {
    if (labCounts[lab] > maxCount) {
      maxCount = labCounts[lab];
      topLab = lab;
    }
  }
  document.getElementById("reportTopLab").textContent = topLab;

  // Render charts
  renderLabUsageChart(labCounts);
  renderPurposeChart(purposeCounts);
  renderDailyTrendsChart(dailyCounts);
  renderTopStudentsTable(studentStats);
}

function renderLabUsageChart(labCounts) {
  const container = document.getElementById("labUsageChart");
  const entries = Object.entries(labCounts).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    container.innerHTML = `
            <div class="empty-chart">
                <i class="fas fa-chart-bar"></i>
                <p>No lab data available</p>
            </div>
        `;
    return;
  }

  const maxCount = Math.max(...entries.map((e) => e[1]), 1);

  const colors = [
    "#3b82f6",
    "#10b981",
    "#8b5cf6",
    "#f59e0b",
    "#ef4444",
    "#06b6d4",
  ];

  container.innerHTML = `
        <div class="bar-chart-container">
            ${entries
      .map(
        ([lab, count], index) => `
                <div class="bar-chart-item">
                    <span class="bar-label">${lab}</span>
                    <div class="bar-wrapper">
                        <div class="bar-fill" style="width: ${(count / maxCount) * 100}%; background: ${colors[index % colors.length]}">
                            <span class="bar-value">${count}</span>
                        </div>
                    </div>
                </div>
            `,
      )
      .join("")}
        </div>
    `;
}

function renderPurposeChart(purposeCounts) {
  const container = document.getElementById("purposeChart");
  const entries = Object.entries(purposeCounts).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    container.innerHTML = `
            <div class="empty-chart">
                <i class="fas fa-chart-pie"></i>
                <p>No purpose data available</p>
            </div>
        `;
    return;
  }

  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const colors = [
    "#3b82f6",
    "#10b981",
    "#8b5cf6",
    "#f59e0b",
    "#ef4444",
    "#06b6d4",
  ];

  container.innerHTML = `
        <div class="purpose-chart-container">
            ${entries
      .map(
        ([purpose, count], index) => `
                <div class="purpose-item">
                    <div class="purpose-color" style="background: ${colors[index % colors.length]}"></div>
                    <span class="purpose-label">${purpose}</span>
                    <span class="purpose-count">${count}</span>
                    <span class="purpose-percent">${Math.round((count / total) * 100)}%</span>
                </div>
            `,
      )
      .join("")}
        </div>
    `;
}

function renderDailyTrendsChart(dailyCounts) {
  const container = document.getElementById("dailyTrendsChart");
  const entries = Object.entries(dailyCounts).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  if (entries.length === 0) {
    container.innerHTML = `
            <div class="empty-chart">
                <i class="fas fa-chart-line"></i>
                <p>No daily data available</p>
            </div>
        `;
    return;
  }

  const maxCount = Math.max(...entries.map((e) => e[1]), 1);

  container.innerHTML = `
        <div class="daily-trends-container">
            ${entries
      .map(([date, count]) => {
        const d = new Date(date);
        const formatted = d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return `
                    <div class="daily-bar-item">
                        <span class="daily-bar-value">${count}</span>
                        <div class="daily-bar-wrapper">
                            <div class="daily-bar-fill" style="height: ${(count / maxCount) * 100}%"></div>
                        </div>
                        <span class="daily-bar-label">${formatted}</span>
                    </div>
                `;
      })
      .join("")}
        </div>
    `;
}

function renderTopStudentsTable(studentStats) {
  const tbody = document.getElementById("topStudentsTableBody");
  const sorted = Object.entries(studentStats)
    .sort((a, b) => b[1].sessions - a[1].sessions)
    .slice(0, 10);

  if (sorted.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="no-data">No data available</td></tr>';
    document.getElementById("topStudentsCount").textContent = "No students";
    return;
  }

  document.getElementById("topStudentsCount").textContent =
    `Showing top ${sorted.length}`;

  const rankBadges = ["🥇", "🥈", "🥉"];

  tbody.innerHTML = sorted
    .map(([id, stats], index) => {
      const hours = Math.floor(stats.minutes / 60);
      const mins = stats.minutes % 60;
      const avgMins =
        stats.sessions > 0 ? Math.round(stats.minutes / stats.sessions) : 0;
      const avgHrs = Math.floor(avgMins / 60);
      const avgRem = avgMins % 60;

      return `
            <tr>
                <td><span class="rank-badge ${index < 3 ? "top" : ""}">${index < 3 ? rankBadges[index] : index + 1}</span></td>
                <td class="student-name">${stats.name}</td>
                <td><span class="course-badge">${stats.course}</span></td>
                <td>${stats.sessions}</td>
                <td>${hours}h ${mins}m</td>
                <td>${avgHrs}h ${avgRem}m</td>
            </tr>
        `;
    })
    .join("");
}

function clearReportFilters() {
  document.getElementById("reportDateFrom").value = "";
  document.getElementById("reportDateTo").value = "";
  document.getElementById("reportLabRoom").value = "";
  document.getElementById("reportCourse").value = "";
  loadSitInReports();
}

function exportSitInReportCSV() {
  const dateFrom = document.getElementById("reportDateFrom").value;
  const dateTo = document.getElementById("reportDateTo").value;
  const labRoom = document.getElementById("reportLabRoom").value;
  const course = document.getElementById("reportCourse").value;

  const params = new URLSearchParams();
  if (dateFrom) params.append("dateFrom", dateFrom);
  if (dateTo) params.append("dateTo", dateTo);
  if (labRoom) params.append("labRoom", labRoom);
  if (course) params.append("course", course);

  fetch(`/api/admin/sitin-reports?${params}`)
    .then((response) => response.json())
    .then((records) => {
      if (!records || records.length === 0) {
        alert("No data to export");
        return;
      }

      let csv =
        "Date,Student ID,Student Name,Course,Lab Room,Purpose,Time In,Time Out,Duration\n";
      records.forEach((r) => {
        const duration = r.time_out
          ? calculateDuration(r.time_in, r.time_out)
          : "In Progress";
        csv += `${r.date},"${r.id_number}","${r.first_name} ${r.last_name}","${r.course}","${r.lab_room}","${r.purpose}",${r.time_in},${r.time_out},"${duration}"\n`;
      });

      const blob = new Blob([csv], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sitin_report_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    })
    .catch((error) => {
      console.error("Error exporting report:", error);
      alert("Failed to export report");
    });
}

// =============================================
// Utility Functions
// =============================================
function formatDate(dateString) {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTime(timeString) {
  if (!timeString) return "N/A";
  // Handle both full datetime and time-only strings
  if (timeString.includes("T") || timeString.includes(" ")) {
    const date = new Date(timeString);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  // Handle time-only string (HH:MM:SS)
  const parts = timeString.split(":");
  if (parts.length >= 2) {
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
  }
  return timeString;
}

function formatDateTime(dateTimeString) {
  if (!dateTimeString) return "N/A";
  const date = new Date(dateTimeString);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calculateDuration(timeIn, timeOut) {
  if (!timeIn) return "N/A";
  if (!timeOut) return "In Progress";

  // Parse times
  let inTime, outTime;

  if (timeIn.includes("T") || timeIn.includes(" ")) {
    inTime = new Date(timeIn);
  } else {
    inTime = new Date(`2000-01-01T${timeIn}`);
  }

  if (timeOut.includes("T") || timeOut.includes(" ")) {
    outTime = new Date(timeOut);
  } else {
    outTime = new Date(`2000-01-01T${timeOut}`);
  }

  const diffMs = outTime - inTime;
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffMins = Math.floor((diffMs % 3600000) / 60000);

  if (diffHrs > 0) {
    return `${diffHrs}h ${diffMins}m`;
  }
  return `${diffMins} minutes`;
}

function showLoading(show) {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    if (show) {
      overlay.classList.add("show");
    } else {
      overlay.classList.remove("show");
    }
  }
}

function showNoHistoryMessage() {
  const tableBody = document.getElementById("historyTableBody");
  const noHistoryMsg = document.getElementById("noHistoryMessage");
  if (tableBody) tableBody.innerHTML = "";
  if (noHistoryMsg) noHistoryMsg.style.display = "block";
}

// =============================================
// Admin UI Helpers (Missing Functions)
// =============================================
function closeSitInModal() {
  const modal = document.getElementById("sitInModal");
  if (modal) modal.classList.add("hidden");
  const form = document.getElementById("adminSitInForm");
  if (form) form.reset();
}

// =============================================
// History Feedback Functions
// =============================================
function openHistoryFeedbackModal(recordId, date, labRoom) {
  const modal = document.getElementById("historyFeedbackModal");
  const recordIdInput = document.getElementById("feedbackRecordId");
  const sessionInfo = document.getElementById("sessionSummaryInfo");

  if (recordIdInput) recordIdInput.value = recordId;

  if (sessionInfo) {
    sessionInfo.innerHTML = `
            <div class="session-info-item">
                <span class="label">Date:</span>
                <span class="value">${formatDate(date)}</span>
            </div>
            <div class="session-info-item">
                <span class="label">Lab:</span>
                <span class="value">${labRoom}</span>
            </div>
        `;
  }

  modal.classList.remove("hidden");
  document.getElementById("historyFeedbackComment").focus();
}

function closeHistoryFeedbackModal() {
  const modal = document.getElementById("historyFeedbackModal");
  modal.classList.add("hidden");
  document.getElementById("historyFeedbackForm").reset();
}

// History Feedback submission
const historyFeedbackForm = document.getElementById("historyFeedbackForm");
if (historyFeedbackForm) {
  historyFeedbackForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const comment = document
      .getElementById("historyFeedbackComment")
      .value.trim();
    const recordId = document.getElementById("feedbackRecordId").value;

    if (!comment) {
      showErrorModal(
        "Empty Message",
        "Please enter a message before submitting.",
      );
      return;
    }

    showLoading(true);
    try {
      const response = await fetch("/api/feedbacks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          comment,
          sit_in_record_id: recordId,
        }),
      });

      if (response.ok) {
        showSuccessModal(
          "Feedback Submitted",
          "Thank you! Your session feedback has been received.",
        );
        closeHistoryFeedbackModal();
      } else {
        const error = await response.json();
        showErrorModal(
          "Submission Failed",
          error.error || "Failed to submit feedback",
        );
      }
    } catch (error) {
      console.error("Error submitting history feedback:", error);
      showErrorModal(
        "Error",
        "An unexpected error occurred. Please try again.",
      );
    }
    showLoading(false);
  });
}

function showCheckInSuccessModal(student, labRoom, purpose) {
  alert(
    `Successfully Sit-in ${student.first_name} ${student.last_name} in ${labRoom} for ${purpose}.`,
  );
}

function showErrorModal(title, message) {
  alert(`${title}: ${message}`);
}

function showSuccessModal(title, message) {
  alert(`${title}: ${message}`);
}

function redirectToSitInFormFromModal(student) {
  const modal = document.getElementById("sitInModal");
  if (!modal) return;

  // Populate form
  document.getElementById("studentIdNumber").value = student.id_number;
  document.getElementById("studentName").value =
    `${student.first_name} ${student.last_name}`;
  document.getElementById("studentSession").value =
    student.remaining_sessions || 30;

  // Show modal
  modal.classList.remove("hidden");
}
