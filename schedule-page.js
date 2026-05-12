(function () {
    const core = window.AppCore;
    if (!core) return;

    function renderSchedules(user) {
        const container = document.getElementById('schedules-list');
        if (!container) return;
        const schedules = core.getSchedules()
            .filter((item) => item.user1 === user.username || item.user2 === user.username)
            .sort((left, right) => new Date(left.time) - new Date(right.time));

        container.innerHTML = schedules.length
            ? schedules.map((schedule) => {
                const partnerUsername = schedule.user1 === user.username ? schedule.user2 : schedule.user1;
                const partner = core.getUsers().find((item) => item.username === partnerUsername);
                return `<article class="match-card"><h3>${core.escapeHtml(partner?.fullName || partnerUsername)}</h3><p><strong>Time:</strong> ${core.escapeHtml(core.formatDateTime(schedule.time))}</p><div class="action-row"><button type="button" class="secondary-btn compact-btn" data-edit-schedule-id="${schedule.id}">Edit Schedule</button></div></article>`;
            }).join('')
            : '<div class="empty-state">No sessions scheduled yet.</div>';
    }

    document.addEventListener('DOMContentLoaded', async function () {
        if (document.body.dataset.page !== 'schedule') return;
        const user = await core.initProtectedPage('schedule');
        if (!user) return;

        const select = document.getElementById('schedule-match');
        const partnersContainer = document.getElementById('schedule-partners');
        const partnerNote = document.getElementById('schedule-partner-note');
        const timeGroup = document.getElementById('schedule-time-group');
        const timeInput = document.getElementById('schedule-time');
        const submitButton = document.getElementById('schedule-submit-btn');
        let editingScheduleId = '';
        let editingPartnerUsername = '';

        function getUserSchedules() {
            return core.getSchedules().filter((item) => item.user1 === user.username || item.user2 === user.username);
        }

        function getAvailableMatches() {
            const allMatches = core.getMatchesForUser(user);
            const scheduledPartners = new Set(getUserSchedules().map((item) => item.user1 === user.username ? item.user2 : item.user1));
            return allMatches.filter((match) => !scheduledPartners.has(match.otherUser.username) || match.otherUser.username === editingPartnerUsername);
        }

        function syncPartnerOptions() {
            const availableMatches = getAvailableMatches();
            select.innerHTML = availableMatches.length
                ? `<option value="">Choose a study partner</option>${availableMatches.map((match) => `<option value="${match.otherUser.username}">${core.escapeHtml(match.otherUser.fullName)}</option>`).join('')}`
                : '<option value="">No matches available</option>';
            select.value = editingPartnerUsername || '';
        }

        function syncFields() {
            const hasPartner = Boolean(select.value || editingScheduleId);
            timeGroup?.classList.toggle('is-hidden', !hasPartner);
            if (timeInput) {
                timeInput.disabled = !hasPartner;
                timeInput.required = hasPartner;
            }
            if (submitButton) {
                submitButton.classList.toggle('is-hidden', !hasPartner);
                submitButton.disabled = !hasPartner;
                submitButton.textContent = editingScheduleId ? 'Update Schedule' : 'Save Schedule';
            }
        }

        function renderPartners() {
            const matches = getAvailableMatches();
            if (!partnersContainer) return;
            partnersContainer.innerHTML = matches.length
                ? matches.map((match) => {
                    const isSelected = select.value === match.otherUser.username;
                    return `<button type="button" class="schedule-partner-card ${isSelected ? 'is-selected' : ''}" data-schedule-partner="${match.otherUser.username}" aria-pressed="${isSelected ? 'true' : 'false'}"><strong>${core.escapeHtml(core.getDisplayName(match.otherUser))}</strong><span>${core.escapeHtml(match.otherUser.course || 'Course not set')}</span><span>Uploaded subjects: ${core.escapeHtml((match.availableSubjects || []).join(', ') || 'None yet')}</span></button>`;
                }).join('')
                : '<div class="empty-state">No unscheduled matched users available right now.</div>';

            partnerNote.textContent = select.value
                ? `Scheduling with ${core.escapeHtml(select.value)}.`
                : 'Choose who you want to schedule with first.';
            syncFields();
        }

        partnersContainer?.addEventListener('click', function (event) {
            const button = event.target.closest('[data-schedule-partner]');
            if (!button) return;
            editingScheduleId = '';
            editingPartnerUsername = '';
            if (timeInput) timeInput.value = '';
            select.value = button.dataset.schedulePartner || '';
            renderPartners();
        });

        document.getElementById('schedules-list')?.addEventListener('click', function (event) {
            const button = event.target.closest('[data-edit-schedule-id]');
            if (!button) return;
            const schedule = getUserSchedules().find((item) => item.id === button.dataset.editScheduleId);
            if (!schedule) return;
            editingScheduleId = schedule.id;
            editingPartnerUsername = schedule.user1 === user.username ? schedule.user2 : schedule.user1;
            if (timeInput) timeInput.value = schedule.time || '';
            syncPartnerOptions();
            renderPartners();
        });

        document.getElementById('schedule-form')?.addEventListener('submit', async function (event) {
            event.preventDefault();
            const partner = editingScheduleId ? editingPartnerUsername : select.value;
            const time = timeInput?.value || '';
            if (!partner || !time) return;
            try {
                await core.refreshAllData();
                const schedules = core.getSchedules();
                if (editingScheduleId) {
                    const index = schedules.findIndex((item) => item.id === editingScheduleId);
                    if (index !== -1) schedules[index] = { ...schedules[index], time };
                } else {
                    schedules.push({ id: `schedule-${Date.now()}`, user1: user.username, user2: partner, time });
                }
                await core.saveSchedules(schedules);
                editingScheduleId = '';
                editingPartnerUsername = '';
                if (timeInput) timeInput.value = '';
                select.value = '';
                renderSchedules(user);
                syncPartnerOptions();
                renderPartners();
            } catch (error) {
                console.error('Unable to save schedule.', error);
                window.alert('Unable to save this schedule right now.');
            }
        });

        syncPartnerOptions();
        renderPartners();
        renderSchedules(user);
        core.subscribeTables(['users', 'schedules'], function () {
            const activeUser = core.getCurrentUser() || user;
            renderSchedules(activeUser);
            syncPartnerOptions();
            renderPartners();
        });
    });
})();
