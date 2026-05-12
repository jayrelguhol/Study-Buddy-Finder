(function () {
    const core = window.AppCore;
    if (!core) return;

    function renderAdminDashboard() {
        const studentUsers = core.getUsers().filter((user) => user.role !== 'admin');
        const schedules = core.getSchedules().sort((left, right) => new Date(left.time) - new Date(right.time));
        const chats = core.getChats();

        document.getElementById('admin-user-count').textContent = String(studentUsers.length);
        document.getElementById('admin-subject-count').textContent = String(studentUsers.filter((user) => user.subjects?.length && user.availability).length);
        document.getElementById('admin-schedule-count').textContent = String(schedules.length);
        document.getElementById('admin-chat-count').textContent = String(chats.length);

        document.getElementById('admin-users-list').innerHTML = studentUsers.length
            ? studentUsers.map((user) => `
                <article class="manager-item">
                    <div>
                        <h3>${core.escapeHtml(user.fullName)}</h3>
                        <p>${core.escapeHtml(user.username)} | ${core.escapeHtml(user.course || 'No course')}</p>
                        <p>${user.subjects?.length ? core.escapeHtml(user.subjects.join(', ')) : 'No subjects selected yet'}</p>
                    </div>
                    <button type="button" class="danger-btn" data-remove-user="${user.username}">Remove User</button>
                </article>
            `).join('')
            : '<div class="empty-state">No student users yet.</div>';

        document.getElementById('admin-schedules-list').innerHTML = schedules.length
            ? schedules.map((schedule) => `
                <article class="manager-item">
                    <div>
                        <h3>${core.escapeHtml(schedule.user1)} and ${core.escapeHtml(schedule.user2)}</h3>
                        <p>${core.escapeHtml(core.formatDateTime(schedule.time))}</p>
                    </div>
                    <button type="button" class="danger-btn" data-delete-schedule="${schedule.id}">Delete</button>
                </article>
            `).join('')
            : '<div class="empty-state">No schedules yet.</div>';

        document.querySelectorAll('[data-remove-user]').forEach((button) => {
            button.addEventListener('click', async function () {
                try {
                    await core.refreshAllData();
                    await core.deleteUsersByUsername([button.dataset.removeUser]);
                    renderAdminDashboard();
                } catch (error) {
                    console.error('Unable to remove user.', error);
                    window.alert('Unable to remove that user right now.');
                }
            });
        });

        document.querySelectorAll('[data-delete-schedule]').forEach((button) => {
            button.addEventListener('click', async function () {
                try {
                    await core.refreshAllData();
                    await core.saveSchedules(core.getSchedules().filter((schedule) => schedule.id !== button.dataset.deleteSchedule));
                    renderAdminDashboard();
                } catch (error) {
                    console.error('Unable to delete schedule.', error);
                    window.alert('Unable to delete that schedule right now.');
                }
            });
        });
    }

    document.addEventListener('DOMContentLoaded', async function () {
        if (document.body.dataset.page !== 'admin') return;
        const user = await core.initProtectedPage('admin');
        if (!user) return;
        renderAdminDashboard();
        core.subscribeTables(['users', 'chats', 'schedules'], renderAdminDashboard);
        window.setInterval(async function () {
            try {
                await core.refreshAllData();
                renderAdminDashboard();
            } catch (error) {
                console.error('Unable to refresh admin dashboard.', error);
            }
        }, 3000);
    });
})();
