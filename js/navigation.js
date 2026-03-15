// Dynamic Navigation Script
// This script dynamically generates the navigation bar based on login status

function updateNavigation() {
  const navLinks = document.getElementById('nav-links');
  const navRight = document.getElementById('nav-right');
  const loginLink = document.getElementById('loginLink');
  const registerLink = document.getElementById('registerLink');
  const dashboardLink = document.getElementById('dashboardLink');
  const logoutLink = document.getElementById('logoutLink');
  const userName = document.getElementById('userName');
  
  if (!navLinks) return;

  const sessionToken = localStorage.getItem('session_token');
  
  if (sessionToken) {
    // User is logged in - validate session and show logged-in state
    validateSessionAndUpdateNav(sessionToken);
  } else {
    // User is not logged in - show login/register links
    if (loginLink) loginLink.style.display = 'inline-flex';
    if (registerLink) registerLink.style.display = 'inline-flex';
    if (dashboardLink) dashboardLink.style.display = 'none';
    if (logoutLink) logoutLink.style.display = 'none';
    if (navRight) navRight.style.display = 'none';
  }
}

async function validateSessionAndUpdateNav(sessionToken) {
  const loginLink = document.getElementById('loginLink');
  const registerLink = document.getElementById('registerLink');
  const dashboardLink = document.getElementById('dashboardLink');
  const logoutLink = document.getElementById('logoutLink');
  const navRight = document.getElementById('nav-right');
  const userName = document.getElementById('userName');
  
  try {
    const response = await fetch(`/api/session/validate?token=${sessionToken}`);
    
    if (response.ok) {
      const data = await response.json();
      const user = data.user;
      
      // User is logged in - show dashboard/logout links
      if (loginLink) loginLink.style.display = 'none';
      if (registerLink) registerLink.style.display = 'none';
      if (dashboardLink) dashboardLink.style.display = 'inline-flex';
      if (logoutLink) logoutLink.style.display = 'inline-flex';
      if (navRight) navRight.style.display = 'flex';
      
      // Update username if element exists
      if (userName) {
        userName.textContent = user.name || user.first_name || 'Student';
      }
      
      // Store user data in localStorage
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      // Session invalid - show login/register links
      localStorage.removeItem('session_token');
      localStorage.removeItem('user');
      if (loginLink) loginLink.style.display = 'inline-flex';
      if (registerLink) registerLink.style.display = 'inline-flex';
      if (dashboardLink) dashboardLink.style.display = 'none';
      if (logoutLink) logoutLink.style.display = 'none';
      if (navRight) navRight.style.display = 'none';
    }
  } catch (error) {
    console.error('Error validating session:', error);
    // On error, show login/register links
    localStorage.removeItem('session_token');
    localStorage.removeItem('user');
    if (loginLink) loginLink.style.display = 'inline-flex';
    if (registerLink) registerLink.style.display = 'inline-flex';
    if (dashboardLink) dashboardLink.style.display = 'none';
    if (logoutLink) logoutLink.style.display = 'none';
    if (navRight) navRight.style.display = 'none';
  }
}

async function handleLogout() {
  const sessionToken = localStorage.getItem('session_token');
  
  if (sessionToken) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session_token: sessionToken })
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
  }
  
  // Clear session and redirect to home
  localStorage.removeItem('session_token');
  localStorage.removeItem('user');
  window.location.href = '/index.html';
}

// Run on page load
document.addEventListener('DOMContentLoaded', updateNavigation);
