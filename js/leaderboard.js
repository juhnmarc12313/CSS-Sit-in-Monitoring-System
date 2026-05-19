document.addEventListener('DOMContentLoaded', () => {
    fetchLeaderboardData();
});

async function fetchLeaderboardData() {
    const loadingEl = document.getElementById('leaderboardLoading');
    const emptyEl = document.getElementById('leaderboardEmpty');
    const contentEl = document.getElementById('leaderboardContent');
    const podiumContainer = document.getElementById('podiumContainer');
    const listBody = document.getElementById('leaderboardListBody');

    try {
        const response = await fetch('/api/leaderboard');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        loadingEl.style.display = 'none';

        if (!data || data.length === 0) {
            emptyEl.style.display = 'flex';
            contentEl.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';
        contentEl.style.display = 'block';

        renderPodium(data.slice(0, 3), podiumContainer);
        renderList(data.slice(3), listBody);

    } catch (error) {
        console.error('Error fetching leaderboard data:', error);
        loadingEl.style.display = 'none';
        emptyEl.style.display = 'flex';
        emptyEl.innerHTML = `
            <i class="fas fa-exclamation-triangle" style="color: #e74c3c;"></i>
            <p>Failed to load leaderboard data. Please try again later.</p>
        `;
    }
}

function renderPodium(topStudents, container) {
    container.innerHTML = '';

    topStudents.forEach((student, index) => {
        const rank = index + 1;
        const card = document.createElement('div');
        card.className = `podium-card rank-${rank} animate__animated animate__zoomIn`;
        card.style.animationDelay = `${index * 0.15}s`;

        const avatarHtml = student.profile_picture 
            ? `<img src="${student.profile_picture}" alt="${student.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><i class="fas fa-user" style="display: none;"></i>`
            : `<i class="fas fa-user"></i>`;

        card.innerHTML = `
            <div class="podium-badge">${rank}</div>
            <div class="podium-avatar">${avatarHtml}</div>
            <div class="podium-name">${student.name}</div>
            <div class="podium-course">${student.course} - ${student.course_level}</div>
            <div class="podium-stats">
                <div class="podium-stat-box">
                    <span class="podium-stat-label">Sessions</span>
                    <span class="podium-stat-value">${student.totalSessions}</span>
                </div>
                <div class="podium-stat-box">
                    <span class="podium-stat-label">Hours</span>
                    <span class="podium-stat-value">${student.totalHours}</span>
                </div>
            </div>
        `;

        container.appendChild(card);
    });
}

function renderList(listStudents, container) {
    container.innerHTML = '';

    if (listStudents.length === 0) {
        const noMore = document.createElement('div');
        noMore.className = 'leaderboard-row';
        noMore.style.justifyContent = 'center';
        noMore.style.color = '#999';
        noMore.innerText = 'No more scholars to display.';
        container.appendChild(noMore);
        return;
    }

    listStudents.forEach((student, index) => {
        const rank = index + 4;
        const row = document.createElement('div');
        row.className = 'leaderboard-row animate__animated animate__fadeInUp';
        row.style.animationDelay = `${(index + 3) * 0.1}s`;

        const avatarHtml = student.profile_picture 
            ? `<img src="${student.profile_picture}" alt="${student.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><i class="fas fa-user" style="display: none;"></i>`
            : `<i class="fas fa-user"></i>`;

        row.innerHTML = `
            <span class="col-rank">#${rank}</span>
            <div class="col-student">
                <div class="list-avatar">${avatarHtml}</div>
                <span>${student.name}</span>
            </div>
            <span class="col-course">${student.course} - ${student.course_level}</span>
            <span class="col-sessions">${student.totalSessions}</span>
            <span class="col-hours">${student.totalHours}h</span>
        `;

        container.appendChild(row);
    });
}
