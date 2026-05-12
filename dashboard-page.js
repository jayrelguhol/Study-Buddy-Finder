(function () {
    const core = window.AppCore;
    if (!core) return;

    function renderDashboard(user) {
        const matches = core.getMatchesForUser(user);
        const schedules = core.getSchedules().filter((item) => item.user1 === user.username || item.user2 === user.username);
        const unread = core.getChats().filter((chat) => chat.matchId.includes(user.username) && chat.sender !== user.username).length;
        const infoParts = [];
        const userNameEl = document.getElementById('user-name');
        const userInfoEl = document.getElementById('user-info');
        const matchesCountEl = document.getElementById('matches-count');
        const schedulesCountEl = document.getElementById('schedules-count');
        const unreadCountEl = document.getElementById('unread-count');
        const summary = document.getElementById('dashboard-summary');

        if (user.course) infoParts.push(user.course);
        if (user.subjects?.length) infoParts.push(`${user.subjects.length} subjects selected`);

        if (userNameEl) userNameEl.textContent = core.getFirstName(user);
        if (userInfoEl) userInfoEl.textContent = infoParts.join(' | ') || 'Complete your subjects and availability to start matching.';
        if (matchesCountEl) matchesCountEl.textContent = String(matches.length);
        if (schedulesCountEl) schedulesCountEl.textContent = String(schedules.length);
        if (unreadCountEl) unreadCountEl.textContent = String(unread);

        if (!summary) return;
        if (!user.subjects?.length || !user.availability) {
            summary.innerHTML = '<p>Add your subjects and availability so the app can match you with other students.</p>';
        } else if (!matches.length) {
            summary.innerHTML = '<p>No matches yet. Keep your schedule updated and check back when more students join.</p>';
        } else {
            summary.innerHTML = `<p>You currently have <strong>${matches.length}</strong> match${matches.length === 1 ? '' : 'es'}.</p><p>Your top current match is <strong>${core.escapeHtml(core.getDisplayName(matches[0].otherUser))}</strong>.</p>`;
        }
    }

    document.addEventListener('DOMContentLoaded', async function () {
        if (document.body.dataset.page !== 'dashboard') return;
        const user = await core.initProtectedPage('dashboard');
        if (!user) return;
        renderDashboard(user);
        core.subscribeTables(['users', 'chats', 'schedules'], function () {
            const activeUser = core.getCurrentUser() || user;
            renderDashboard(activeUser);
        });
    });
})();
