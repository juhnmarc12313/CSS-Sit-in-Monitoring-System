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
document.addEventListener('DOMContentLoaded', function() {
    // Check if session token exists
    sessionToken = localStorage.getItem('session_token');

    if (!sessionToken) {
        // Redirect to login if not authenticated
        window.location.href = 'login.html';
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
            localStorage.removeItem('session_token');
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.error('Error validating session:', error);
        // Redirect to login on error
        localStorage.removeItem('session_token');
        window.location.href = 'login.html';
    }
    
    showLoading(false);
}

function initializeDashboard() {
    // Display user information
    displayUserInfo();
    
    // Load dashboard data
    loadSitInHistory();
    loadNotifications();
    loadAnnouncements();
    
    // Setup event listeners
    setupEventListeners();
}

// =============================================
// User Information Display
// =============================================
function displayUserInfo() {
    // Update navigation
    document.getElementById('userName').textContent = currentUser.name || 'Student';
    
    // Update student information card
    document.getElementById('infoName').textContent = currentUser.name || 'Student Name';
    document.getElementById('infoCourse').textContent = currentUser.course || 'Course';
    document.getElementById('infoYear').textContent = getYearLevel(currentUser.course_level);
    document.getElementById('infoAddress').textContent = currentUser.address || 'Not specified';
    
    // Update profile picture display
    updateProfilePictureDisplay();
    
    // Populate edit profile form
    populateEditForm();
}

function updateProfilePictureDisplay() {
    const profilePicture = currentUser.profile_picture;
    
    // Dashboard student info card
    const displayImg = document.getElementById('profilePictureDisplay');
    const defaultIcon = document.getElementById('defaultAvatarIcon');
    
    // Edit profile section
    const editImg = document.getElementById('editProfilePicture');
    const editDefaultIcon = document.getElementById('editDefaultAvatar');
    const removeBtn = document.getElementById('removePhotoBtn');
    
    if (profilePicture) {
        // Show profile picture
        if (displayImg) {
            displayImg.src = profilePicture;
            displayImg.style.display = 'block';
        }
        if (defaultIcon) defaultIcon.style.display = 'none';
        
        if (editImg) {
            editImg.src = profilePicture;
            editImg.style.display = 'block';
        }
        if (editDefaultIcon) editDefaultIcon.style.display = 'none';
        if (removeBtn) removeBtn.style.display = 'inline-flex';
    } else {
        // Show default icon
        if (displayImg) displayImg.style.display = 'none';
        if (defaultIcon) defaultIcon.style.display = 'block';
        
        if (editImg) editImg.style.display = 'none';
        if (editDefaultIcon) editDefaultIcon.style.display = 'block';
        if (removeBtn) removeBtn.style.display = 'none';
    }
}

function getYearLevel(level) {
    const levels = {
        1: '1st Year',
        2: '2nd Year',
        3: '3rd Year',
        4: '4th Year'
    };
    return levels[level] || 'Unknown';
}

// =============================================
// Navigation & Section Management
// =============================================
function showSection(sectionName) {
    // Hide all sections
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => section.classList.add('hidden'));
    
    // Remove active class from all nav links (skip Home link which is index 0)
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => link.classList.remove('active'));
    
    // Show selected section and activate nav link
    switch(sectionName) {
        case 'dashboard':
            document.getElementById('dashboardSection').classList.remove('hidden');
            activateNavLink(1);
            break;
        case 'reservation':
            document.getElementById('reservationSection').classList.remove('hidden');
            activateNavLink(2);
            break;
        case 'notifications':
            document.getElementById('notificationsSection').classList.remove('hidden');
            activateNavLink(3);
            break;
        case 'editProfile':
            document.getElementById('editProfileSection').classList.remove('hidden');
            activateNavLink(4);
            break;
        case 'history':
            document.getElementById('historySection').classList.remove('hidden');
            activateNavLink(5);
            displayFullHistory();
            break;
    }
}

function activateNavLink(index) {
    const navLinks = document.querySelectorAll('.nav-link');
    if (navLinks[index]) {
        navLinks[index].classList.add('active');
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
            console.error('Failed to load sit-in history');
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
    
    showLoading(false);
}

function updateSessionsRemaining(records) {
    if (!records || !records.length) return;
    
    const totalSitins = records.length;
    
    // Calculate remaining sessions (assuming 30 max sessions per semester)
    const maxSessions = 30;
    const sessionsRemaining = Math.max(0, maxSessions - totalSitins);
    
    const sessionsElement = document.getElementById('infoSessionsRemaining');
    if (sessionsElement) {
        sessionsElement.textContent = sessionsRemaining;
    }
}

function displayFullHistory() {
    const tableBody = document.getElementById('fullHistoryTableBody');
    const noHistoryMsg = document.getElementById('noFullHistoryMessage');
    
    if (!allHistoryData || allHistoryData.length === 0) {
        tableBody.innerHTML = '';
        noHistoryMsg.style.display = 'block';
        return;
    }
    
    noHistoryMsg.style.display = 'none';
    
    tableBody.innerHTML = allHistoryData.map(record => `
        <tr>
            <td>${formatDate(record.date)}</td>
            <td>${record.lab_room || 'N/A'}</td>
            <td>${record.purpose || 'N/A'}</td>
            <td>${formatTime(record.time_in)}</td>
            <td>${record.time_out ? formatTime(record.time_out) : '-'}</td>
            <td>${calculateDuration(record.time_in, record.time_out)}</td>
        </tr>
    `).join('');
}

function filterHistory() {
    const monthFilter = document.getElementById('filterMonth').value;
    const labFilter = document.getElementById('filterLab').value;
    
    let filteredData = [...allHistoryData];
    
    if (monthFilter) {
        filteredData = filteredData.filter(record => {
            const recordDate = new Date(record.date);
            const recordMonth = recordDate.toISOString().slice(0, 7);
            return recordMonth === monthFilter;
        });
    }
    
    if (labFilter) {
        filteredData = filteredData.filter(record => 
            record.lab_room === labFilter
        );
    }
    
    const tableBody = document.getElementById('fullHistoryTableBody');
    const noHistoryMsg = document.getElementById('noFullHistoryMessage');
    
    if (filteredData.length === 0) {
        tableBody.innerHTML = '';
        noHistoryMsg.style.display = 'block';
    } else {
        noHistoryMsg.style.display = 'none';
        tableBody.innerHTML = filteredData.map(record => `
            <tr>
                <td>${formatDate(record.date)}</td>
                <td>${record.lab_room || 'N/A'}</td>
                <td>${record.purpose || 'N/A'}</td>
                <td>${formatTime(record.time_in)}</td>
                <td>${record.time_out ? formatTime(record.time_out) : '-'}</td>
                <td>${calculateDuration(record.time_in, record.time_out)}</td>
            </tr>
        `).join('');
    }
}

function clearFilters() {
    document.getElementById('filterMonth').value = '';
    document.getElementById('filterLab').value = '';
    displayFullHistory();
}

// =============================================
// Profile Picture Upload
// =============================================
async function handleProfilePictureChange(event) {
    const file = event.target.files[0];
    
    if (!file) return;
    
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
        showMessage('Only image files (JPG, PNG, GIF) are allowed!', 'error');
        return;
    }
    
    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
        showMessage('File size must be less than 5MB!', 'error');
        return;
    }
    
    // Show preview immediately
    const reader = new FileReader();
    reader.onload = function(e) {
        const editImg = document.getElementById('editProfilePicture');
        const editDefaultIcon = document.getElementById('editDefaultAvatar');
        const removeBtn = document.getElementById('removePhotoBtn');
        
        editImg.src = e.target.result;
        editImg.style.display = 'block';
        editDefaultIcon.style.display = 'none';
        removeBtn.style.display = 'inline-flex';
    };
    reader.readAsDataURL(file);
    
    // Upload to server
    showLoading(true);
    
    try {
        const formData = new FormData();
        formData.append('profilePicture', file);
        
        const response = await fetch(`/api/user/${currentUser.id}/profile-picture`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Update current user data
            currentUser.profile_picture = data.profile_picture;
            localStorage.setItem('user', JSON.stringify(currentUser));
            
            // Update all profile picture displays
            updateProfilePictureDisplay();
            
            showMessage('Profile picture updated successfully!', 'success');
        } else {
            showMessage(data.error || 'Failed to upload profile picture', 'error');
            // Revert preview on error
            updateProfilePictureDisplay();
        }
    } catch (error) {
        console.error('Error uploading profile picture:', error);
        showMessage('An error occurred while uploading', 'error');
        // Revert preview on error
        updateProfilePictureDisplay();
    }
    
    showLoading(false);
    
    // Clear the input so the same file can be selected again
    event.target.value = '';
}

async function removeProfilePicture() {
    if (!confirm('Are you sure you want to remove your profile picture?')) {
        return;
    }
    
    showLoading(true);
    
    try {
        // Update user with null profile picture
        const response = await fetch(`/api/user/${currentUser.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                first_name: currentUser.first_name,
                last_name: currentUser.last_name,
                middle_name: currentUser.middle_name,
                email: currentUser.email,
                course: currentUser.course,
                course_level: currentUser.course_level,
                address: currentUser.address,
                remove_profile_picture: true
            })
        });
        
        if (response.ok) {
            currentUser.profile_picture = null;
            localStorage.setItem('user', JSON.stringify(currentUser));
            updateProfilePictureDisplay();
            showMessage('Profile picture removed successfully!', 'success');
        } else {
            const data = await response.json();
            showMessage(data.error || 'Failed to remove profile picture', 'error');
        }
    } catch (error) {
        console.error('Error removing profile picture:', error);
        showMessage('An error occurred', 'error');
    }
    
    showLoading(false);
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
        console.error('Error loading notifications:', error);
        loadMockNotifications();
    }
}

function loadMockNotifications() {
    notifications = [
        {
            id: 1,
            title: 'Welcome to CCS Sit-in System',
            message: 'Thank you for registering! You can now use the laboratory sit-in services.',
            time: '2026-03-15 08:00:00',
            read: false
        },
        {
            id: 2,
            title: 'Lab Schedule Update',
            message: 'Lab 3 will be closed for maintenance on March 20, 2026.',
            time: '2026-03-14 10:30:00',
            read: false
        },
        {
            id: 3,
            title: 'Sit-in Reminder',
            message: 'You have an active sit-in session in Lab 2.',
            time: '2026-03-13 09:00:00',
            read: true
        }
    ];
    
    displayNotificationCount();
    displayNotificationList();
}

function displayNotificationCount() {
    const unreadCount = notifications.filter(n => !n.read).length;
    const countElement = document.getElementById('notificationCount');
    countElement.textContent = unreadCount;
    countElement.setAttribute('data-count', unreadCount);
}

function displayNotificationList() {
    const listElement = document.getElementById('notificationList');
    
    if (notifications.length === 0) {
        listElement.innerHTML = '<p class="no-notifications">No notifications</p>';
        return;
    }
    
    // Show only 5 most recent notifications
    const recentNotifications = notifications.slice(0, 5);
    
    listElement.innerHTML = recentNotifications.map(notification => `
        <div class="notification-item ${notification.read ? '' : 'unread'}" 
             onclick="markAsRead(${notification.id})">
            <h4>${notification.title}</h4>
            <p>${notification.message}</p>
            <span class="time">${formatDateTime(notification.time)}</span>
        </div>
    `).join('');
}

function displayAllNotifications() {
    const listElement = document.getElementById('notificationsListFull');
    
    if (notifications.length === 0) {
        listElement.innerHTML = '<p class="no-notifications">No notifications</p>';
        return;
    }
    
    listElement.innerHTML = notifications.map(notification => `
        <div class="notification-item-full ${notification.read ? '' : 'unread'}"
             onclick="markAsRead(${notification.id})">
            <h4>${notification.title}</h4>
            <p>${notification.message}</p>
            <span class="time">${formatDateTime(notification.time)}</span>
        </div>
    `).join('');
}

function toggleNotifications() {
    const panel = document.getElementById('notificationPanel');
    panel.classList.toggle('show');
}

function markAsRead(notificationId) {
    const notification = notifications.find(n => n.id === notificationId);
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
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating notification:', error);
    }
}

function markAllRead() {
    notifications.forEach(n => n.read = true);
    displayNotificationCount();
    displayNotificationList();
    displayAllNotifications();
}

function clearAllNotifications() {
    if (confirm('Are you sure you want to clear all notifications?')) {
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
        const response = await fetch('/api/announcements');
        
        if (response.ok) {
            const announcements = await response.json();
            displayAnnouncements(announcements);
        } else {
            // Load mock announcements
            loadMockAnnouncements();
        }
    } catch (error) {
        console.error('Error loading announcements:', error);
        loadMockAnnouncements();
    }
}

function loadMockAnnouncements() {
    const announcements = [
        {
            id: 1,
            title: 'Laboratory Schedule Update',
            message: 'Lab 3 will be closed for maintenance on March 20-21, 2026. Please use other laboratories during this period.',
            date: '2026-03-15'
        },
        {
            id: 2,
            title: 'New Software Installed',
            message: 'Visual Studio Code and Node.js have been updated to the latest versions in all laboratories.',
            date: '2026-03-14'
        },
        {
            id: 3,
            title: 'Extended Laboratory Hours',
            message: 'Starting next week, laboratories will be open until 8:00 PM on weekdays to accommodate more students.',
            date: '2026-03-12'
        },
        {
            id: 4,
            title: 'Sit-in Monitoring System Launch',
            message: 'Welcome to the new CCS Sit-in Monitoring System! Please report any issues to the laboratory supervisor.',
            date: '2026-03-10'
        }
    ];
    
    displayAnnouncements(announcements);
}

function displayAnnouncements(announcements) {
    const listElement = document.getElementById('announcementList');
    
    if (!announcements || announcements.length === 0) {
        listElement.innerHTML = '<p class="no-data-message">No announcements available.</p>';
        return;
    }
    
    listElement.innerHTML = announcements.map(announcement => `
        <div class="announcement-item">
            <h4>${announcement.title}</h4>
            <p>${announcement.message}</p>
            <span class="announcement-date">${formatDate(announcement.date)}</span>
        </div>
    `).join('');
}

// =============================================
// Edit Profile
// =============================================
function populateEditForm() {
    document.getElementById('editFirstName').value = currentUser.first_name || '';
    document.getElementById('editLastName').value = currentUser.last_name || '';
    document.getElementById('editMiddleName').value = currentUser.middle_name || '';
    document.getElementById('editEmail').value = currentUser.email || '';
    document.getElementById('editCourse').value = currentUser.course || '';
    document.getElementById('editCourseLevel').value = currentUser.course_level || '';
    document.getElementById('editAddress').value = currentUser.address || '';
}

async function handleEditProfile(event) {
    event.preventDefault();
    
    const formData = {
        first_name: document.getElementById('editFirstName').value,
        last_name: document.getElementById('editLastName').value,
        middle_name: document.getElementById('editMiddleName').value,
        email: document.getElementById('editEmail').value,
        course: document.getElementById('editCourse').value,
        course_level: parseInt(document.getElementById('editCourseLevel').value),
        address: document.getElementById('editAddress').value,
        current_password: document.getElementById('currentPassword').value,
        new_password: document.getElementById('newPassword').value
    };
    
    showLoading(true);
    
    try {
        const response = await fetch(`/api/user/${currentUser.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
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
            
            localStorage.setItem('user', JSON.stringify(currentUser));
            
            // Update display
            displayUserInfo();
            
            showMessage('Profile updated successfully!', 'success');
            
            // Clear password fields
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
        } else {
            showMessage(data.error || 'Failed to update profile', 'error');
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        showMessage('An error occurred. Please try again.', 'error');
    }
    
    showLoading(false);
}

function resetForm() {
    populateEditForm();
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('profileMessage').className = 'message-container';
    document.getElementById('profileMessage').textContent = '';
}

function showMessage(message, type) {
    const messageDiv = document.getElementById('profileMessage');
    messageDiv.textContent = message;
    messageDiv.className = `message-container ${type}`;
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        messageDiv.className = 'message-container';
        messageDiv.textContent = '';
    }, 5000);
}

// =============================================
// Logout
// =============================================
async function handleLogout() {
    if (!confirm('Are you sure you want to logout?')) {
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ session_token: sessionToken })
        });
        
        if (response.ok) {
            // Clear session token from local storage
            localStorage.removeItem('session_token');
            
            // Redirect to login page
            window.location.href = 'login.html';
        } else {
            console.error('Logout failed on server');
            // Still clear and redirect
            localStorage.removeItem('session_token');
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.error('Error during logout:', error);
        // Clear and redirect anyway
        localStorage.removeItem('session_token');
        window.location.href = 'login.html';
    }
    
    showLoading(false);
}

// =============================================
// Event Listeners Setup
// =============================================
function setupEventListeners() {
    // Edit profile form submission
    const editForm = document.getElementById('editProfileForm');
    if (editForm) {
        editForm.addEventListener('submit', handleEditProfile);
    }
    
    // Close notification panel when clicking outside
    document.addEventListener('click', function(event) {
        const panel = document.getElementById('notificationPanel');
        const bell = document.querySelector('.notification-bell');
        
        if (!panel.contains(event.target) && !bell.contains(event.target)) {
            panel.classList.remove('show');
        }
    });
}

// =============================================
// Utility Functions
// =============================================
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatTime(timeString) {
    if (!timeString) return 'N/A';
    // Handle both full datetime and time-only strings
    if (timeString.includes('T') || timeString.includes(' ')) {
        const date = new Date(timeString);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    // Handle time-only string (HH:MM:SS)
    const parts = timeString.split(':');
    if (parts.length >= 2) {
        const hours = parseInt(parts[0]);
        const minutes = parseInt(parts[1]);
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    }
    return timeString;
}

function formatDateTime(dateTimeString) {
    if (!dateTimeString) return 'N/A';
    const date = new Date(dateTimeString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function calculateDuration(timeIn, timeOut) {
    if (!timeIn) return 'N/A';
    if (!timeOut) return 'In Progress';
    
    // Parse times
    let inTime, outTime;
    
    if (timeIn.includes('T') || timeIn.includes(' ')) {
        inTime = new Date(timeIn);
    } else {
        inTime = new Date(`2000-01-01T${timeIn}`);
    }
    
    if (timeOut.includes('T') || timeOut.includes(' ')) {
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
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        if (show) {
            overlay.classList.add('show');
        } else {
            overlay.classList.remove('show');
        }
    }
}

function showNoHistoryMessage() {
    const tableBody = document.getElementById('historyTableBody');
    const noHistoryMsg = document.getElementById('noHistoryMessage');
    if (tableBody) tableBody.innerHTML = '';
    if (noHistoryMsg) noHistoryMsg.style.display = 'block';
}
