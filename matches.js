(function () {
    const RELATED_SUBJECTS = {
        Math: ['Physics', 'Programming', 'Chemistry'],
        Science: ['Biology', 'Chemistry', 'Physics'],
        Programming: ['Math', 'Physics'],
        English: ['History'],
        History: ['English'],
        Physics: ['Math', 'Science', 'Programming', 'Chemistry'],
        Chemistry: ['Science', 'Biology', 'Physics', 'Math'],
        Biology: ['Science', 'Chemistry']
    };

    const STORAGE_KEYS = {
        CURRENT_USER: 'studybuddy_currentUser',
        CURRENT_CHAT_MATCH: 'studybuddy_currentChatMatch',
        SCHEDULE_WITH_USER: 'studybuddy_scheduleWithUser'
    };

    let realtimeChannel = null;
    let refreshTimer = null;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeUser(user) {
        return {
            username: String(user?.username || '').trim(),
            fullName: String(user?.fullName || user?.full_name || user?.username || 'Student').trim(),
            course: String(user?.course || '').trim(),
            role: user?.role || (user?.username === 'admin' ? 'admin' : 'user'),
            subjects: Array.isArray(user?.subjects) ? user.subjects : [],
            selectedTopics: Array.isArray(user?.selectedTopics || user?.selected_topics)
                ? (user.selectedTopics || user.selected_topics)
                : [],
            subjectTopics: user?.subjectTopics || user?.subject_topics || {}
        };
    }

    function readCachedUsers() {
        try {
            const raw = localStorage.getItem('studybuddy_users');
            const users = raw ? JSON.parse(raw) : [];
            return Array.isArray(users) ? users.map(normalizeUser) : [];
        } catch (error) {
            return [];
        }
    }

    async function fetchUsers() {
        const supabase = window.supabaseClient || null;
        if (!supabase) {
            return readCachedUsers();
        }

        const { data, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Unable to fetch users for matches.', error);
            return readCachedUsers();
        }

        return (data || []).map(normalizeUser);
    }

    function getRelatedSubjects(subject) {
        return Array.isArray(RELATED_SUBJECTS[subject]) ? RELATED_SUBJECTS[subject] : [];
    }

    function getMatchId(userA, userB) {
        return [userA, userB].sort().join('__');
    }

    function getCurrentTopicNames(user, subject) {
        const direct = user.subjectTopics?.[subject];
        if (Array.isArray(direct) && direct.length) {
            return direct.map((item) => String(item).split('::')[1]).filter(Boolean);
        }

        return Array.isArray(user.selectedTopics)
            ? user.selectedTopics
                .filter((item) => String(item).startsWith(`${subject}::`))
                .map((item) => String(item).split('::')[1])
                .filter(Boolean)
            : [];
    }

    function buildMatches(currentUser, allUsers, preferredSubject) {
        return allUsers
            .filter((user) => user.username && user.username !== currentUser.username && user.role !== 'admin')
            .map((otherUser) => {
                const availableSubjects = Array.isArray(otherUser.subjects) ? otherUser.subjects : [];
                const commonSubjects = (currentUser.subjects || []).filter((subject) => availableSubjects.includes(subject));
                const relatedPreferredSubjects = preferredSubject
                    ? availableSubjects.filter((subject) => getRelatedSubjects(preferredSubject).includes(subject))
                    : [];
                const hasPreferredSubject = Boolean(preferredSubject && availableSubjects.includes(preferredSubject));
                const hasRelatedPreferredSubject = Boolean(preferredSubject && !hasPreferredSubject && relatedPreferredSubjects.length);
                const prioritizedSubjects = [
                    ...new Set([
                        ...(hasPreferredSubject ? [preferredSubject] : []),
                        ...relatedPreferredSubjects,
                        ...availableSubjects
                    ])
                ];

                return {
                    id: getMatchId(currentUser.username, otherUser.username),
                    otherUser,
                    availableSubjects,
                    commonSubjects,
                    prioritizedSubjects,
                    relatedPreferredSubjects,
                    hasPreferredSubject,
                    hasRelatedPreferredSubject,
                    score: (hasPreferredSubject ? 100 : 0) + (hasRelatedPreferredSubject ? 50 : 0) + (commonSubjects.length * 10)
                };
            })
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                return left.otherUser.fullName.localeCompare(right.otherUser.fullName);
            });
    }

    function buildMatchCard(match, preferredSubject) {
        const subjectPanels = match.availableSubjects.map((subject) => {
            const partnerTopics = getCurrentTopicNames(match.otherUser, subject);
            return `
                <div class="match-topic-panel">
                    <p class="match-topic-subject">${escapeHtml(subject)}</p>
                    <p><strong>Uploaded topics:</strong> ${partnerTopics.length ? escapeHtml(partnerTopics.join(', ')) : 'No topic selected yet'}</p>
                </div>
            `;
        }).join('');

        const exactLabel = match.hasPreferredSubject
            ? `<p><strong>Same subject match:</strong> ${escapeHtml(preferredSubject)} was uploaded by this user.</p>`
            : '';
        const relatedLabel = !match.hasPreferredSubject && match.hasRelatedPreferredSubject
            ? `<p><strong>Related uploaded subject:</strong> ${escapeHtml(match.relatedPreferredSubjects.join(', '))}</p>`
            : '';

        return `
            <article class="match-card">
                <h3>${escapeHtml(match.otherUser.fullName)}</h3>
                <p><strong>Username:</strong> ${escapeHtml(match.otherUser.username)}</p>
                <p><strong>Course:</strong> ${escapeHtml(match.otherUser.course || 'Not set')}</p>
                <p><strong>Uploaded subjects:</strong> ${match.availableSubjects.length ? escapeHtml(match.availableSubjects.join(', ')) : 'No uploaded subjects yet'}</p>
                ${exactLabel}
                ${relatedLabel}
                <p><strong>Shared subjects:</strong> ${match.commonSubjects.length ? escapeHtml(match.commonSubjects.join(', ')) : 'None yet'}</p>
                ${subjectPanels}
                <div class="action-row">
                    <button type="button" class="connect-btn" data-chat-id="${match.id}">Chat</button>
                    <button type="button" class="secondary-btn compact-btn" data-schedule-user="${match.otherUser.username}">Schedule</button>
                </div>
            </article>
        `;
    }

    function bindActions(container) {
        container.querySelectorAll('[data-chat-id]').forEach((button) => {
            button.addEventListener('click', function () {
                localStorage.setItem(STORAGE_KEYS.CURRENT_CHAT_MATCH, button.dataset.chatId || '');
                window.location.href = 'chat.html';
            });
        });

        container.querySelectorAll('[data-schedule-user]').forEach((button) => {
            button.addEventListener('click', function () {
                localStorage.setItem(STORAGE_KEYS.SCHEDULE_WITH_USER, button.dataset.scheduleUser || '');
                window.location.href = 'schedule.html';
            });
        });
    }

    async function renderMatchesPage() {
        if (document.body?.dataset.page !== 'matches') return;

        const container = document.getElementById('matches-list');
        const note = document.getElementById('match-subject-note');
        if (!container) return;

        const currentUsername = localStorage.getItem(STORAGE_KEYS.CURRENT_USER) || '';
        const params = new URLSearchParams(window.location.search);
        const preferredSubject = params.get('subject') || '';
        const users = await fetchUsers();
        const currentUser = users.find((user) => user.username === currentUsername) || readCachedUsers().find((user) => user.username === currentUsername);

        if (!currentUser) {
            container.innerHTML = '<div class="empty-state">No logged-in user found for matching yet.</div>';
            return;
        }

        const matches = buildMatches(currentUser, users, preferredSubject);
        const exactMatches = preferredSubject ? matches.filter((match) => match.hasPreferredSubject) : matches;
        const relatedMatches = preferredSubject ? matches.filter((match) => !match.hasPreferredSubject && match.hasRelatedPreferredSubject) : [];
        const otherMatches = preferredSubject ? matches.filter((match) => !match.hasPreferredSubject && !match.hasRelatedPreferredSubject) : [];

        if (note) {
            note.textContent = preferredSubject
                ? `Showing users who uploaded ${preferredSubject} first, then related subjects, then everyone else.`
                : 'Showing all users who uploaded subjects for study matching.';
        }

        const sections = preferredSubject
            ? [
                `
                    <section class="match-group is-active-match-group">
                        <div class="match-group-header">
                            <h2 class="match-group-title">Same Subject Matches</h2>
                            <span class="match-group-count">${exactMatches.length} user${exactMatches.length === 1 ? '' : 's'}</span>
                        </div>
                        <div class="list-grid">
                            ${exactMatches.length ? exactMatches.map((match) => buildMatchCard(match, preferredSubject)).join('') : '<div class="empty-state">No user uploaded the same subject yet.</div>'}
                        </div>
                    </section>
                `,
                `
                    <section class="match-group">
                        <div class="match-group-header">
                            <h2 class="match-group-title">Related Subject Matches</h2>
                            <span class="match-group-count">${relatedMatches.length} user${relatedMatches.length === 1 ? '' : 's'}</span>
                        </div>
                        <div class="list-grid">
                            ${relatedMatches.length ? relatedMatches.map((match) => buildMatchCard(match, preferredSubject)).join('') : '<div class="empty-state">No user uploaded a related subject yet.</div>'}
                        </div>
                    </section>
                `,
                `
                    <section class="match-group">
                        <div class="match-group-header">
                            <h2 class="match-group-title">Other Uploaded Subjects</h2>
                            <span class="match-group-count">${otherMatches.length} user${otherMatches.length === 1 ? '' : 's'}</span>
                        </div>
                        <div class="list-grid">
                            ${otherMatches.length ? otherMatches.map((match) => buildMatchCard(match, preferredSubject)).join('') : '<div class="empty-state">No other uploaded subjects yet.</div>'}
                        </div>
                    </section>
                `
            ].join('')
            : `
                <section class="match-group is-active-match-group">
                    <div class="match-group-header">
                        <h2 class="match-group-title">All Uploaded Subjects</h2>
                        <span class="match-group-count">${matches.length} user${matches.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="list-grid">
                        ${matches.length ? matches.map((match) => buildMatchCard(match, preferredSubject)).join('') : '<div class="empty-state">No other uploaded subjects yet.</div>'}
                    </div>
                </section>
            `;

        container.innerHTML = sections;
        bindActions(container);
    }

    function startRealtime() {
        const supabase = window.supabaseClient || null;
        if (!supabase || realtimeChannel) return;

        realtimeChannel = supabase
            .channel('matches-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, renderMatchesPage)
            .subscribe();
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (document.body?.dataset.page !== 'matches') return;
        renderMatchesPage();
        startRealtime();

        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = window.setInterval(renderMatchesPage, 3000);
    });
})();
