const SUBJECTS = ['Math', 'Science', 'Programming', 'English', 'History', 'Physics', 'Chemistry', 'Biology'];
const SUBJECT_TOPICS = {
    Math: ['Algebra', 'Geometry', 'Trigonometry', 'Statistics', 'Word problems'],
    Science: ['Scientific method', 'Earth science', 'Energy and matter', 'Lab analysis', 'Science reporting'],
    Programming: ['Variables and data types', 'Loops and conditions', 'Functions', 'Debugging', 'Problem solving'],
    English: ['Reading comprehension', 'Grammar', 'Essay writing', 'Vocabulary', 'Oral presentation'],
    History: ['Historical timelines', 'Primary sources', 'Cause and effect', 'Civilizations', 'Document analysis'],
    Physics: ['Motion and forces', 'Work and energy', 'Waves', 'Electricity', 'Problem solving drills'],
    Chemistry: ['Periodic table', 'Chemical reactions', 'Stoichiometry', 'Acids and bases', 'Lab calculations'],
    Biology: ['Cell structure', 'Genetics', 'Human body systems', 'Ecology', 'Classification']
};
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
    USERS: 'studybuddy_users',
    CURRENT_USER: 'studybuddy_currentUser',
    CHATS: 'studybuddy_chats',
    SCHEDULES: 'studybuddy_schedules',
    DARK_MODE: 'studybuddy_darkMode',
    CURRENT_CHAT_MATCH: 'studybuddy_currentChatMatch',
    SCHEDULE_WITH_USER: 'studybuddy_scheduleWithUser',
    CURRENT_MATCH_SUBJECT: 'studybuddy_currentMatchSubject'
};

const USER_PAGES = ['dashboard', 'subjects', 'matches', 'schedule', 'profile', 'chat'];
let authMode = 'login';
let chatPollId = null;
let renderedMatches = [];
let realtimeChannel = null;
let realtimeRefreshInFlight = null;
const supabase = window.supabaseClient || null;
const USE_SUPABASE = Boolean(supabase);
const state = {
    users: [],
    chats: [],
    schedules: [],
    initialized: false,
    syncPromise: null
};

function readStorage(key, fallback) {
    const defaultValue = fallback ?? [];
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    try {
        return JSON.parse(raw);
    } catch (error) {
        return defaultValue;
    }
}

function writeStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeUser(user) {
    return {
        username: String(user?.username || '').trim(),
        password: String(user?.password || ''),
        fullName: String(user?.fullName || user?.full_name || '').trim(),
        course: String(user?.course || '').trim(),
        email: String(user?.email || '').trim(),
        role: user?.username === 'admin' ? 'admin' : (user?.role || 'user'),
        subjects: Array.isArray(user?.subjects) ? user.subjects : [],
        selectedTopics: Array.isArray(user?.selectedTopics || user?.selected_topics)
            ? (user.selectedTopics || user.selected_topics)
            : [],
        subjectTopics: user?.subjectTopics || user?.subject_topics || {},
        subjectAvailabilities: user?.subjectAvailabilities || user?.subject_availabilities || {},
        profilePhoto: String(user?.profilePhoto || user?.profile_photo || ''),
        availability: user?.availability || ((user?.availability_start || user?.availability_end)
            ? {
                start: user.availability_start || null,
                end: user.availability_end || null
            }
            : null),
        createdAt: user?.createdAt || user?.created_at || new Date().toISOString()
    };
}

function toRemoteUser(user) {
    const normalized = normalizeUser(user);
    return {
        username: normalized.username,
        password: normalized.password,
        full_name: normalized.fullName,
        course: normalized.course,
        email: normalized.email,
        role: normalized.role,
        subjects: normalized.subjects,
        selected_topics: normalized.selectedTopics,
        subject_topics: normalized.subjectTopics,
        subject_availabilities: normalized.subjectAvailabilities,
        profile_photo: normalized.profilePhoto,
        availability_start: normalized.availability?.start || null,
        availability_end: normalized.availability?.end || null,
        created_at: normalized.createdAt
    };
}

function normalizeChat(chat) {
    return {
        id: String(chat?.id || generateId('chat')),
        matchId: String(chat?.matchId || chat?.match_id || ''),
        sender: String(chat?.sender || ''),
        content: String(chat?.content || ''),
        timestamp: chat?.timestamp || new Date().toISOString()
    };
}

function toRemoteChat(chat) {
    const normalized = normalizeChat(chat);
    return {
        id: normalized.id,
        match_id: normalized.matchId,
        sender: normalized.sender,
        content: normalized.content,
        timestamp: normalized.timestamp
    };
}

function normalizeSchedule(schedule) {
    return {
        id: String(schedule?.id || generateId('schedule')),
        user1: String(schedule?.user1 || ''),
        user2: String(schedule?.user2 || ''),
        time: schedule?.time || new Date().toISOString()
    };
}

function toRemoteSchedule(schedule) {
    const normalized = normalizeSchedule(schedule);
    return {
        id: normalized.id,
        user1: normalized.user1,
        user2: normalized.user2,
        time: normalized.time
    };
}

function persistCollectionsToCache() {
    writeStorage(STORAGE_KEYS.USERS, state.users);
    writeStorage(STORAGE_KEYS.CHATS, state.chats);
    writeStorage(STORAGE_KEYS.SCHEDULES, state.schedules);
}

function getLocalSeededUsers() {
    const users = readStorage(STORAGE_KEYS.USERS, []);
    if (users.some((user) => user.username === 'admin')) {
        return users.map(normalizeUser);
    }

    return [
        normalizeUser({
            username: 'admin',
            password: 'admin123',
            fullName: 'System Administrator',
            course: 'Administration',
            email: 'admin@studybuddy.local',
            role: 'admin',
            subjects: [],
            selectedTopics: [],
            subjectTopics: {},
            subjectAvailabilities: {},
            profilePhoto: '',
            availability: null
        }),
        ...users.map(normalizeUser)
    ];
}

async function ensureRemoteAdmin() {
    if (!USE_SUPABASE) return;

    const { error } = await supabase
        .from('users')
        .upsert({
            username: 'admin',
            password: 'admin123',
            full_name: 'System Administrator',
            course: 'Administration',
            email: 'admin@studybuddy.local',
            role: 'admin',
            subjects: [],
            selected_topics: [],
            subject_topics: {},
            subject_availabilities: {},
            profile_photo: '',
            availability_start: null,
            availability_end: null,
            created_at: new Date().toISOString()
        }, {
            onConflict: 'username'
        });

    if (error) {
        console.error('Unable to seed admin user.', error);
    }
}

async function refreshAllData() {
    if (state.syncPromise) {
        return state.syncPromise;
    }

    state.syncPromise = (async () => {
        if (!USE_SUPABASE) {
            state.users = getLocalSeededUsers();
            state.chats = readStorage(STORAGE_KEYS.CHATS, []).map(normalizeChat);
            state.schedules = readStorage(STORAGE_KEYS.SCHEDULES, []).map(normalizeSchedule);
            persistCollectionsToCache();
            state.initialized = true;
            return;
        }

        await ensureRemoteAdmin();

        const [usersResult, chatsResult, schedulesResult] = await Promise.all([
            supabase.from('users').select('*').order('created_at', { ascending: true }),
            supabase.from('chats').select('*').order('timestamp', { ascending: true }),
            supabase.from('schedules').select('*').order('time', { ascending: true })
        ]);

        if (usersResult.error) throw usersResult.error;
        if (chatsResult.error) throw chatsResult.error;
        if (schedulesResult.error) throw schedulesResult.error;

        state.users = (usersResult.data || []).map(normalizeUser);
        state.chats = (chatsResult.data || []).map(normalizeChat);
        state.schedules = (schedulesResult.data || []).map(normalizeSchedule);
        persistCollectionsToCache();
        state.initialized = true;
    })();

    try {
        await state.syncPromise;
    } finally {
        state.syncPromise = null;
    }
}

function getUsers() {
    return state.users.length ? state.users : getLocalSeededUsers();
}

async function saveUsers(users) {
    const normalizedUsers = users.map(normalizeUser);

    if (!USE_SUPABASE) {
        state.users = normalizedUsers;
        persistCollectionsToCache();
        return;
    }

    const previousUsernames = new Set((state.users || []).map((user) => user.username));
    const nextUsernames = new Set(normalizedUsers.map((user) => user.username));
    const removedUsernames = [...previousUsernames].filter((username) => !nextUsernames.has(username));

    if (removedUsernames.length) {
        const { error } = await supabase
            .from('users')
            .delete()
            .in('username', removedUsernames);
        if (error) throw error;
    }

    const { error } = await supabase
        .from('users')
        .upsert(normalizedUsers.map(toRemoteUser), { onConflict: 'username' });

    if (error) throw error;

    state.users = normalizedUsers;
    persistCollectionsToCache();
}

async function createUserAccount(userData) {
    const nextUser = normalizeUser({
        ...userData,
        role: 'user',
        subjects: [],
        selectedTopics: [],
        subjectTopics: {},
        subjectAvailabilities: {},
        profilePhoto: '',
        availability: null,
        createdAt: new Date().toISOString()
    });

    if (!USE_SUPABASE) {
        const existingUsers = getUsers();
        if (existingUsers.some((user) => user.username.toLowerCase() === nextUser.username.toLowerCase())) {
            return { ok: false, error: 'That username is already taken.' };
        }

        if (existingUsers.some((user) => String(user.email || '').toLowerCase() === nextUser.email.toLowerCase())) {
            return { ok: false, error: 'That email is already being used.' };
        }

        state.users = existingUsers.concat(nextUser);
        persistCollectionsToCache();
        return { ok: true, user: nextUser };
    }

    const [existingUsernameResult, existingEmailResult] = await Promise.all([
        supabase.from('users').select('username').eq('username', nextUser.username).maybeSingle(),
        supabase.from('users').select('email').eq('email', nextUser.email).maybeSingle()
    ]);

    if (existingUsernameResult.error) {
        console.error('Unable to check username availability.', existingUsernameResult.error);
        return { ok: false, error: existingUsernameResult.error.message || 'Unable to create account right now.' };
    }

    if (existingEmailResult.error) {
        console.error('Unable to check email availability.', existingEmailResult.error);
        return { ok: false, error: existingEmailResult.error.message || 'Unable to create account right now.' };
    }

    if (existingUsernameResult.data) {
        return { ok: false, error: 'That username is already taken.' };
    }

    if (existingEmailResult.data) {
        return { ok: false, error: 'That email is already being used.' };
    }

    const { error } = await supabase
        .from('users')
        .insert(toRemoteUser(nextUser));

    if (error) {
        console.error('Unable to create account in Supabase.', error);
        return { ok: false, error: error.message || 'Unable to create account right now.' };
    }

    state.users = getUsers().concat(nextUser);
    persistCollectionsToCache();
    return { ok: true, user: nextUser };
}

async function findUserByCredentials(username, password) {
    const loginValue = String(username || '').trim();
    const secret = String(password || '');

    if (!USE_SUPABASE) {
        return getUsers().find((user) => user.username === loginValue && user.password === secret) || null;
    }

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', loginValue)
        .eq('password', secret)
        .maybeSingle();

    if (error) {
        console.error('Unable to check login credentials.', error);
        return null;
    }

    return data ? normalizeUser(data) : null;
}

function getCurrentUser() {
    const username = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (!username) return null;
    return getUsers().find((user) => user.username === username) || null;
}

function saveCurrentUser(username) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, username);
}

function clearCurrentUser() {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
}

function getCurrentPage() {
    return document.body.dataset.page || 'auth';
}

function getHomePageForUser(user) {
    return user?.role === 'admin' ? 'admin_dashboard.html' : 'dashboard.html';
}

function requireAuth() {
    const user = getCurrentUser();
    if (user) return user;
    window.location.href = 'index.html';
    return null;
}

function enforceRoleAccess(user, page) {
    if (!user) return false;

    if (user.role === 'admin' && USER_PAGES.includes(page)) {
        window.location.href = 'admin_dashboard.html';
        return false;
    }

    if (user.role !== 'admin' && page === 'admin') {
        window.location.href = 'dashboard.html';
        return false;
    }

    return true;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getDisplayName(user) {
    const fullName = String(user?.fullName || '').trim();
    if (fullName) return fullName;
    return String(user?.username || 'Student').trim() || 'Student';
}

function getFirstName(user) {
    const displayName = getDisplayName(user);
    return displayName.split(/\s+/).filter(Boolean)[0] || 'Student';
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not set';
    return date.toLocaleString();
}

function getAvailabilityOverlap(a, b) {
    if (!a?.start || !a?.end || !b?.start || !b?.end) return false;
    const aStart = new Date(a.start);
    const aEnd = new Date(a.end);
    const bStart = new Date(b.start);
    const bEnd = new Date(b.end);
    return !(aEnd <= bStart || bEnd <= aStart);
}

function getSubjectAvailability(user, subject) {
    if (!user || !subject) return null;
    return user.subjectAvailabilities?.[subject] || user.availability || null;
}

function getSubjectTopics(user, subject) {
    if (!user || !subject) return [];

    const savedTopics = user.subjectTopics?.[subject];
    if (Array.isArray(savedTopics)) {
        return [...savedTopics];
    }

    return Array.isArray(user.selectedTopics)
        ? user.selectedTopics.filter((key) => key.startsWith(`${subject}::`))
        : [];
}

function flattenSubjectTopics(subjectTopics) {
    return Object.values(subjectTopics || {}).flatMap((topics) => Array.isArray(topics) ? topics : []);
}

function getMatchId(userA, userB) {
    return [userA, userB].sort().join('__');
}

function getRelatedSubjects(subject) {
    return Array.isArray(RELATED_SUBJECTS[subject]) ? RELATED_SUBJECTS[subject] : [];
}

function getChats() {
    return state.chats || [];
}

async function saveChats(chats) {
    const normalizedChats = chats.map(normalizeChat);

    if (!USE_SUPABASE) {
        state.chats = normalizedChats;
        persistCollectionsToCache();
        return;
    }

    const previousIds = new Set((state.chats || []).map((chat) => chat.id));
    const nextIds = new Set(normalizedChats.map((chat) => chat.id));
    const removedIds = [...previousIds].filter((id) => !nextIds.has(id));

    if (removedIds.length) {
        const { error } = await supabase
            .from('chats')
            .delete()
            .in('id', removedIds);
        if (error) throw error;
    }

    const { error } = await supabase
        .from('chats')
        .upsert(normalizedChats.map(toRemoteChat), { onConflict: 'id' });

    if (error) throw error;

    state.chats = normalizedChats;
    persistCollectionsToCache();
}

function getSchedules() {
    return state.schedules || [];
}

function rerenderCurrentPage() {
    const page = getCurrentPage();
    const user = getCurrentUser();
    const matchId = localStorage.getItem(STORAGE_KEYS.CURRENT_CHAT_MATCH);

    if (page === 'auth') return;
    if (!user && page !== 'admin') return;

    if (page === 'dashboard' && user) initDashboardPage(user);
    if (page === 'matches' && user) initMatchesPage(user);
    if (page === 'chat' && user && matchId) {
        const partner = getChatPartner(matchId, user);
        const partnerEl = document.getElementById('chat-partner');
        if (partner && partnerEl) {
            partnerEl.textContent = partner.fullName;
        }
        renderChatMessages(matchId, user);
    }
    if (page === 'admin') renderAdminDashboard();
}

async function handleRealtimeRefresh() {
    if (realtimeRefreshInFlight) {
        return realtimeRefreshInFlight;
    }

    realtimeRefreshInFlight = (async () => {
        try {
            await refreshAllData();
            rerenderCurrentPage();
        } catch (error) {
            console.error('Unable to apply realtime update.', error);
        }
    })();

    try {
        await realtimeRefreshInFlight;
    } finally {
        realtimeRefreshInFlight = null;
    }
}

function subscribeToRealtime() {
    if (!USE_SUPABASE || realtimeChannel) return;

    realtimeChannel = supabase
        .channel('studybuddy-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, handleRealtimeRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, handleRealtimeRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, handleRealtimeRefresh)
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                handleRealtimeRefresh();
            }
        });
}

async function saveSchedules(schedules) {
    const normalizedSchedules = schedules.map(normalizeSchedule);

    if (!USE_SUPABASE) {
        state.schedules = normalizedSchedules;
        persistCollectionsToCache();
        return;
    }

    const previousIds = new Set((state.schedules || []).map((schedule) => schedule.id));
    const nextIds = new Set(normalizedSchedules.map((schedule) => schedule.id));
    const removedIds = [...previousIds].filter((id) => !nextIds.has(id));

    if (removedIds.length) {
        const { error } = await supabase
            .from('schedules')
            .delete()
            .in('id', removedIds);
        if (error) throw error;
    }

    const { error } = await supabase
        .from('schedules')
        .upsert(normalizedSchedules.map(toRemoteSchedule), { onConflict: 'id' });

    if (error) throw error;

    state.schedules = normalizedSchedules;
    persistCollectionsToCache();
}

function getMatchesForUser(user, preferredSubject = '') {
    if (!user || user.role === 'admin') return [];

    return getUsers()
        .filter((other) => other.username !== user.username && other.role !== 'admin')
        .map((other) => {
            const userSubjects = Array.isArray(user.subjects) ? user.subjects : [];
            const otherSubjects = Array.isArray(other.subjects) ? other.subjects : [];
            const sharedSubjects = userSubjects.filter((subject) => (other.subjects || []).includes(subject));
            const relatedPreferredSubjects = preferredSubject
                ? otherSubjects.filter((subject) => getRelatedSubjects(preferredSubject).includes(subject))
                : [];
            const subjectTopicDetails = Object.fromEntries(sharedSubjects.map((subject) => {
                const yourTopics = getSubjectTopics(user, subject).map((item) => item.split('::')[1]).filter(Boolean);
                const partnerTopics = getSubjectTopics(other, subject).map((item) => item.split('::')[1]).filter(Boolean);
                const sharedTopics = yourTopics.filter((topic) => partnerTopics.includes(topic));
                const hasAvailabilityOverlap = getAvailabilityOverlap(getSubjectAvailability(user, subject), getSubjectAvailability(other, subject));

                return [subject, {
                    yourTopics,
                    partnerTopics,
                    sharedTopics,
                    hasAvailabilityOverlap
                }];
            }));
            const availableSubjects = [...otherSubjects];
            const prioritizedSubjects = [
                ...new Set([
                    ...(preferredSubject && availableSubjects.includes(preferredSubject) ? [preferredSubject] : []),
                    ...relatedPreferredSubjects,
                    ...sharedSubjects,
                    ...availableSubjects
                ])
            ];
            const priorityScore = preferredSubject && availableSubjects.includes(preferredSubject) ? 100 : 0;
            const relatedScore = preferredSubject && !availableSubjects.includes(preferredSubject) && relatedPreferredSubjects.length
                ? 50 + (relatedPreferredSubjects.length * 5)
                : 0;
            const sharedScore = sharedSubjects.length * 10;
            const overlapScore = sharedSubjects.filter((subject) => subjectTopicDetails[subject]?.hasAvailabilityOverlap).length * 2;

            return {
                id: getMatchId(user.username, other.username),
                otherUser: other,
                commonSubjects: sharedSubjects,
                availableSubjects,
                prioritizedSubjects,
                relatedPreferredSubjects,
                subjectTopicDetails,
                hasPreferredSubject: Boolean(preferredSubject && availableSubjects.includes(preferredSubject)),
                hasRelatedPreferredSubject: Boolean(preferredSubject && !availableSubjects.includes(preferredSubject) && relatedPreferredSubjects.length),
                preferredSubjectLabel: preferredSubject && availableSubjects.includes(preferredSubject)
                    ? `${preferredSubject} was uploaded by this user.`
                    : '',
                score: priorityScore + relatedScore + sharedScore + overlapScore
            };
        })
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return getDisplayName(left.otherUser).localeCompare(getDisplayName(right.otherUser));
        });
}

function showFeedback(message, type = 'error') {
    const feedback = document.getElementById('error-msg');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = `feedback ${type}`;
}

function clearFeedback() {
    const feedback = document.getElementById('error-msg');
    if (!feedback) return;
    feedback.textContent = '';
    feedback.className = 'feedback';
}

function setButtonBusy(button, isBusy, busyLabel, idleLabel) {
    if (!button) return;
    button.disabled = isBusy;
    button.textContent = isBusy ? busyLabel : idleLabel;
}

function setAuthMode(mode) {
    authMode = mode;
    const isSignup = mode === 'signup';
    const modeNote = document.getElementById('auth-mode-note');

    document.querySelectorAll('.auth-extra').forEach((group) => {
        group.classList.toggle('is-hidden', !isSignup);
        const input = group.querySelector('input');
        if (input) input.required = isSignup;
    });

    document.getElementById('form-title').textContent = isSignup ? 'Create your account' : 'Login';
    document.getElementById('submit-btn').textContent = isSignup ? 'Create Account' : 'Login';
    document.getElementById('toggle-form').textContent = isSignup ? 'Back to login' : 'Create a new account';
    if (modeNote) {
        modeNote.textContent = isSignup
            ? 'Fill in your student details to create a new account.'
            : 'Use your username and password to continue.';
    }
    clearFeedback();
}

function initAuthPage() {
    const currentUser = getCurrentUser();
    const authForm = document.getElementById('auth-form');
    const submitBtn = document.getElementById('submit-btn');
    const toggleBtn = document.getElementById('toggle-form');
    let authBusy = false;

    document.getElementById('toggle-form')?.addEventListener('click', () => {
        setAuthMode(authMode === 'login' ? 'signup' : 'login');
    });

    authForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (authBusy) return;

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            showFeedback('Please complete your username and password.');
            return;
        }

        authBusy = true;
        setButtonBusy(submitBtn, true, authMode === 'signup' ? 'Creating Account...' : 'Checking...', authMode === 'signup' ? 'Create Account' : 'Login');
        if (toggleBtn) toggleBtn.disabled = true;

        if (authMode === 'signup') {
            const fullName = document.getElementById('name').value.trim();
            const course = document.getElementById('course').value.trim();
            const email = document.getElementById('email').value.trim();

            if (!fullName || !course || !email) {
                showFeedback('Please complete all signup fields.');
                authBusy = false;
                setButtonBusy(submitBtn, false, '', 'Create Account');
                if (toggleBtn) toggleBtn.disabled = false;
                return;
            }

            const result = await createUserAccount({
                username,
                password,
                fullName,
                course,
                email
            });

            if (!result.ok) {
                showFeedback(result.error || 'Unable to create account right now. Please try again.');
                authBusy = false;
                setButtonBusy(submitBtn, false, '', 'Create Account');
                if (toggleBtn) toggleBtn.disabled = false;
                return;
            }
            saveCurrentUser(username);
            window.location.href = 'dashboard.html';
            return;
        }

        const user = await findUserByCredentials(username, password);
        if (!user) {
            showFeedback('Invalid username or password.');
            authBusy = false;
            setButtonBusy(submitBtn, false, '', 'Login');
            if (toggleBtn) toggleBtn.disabled = false;
            return;
        }

        state.users = getUsers()
            .filter((item) => item.username !== user.username)
            .concat(user);
        persistCollectionsToCache();
        saveCurrentUser(user.username);
        window.location.href = getHomePageForUser(user);
    });

    setAuthMode('login');

    if (currentUser) {
        showFeedback(`Signed in as ${getDisplayName(currentUser)}. You can still log in with another account or create a new one here.`, 'success');
    }
}

function initCommonPage(user) {
    if (!user) return null;
    if (!enforceRoleAccess(user, getCurrentPage())) return null;
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    initDarkMode();
    highlightActiveNav();
    return user;
}

function highlightActiveNav() {
    const page = getCurrentPage();
    document.querySelectorAll('[data-nav]').forEach((link) => {
        const active = link.dataset.nav === page;
        link.classList.toggle('active', active);
        if (active) {
            link.setAttribute('aria-current', 'page');
        }
    });
}

function initDarkMode() {
    const toggle = document.getElementById('dark-toggle');
    if (!toggle) return;

    const isDark = localStorage.getItem(STORAGE_KEYS.DARK_MODE) === 'true';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    toggle.textContent = isDark ? 'Light' : 'Dark';

    toggle.addEventListener('click', () => {
        const dark = document.documentElement.dataset.theme === 'dark';
        document.documentElement.dataset.theme = dark ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEYS.DARK_MODE, String(!dark));
        toggle.textContent = dark ? 'Dark' : 'Light';
    });
}

function logout() {
    clearCurrentUser();
    localStorage.removeItem(STORAGE_KEYS.CURRENT_CHAT_MATCH);
    localStorage.removeItem(STORAGE_KEYS.SCHEDULE_WITH_USER);
    if (chatPollId) clearInterval(chatPollId);
    window.location.href = 'index.html';
}

function initDashboardPage(user) {
    const matches = getMatchesForUser(user);
    const schedules = getSchedules().filter((item) => item.user1 === user.username || item.user2 === user.username);
    const unread = getChats().filter((chat) => chat.matchId.includes(user.username) && chat.sender !== user.username).length;
    const infoParts = [];
    const userNameEl = document.getElementById('user-name');
    const userInfoEl = document.getElementById('user-info');
    const matchesCountEl = document.getElementById('matches-count');
    const schedulesCountEl = document.getElementById('schedules-count');
    const unreadCountEl = document.getElementById('unread-count');
    const summary = document.getElementById('dashboard-summary');
    const firstName = getFirstName(user);

    if (user.course) infoParts.push(user.course);
    if (user.subjects?.length) infoParts.push(`${user.subjects.length} subjects selected`);

    if (userNameEl) {
        userNameEl.textContent = firstName;
    }
    if (userInfoEl) {
        userInfoEl.textContent = infoParts.join(' | ') || 'Complete your subjects and availability to start matching.';
    }
    if (matchesCountEl) {
        matchesCountEl.textContent = String(matches.length);
    }
    if (schedulesCountEl) {
        schedulesCountEl.textContent = String(schedules.length);
    }
    if (unreadCountEl) {
        unreadCountEl.textContent = String(unread);
    }

    if (!summary) {
        return;
    }

    if (!user.subjects?.length || !user.availability) {
        summary.innerHTML = '<p>Add your subjects and availability so the app can match you with other students.</p>';
    } else if (!matches.length) {
        summary.innerHTML = '<p>No matches yet. Keep your schedule updated and check back when more students join.</p>';
    } else {
        summary.innerHTML = `<p>You currently have <strong>${matches.length}</strong> match${matches.length === 1 ? '' : 'es'}.</p><p>Your top current match is <strong>${escapeHtml(getDisplayName(matches[0].otherUser))}</strong>.</p>`;
    }
}

function initSubjectsPage(user) {
    const select = document.getElementById('subjects-select');
    const topicsContainer = document.getElementById('subject-topics');
    const topicsSelectionNote = document.getElementById('topics-selection-note');
    const subjectsSubmitBtn = document.querySelector('#subjects-form button[type="submit"]');
    const selectedTopicInput = document.getElementById('selected-topic-key');
    const savedSubjects = Array.isArray(user.subjects) ? user.subjects : [];
    const subjectTopics = { ...(user.subjectTopics || {}) };
    const pageParams = new URLSearchParams(window.location.search);
    const wantsNewSubject = pageParams.get('mode') === 'new';
    let subjectsBusy = false;

    if (!select) return;
    if (!select.options.length || select.options.length === 1) {
        select.innerHTML = `<option value="">Choose a subject</option>${SUBJECTS.map((subject) => `<option value="${subject}">${subject}</option>`).join('')}`;
    }

    localStorage.removeItem(STORAGE_KEYS.CURRENT_MATCH_SUBJECT);
    const lastActiveSubject = savedSubjects[savedSubjects.length - 1] || '';
    const initialSubject = wantsNewSubject
        ? SUBJECTS.find((subject) => !savedSubjects.includes(subject))
            || SUBJECTS.find((subject) => subject !== lastActiveSubject)
            || lastActiveSubject
            || SUBJECTS[0]
        : lastActiveSubject || SUBJECTS[0];

    if (initialSubject && Array.from(select.options).some((option) => option.value === initialSubject)) {
        select.value = initialSubject;
    }

    function getSelectedSubject() {
        return select.value ? [select.value] : [];
    }

    function getCurrentTopicKeys() {
        const fallbackKey = String(selectedTopicInput?.value || '').trim();
        if (fallbackKey) {
            return [fallbackKey];
        }
        return getSubjectTopics({ ...user, subjectTopics }, select.value);
    }

    function syncAvailabilityInputs() {
        const subject = select.value;
        const availability = getSubjectAvailability(user, subject);
        document.getElementById('availability-start').value = availability?.start || '';
        document.getElementById('availability-end').value = availability?.end || '';
    }

    function renderSubjectTopics() {
        if (!topicsContainer) return;
        const selectedSubjects = getSelectedSubject();
        const selectedTopicKeys = getCurrentTopicKeys();

        if (!selectedSubjects.length) {
            topicsContainer.className = 'topics-empty-state';
            topicsContainer.innerHTML = 'Select a subject to view suggested topics you can study together.';
            if (topicsSelectionNote) {
                topicsSelectionNote.textContent = 'Tap a topic to mark what you want to study together.';
            }
            return;
        }

        topicsContainer.className = 'topics-grid';
        topicsContainer.innerHTML = selectedSubjects.map((subject) => {
            const topics = SUBJECT_TOPICS[subject] || ['General review', 'Practice questions', 'Group discussion'];
            return `
                <article class="topic-card">
                    <h3>${escapeHtml(subject)}</h3>
                    <div class="topic-chip-list">
                        ${topics.map((topic) => {
                            const key = `${subject}::${topic}`;
                            const isSelected = selectedTopicKeys.includes(key);
                            return `<button type="button" class="topic-chip ${isSelected ? 'is-selected' : ''}" data-topic-key="${escapeHtml(key)}" aria-pressed="${isSelected ? 'true' : 'false'}">${escapeHtml(topic)}</button>`;
                        }).join('')}
                    </div>
                </article>
            `;
        }).join('');

        if (topicsSelectionNote) {
            topicsSelectionNote.textContent = selectedTopicKeys.length
                ? `${selectedTopicKeys.length} topic${selectedTopicKeys.length === 1 ? '' : 's'} selected for study.`
                : 'Tap a topic to mark what you want to study together.';
        }
    }

    function syncSubjectsUi() {
        renderSubjectTopics();
        syncAvailabilityInputs();
    }

    window.renderStudyBuddySubjectTopics = syncSubjectsUi;

    select.addEventListener('change', syncSubjectsUi);
    select.addEventListener('input', syncSubjectsUi);
    topicsContainer?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-topic-key]');
        if (!button) return;

        const key = button.dataset.topicKey;
        if (!key) return;

        let selectedTopicKeys = getCurrentTopicKeys();
        if (selectedTopicKeys.includes(key)) {
            selectedTopicKeys = [];
        } else {
            selectedTopicKeys = [key];
        }

        subjectTopics[select.value] = selectedTopicKeys;
        if (selectedTopicInput) {
            selectedTopicInput.value = selectedTopicKeys[0] || '';
        }
        renderSubjectTopics();
    });
    syncSubjectsUi();

    document.getElementById('subjects-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (subjectsBusy) return;

        const subjects = getSelectedSubject();
        const start = document.getElementById('availability-start').value;
        const end = document.getElementById('availability-end').value;

        if (!subjects.length) {
            window.alert('Select at least one subject.');
            return;
        }

        if (!start || !end || new Date(start) >= new Date(end)) {
            window.alert('Please choose a valid availability range.');
            return;
        }

        if (getCurrentTopicKeys().length !== 1) {
            window.alert('Please select exactly one topic for this subject.');
            return;
        }

        if (subjectsSubmitBtn && !subjectsSubmitBtn.dataset.defaultLabel) {
            subjectsSubmitBtn.dataset.defaultLabel = subjectsSubmitBtn.textContent;
        }
        subjectsBusy = true;
        setButtonBusy(subjectsSubmitBtn, true, 'Saving...', subjectsSubmitBtn?.dataset.defaultLabel || 'Save Subject');

        try {
            await refreshAllData();
        } catch (error) {
            console.error('Unable to refresh users before saving subject setup.', error);
        }

        const users = getUsers();
        const index = users.findIndex((item) => item.username === user.username);
        if (index === -1) {
            subjectsBusy = false;
            setButtonBusy(subjectsSubmitBtn, false, '', subjectsSubmitBtn?.dataset.defaultLabel || 'Save Subject');
            return;
        }

        const selectedSubject = subjects[0];
        const mergedSubjects = Array.from(new Set([...(users[index].subjects || []), selectedSubject]));
        const updatedSubjectAvailabilities = {
            ...(users[index].subjectAvailabilities || {}),
            [selectedSubject]: { start, end }
        };
        const updatedSubjectTopics = {
            ...(users[index].subjectTopics || {}),
            [selectedSubject]: getCurrentTopicKeys()
        };

        users[index] = {
            ...users[index],
            subjects: mergedSubjects,
            selectedTopics: flattenSubjectTopics(updatedSubjectTopics),
            subjectTopics: updatedSubjectTopics,
            subjectAvailabilities: updatedSubjectAvailabilities,
            availability: { start, end }
        };
        try {
            await saveUsers(users);
        } catch (error) {
            console.error('Unable to save subjects.', error);
            window.alert('Unable to save your subject setup right now. Please try again.');
            subjectsBusy = false;
            setButtonBusy(subjectsSubmitBtn, false, '', subjectsSubmitBtn?.dataset.defaultLabel || 'Save Subject');
            return;
        }
        window.location.href = `matches.html?subject=${encodeURIComponent(selectedSubject)}`;
    });
}

function renderMatches(matches, options = {}) {
    const container = document.getElementById('matches-list');
    if (!container) return;

    const title = options.title ? `<h2 class="match-group-title">${escapeHtml(options.title)}</h2>` : '';

    if (!matches.length) {
        container.innerHTML = `${title}<div class="empty-state">No matches yet. Add your subjects and availability first.</div>`;
        return;
    }

    container.innerHTML = `${title}${buildMatchCardsHtml(matches)}`;
    bindMatchCardActions(container);
}

function buildMatchCardsHtml(matches) {
    return matches.map((match) => `
        <article class="match-card">
            <h3>${escapeHtml(match.otherUser.fullName)}</h3>
            <p><strong>Course:</strong> ${escapeHtml(match.otherUser.course || 'Not set')}</p>
            <p><strong>Uploaded subjects:</strong> ${match.availableSubjects.length ? escapeHtml(match.availableSubjects.join(', ')) : 'No uploaded subjects yet'}</p>
            ${match.hasPreferredSubject
                ? `<p><strong>Same subject match:</strong> ${escapeHtml(match.preferredSubjectLabel)}</p>`
                : match.hasRelatedPreferredSubject
                    ? `<p><strong>Related uploaded subject:</strong> ${escapeHtml((match.relatedPreferredSubjects || []).join(', '))}</p>`
                    : ''}
            <p><strong>Shared subjects:</strong> ${match.commonSubjects.length ? escapeHtml(match.commonSubjects.join(', ')) : 'None yet'}</p>
            <p><strong>Available subjects to study:</strong> ${escapeHtml((match.prioritizedSubjects || match.availableSubjects || []).join(', '))}</p>
            ${match.commonSubjects.map((subject) => {
                const details = match.subjectTopicDetails?.[subject];
                if (!details) return '';

                const sharedTopics = details.sharedTopics?.length
                    ? `<p><strong>Shared topics:</strong> ${escapeHtml(details.sharedTopics.join(', '))}</p>`
                    : '';
                const overlapNote = details.hasAvailabilityOverlap
                    ? '<p><strong>Availability:</strong> Time window overlaps.</p>'
                    : '<p><strong>Availability:</strong> No overlap yet.</p>';
                const yourTopics = details.yourTopics?.length
                    ? `<p><strong>Your topics:</strong> ${escapeHtml(details.yourTopics.join(', '))}</p>`
                    : '<p><strong>Your topics:</strong> No topics selected yet.</p>';
                const partnerTopics = details.partnerTopics?.length
                    ? `<p><strong>Partner topics:</strong> ${escapeHtml(details.partnerTopics.join(', '))}</p>`
                    : '<p><strong>Partner topics:</strong> No topics selected yet.</p>';

                return `
                    <div class="match-topic-panel">
                        <p class="match-topic-subject">${escapeHtml(subject)}</p>
                        ${sharedTopics}
                        ${overlapNote}
                        ${yourTopics}
                        ${partnerTopics}
                    </div>
                `;
            }).join('')}
            <div class="action-row">
                <button type="button" class="connect-btn" data-chat-id="${match.id}">Chat</button>
                <button type="button" class="secondary-btn compact-btn" data-schedule-user="${match.otherUser.username}">Schedule</button>
            </div>
        </article>
    `).join('');
}

function bindMatchCardActions(container) {
    container.querySelectorAll('[data-chat-id]').forEach((button) => {
        button.addEventListener('click', () => openChat(button.dataset.chatId));
    });

    container.querySelectorAll('[data-schedule-user]').forEach((button) => {
        button.addEventListener('click', () => {
            localStorage.setItem(STORAGE_KEYS.SCHEDULE_WITH_USER, button.dataset.scheduleUser);
            window.location.href = 'schedule.html';
        });
    });
}

function initMatchesPage(user) {
    const subjectNote = document.getElementById('match-subject-note');
    const params = new URLSearchParams(window.location.search);
    const activeMatchSubject = params.get('subject') || '';

    function computeMatches() {
        const activeUser = getCurrentUser() || user;
        renderedMatches = getMatchesForUser(activeUser, activeMatchSubject);
    }

    computeMatches();
    if (subjectNote) {
        subjectNote.textContent = activeMatchSubject
            ? 'Showing exact subject matches first, then related subjects, then other active users.'
            : 'Showing all users who uploaded subjects for study matching.';
    }

    function renderFilteredMatches() {
        const container = document.getElementById('matches-list');
        if (!container) return;
        const filteredMatches = renderedMatches;

        if (!filteredMatches.length) {
            renderMatches([], { title: '' });
            return;
        }

        const prioritizedMatches = activeMatchSubject
            ? filteredMatches.filter((match) => match.hasPreferredSubject)
            : filteredMatches;
        const relatedMatches = activeMatchSubject
            ? filteredMatches.filter((match) => !match.hasPreferredSubject && match.hasRelatedPreferredSubject)
            : [];
        const otherMatches = activeMatchSubject
            ? filteredMatches.filter((match) => !match.hasPreferredSubject && !match.hasRelatedPreferredSubject)
            : [];

        const sections = [
            activeMatchSubject ? `
                <section class="match-group is-active-match-group">
                    <div class="match-group-header">
                        <h2 class="match-group-title">Exact Subject Matches</h2>
                        <span class="match-group-count">${prioritizedMatches.length} user${prioritizedMatches.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="list-grid">
                        ${prioritizedMatches.length ? buildMatchCardsHtml(prioritizedMatches) : '<div class="empty-state">No users uploaded this subject yet.</div>'}
                    </div>
                </section>
            ` : '',
            activeMatchSubject ? `
                <section class="match-group">
                    <div class="match-group-header">
                        <h2 class="match-group-title">Related Subject Matches</h2>
                        <span class="match-group-count">${relatedMatches.length} user${relatedMatches.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="list-grid">
                        ${relatedMatches.length ? buildMatchCardsHtml(relatedMatches) : '<div class="empty-state">No users uploaded related subjects yet.</div>'}
                    </div>
                </section>
            ` : '',
            `
                <section class="match-group ${!activeMatchSubject ? 'is-active-match-group' : ''}">
                    <div class="match-group-header">
                        <h2 class="match-group-title">${activeMatchSubject ? 'Other Active Users' : 'All Active Users'}</h2>
                        <span class="match-group-count">${(activeMatchSubject ? otherMatches : filteredMatches).length} user${(activeMatchSubject ? otherMatches : filteredMatches).length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="list-grid">
                        ${(activeMatchSubject ? otherMatches : filteredMatches).length ? buildMatchCardsHtml(activeMatchSubject ? otherMatches : filteredMatches) : '<div class="empty-state">No other users available right now.</div>'}
                    </div>
                </section>
            `
        ].join('');

        container.innerHTML = sections;
        bindMatchCardActions(container);
    }

    renderFilteredMatches();

    refreshAllData()
        .then(() => {
            computeMatches();
            renderFilteredMatches();
        })
        .catch((error) => {
            console.error('Unable to refresh matches.', error);
        });
}

function initSchedulePage(user) {
    const select = document.getElementById('schedule-match');
    const partnersContainer = document.getElementById('schedule-partners');
    const partnerNote = document.getElementById('schedule-partner-note');
    const timeGroup = document.getElementById('schedule-time-group');
    const timeInput = document.getElementById('schedule-time');
    const submitButton = document.getElementById('schedule-submit-btn');
    const allMatches = getMatchesForUser(user);
    let editingScheduleId = '';
    let editingPartnerUsername = '';
    let scheduleBusy = false;

    function getPartnerUsernameFromSchedule(schedule) {
        return schedule.user1 === user.username ? schedule.user2 : schedule.user1;
    }

    function getUserSchedules() {
        return getSchedules()
            .filter((item) => item.user1 === user.username || item.user2 === user.username)
            .sort((left, right) => new Date(left.time) - new Date(right.time));
    }

    function getAvailableMatches() {
        const scheduledPartners = new Set(getUserSchedules().map(getPartnerUsernameFromSchedule));
        return allMatches.filter((match) => !scheduledPartners.has(match.otherUser.username));
    }

    function syncPartnerOptions() {
        const availableMatches = getAvailableMatches();
        const currentValue = editingScheduleId ? editingPartnerUsername : '';
        select.innerHTML = availableMatches.length
            ? `<option value="">Choose a study partner</option>${availableMatches.map((match) => `<option value="${match.otherUser.username}">${escapeHtml(match.otherUser.fullName)}</option>`).join('')}`
            : '<option value="">No matches available</option>';
        select.value = currentValue && Array.from(select.options).some((option) => option.value === currentValue)
            ? currentValue
            : '';
    }

    function syncScheduleFields() {
        const hasPartner = Boolean(select.value || editingScheduleId);
        if (timeGroup) {
            timeGroup.classList.toggle('is-hidden', !hasPartner);
        }
        if (submitButton) {
            submitButton.classList.toggle('is-hidden', !hasPartner);
            submitButton.disabled = !hasPartner;
            submitButton.textContent = editingScheduleId ? 'Update Schedule' : 'Save Schedule';
        }
        if (timeInput) {
            timeInput.disabled = !hasPartner;
            timeInput.required = hasPartner;
        }
        if (!hasPartner && timeInput) {
            timeInput.value = '';
        }
    }

    function renderSchedulePartners() {
        const matches = getAvailableMatches();
        if (!partnersContainer) return;

        if (!matches.length) {
            partnersContainer.innerHTML = '<div class="empty-state">No unscheduled matched users available right now.</div>';
            if (partnerNote) {
                partnerNote.textContent = editingScheduleId
                    ? `Editing schedule with ${editingPartnerUsername}.`
                    : 'All current matched users are already scheduled. Use Edit Schedule below or find new matches.';
            }
            syncScheduleFields();
            return;
        }

        partnersContainer.innerHTML = matches.map((match) => {
            const isSelected = select.value === match.otherUser.username;
            return `
                <button
                    type="button"
                    class="schedule-partner-card ${isSelected ? 'is-selected' : ''}"
                    data-schedule-partner="${match.otherUser.username}"
                    aria-pressed="${isSelected ? 'true' : 'false'}"
                >
                    <strong>${escapeHtml(getDisplayName(match.otherUser))}</strong>
                    <span>${escapeHtml(match.otherUser.course || 'Course not set')}</span>
                    <span>Common subject${match.commonSubjects.length === 1 ? '' : 's'}: ${escapeHtml(match.commonSubjects.join(', '))}</span>
                </button>
            `;
        }).join('');

        if (partnerNote) {
            if (editingScheduleId) {
                const editingMatch = allMatches.find((match) => match.otherUser.username === editingPartnerUsername);
                partnerNote.textContent = editingMatch
                    ? `Editing schedule with ${getDisplayName(editingMatch.otherUser)}.`
                    : 'Editing an existing schedule.';
            } else {
                const selectedMatch = matches.find((match) => match.otherUser.username === select.value);
                partnerNote.textContent = selectedMatch
                    ? `Scheduling with ${getDisplayName(selectedMatch.otherUser)}.`
                    : 'Choose one matched user from the list above before setting the schedule.';
            }
        }
        syncScheduleFields();
    }

    partnersContainer?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-schedule-partner]');
        if (!button) return;

        editingScheduleId = '';
        editingPartnerUsername = '';
        if (timeInput) {
            timeInput.value = '';
        }
        select.value = button.dataset.schedulePartner || '';
        renderSchedulePartners();
    });

    document.getElementById('schedules-list')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-edit-schedule-id]');
        if (!button) return;

        const schedules = getUserSchedules();
        const schedule = schedules.find((item) => item.id === button.dataset.editScheduleId);
        if (!schedule) return;

        editingScheduleId = schedule.id;
        editingPartnerUsername = getPartnerUsernameFromSchedule(schedule);
        select.value = '';
        if (timeInput) {
            timeInput.value = schedule.time || '';
        }
        renderSchedulePartners();
    });

    syncPartnerOptions();
    renderSchedulePartners();

    document.getElementById('schedule-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (scheduleBusy) return;

        const partner = editingScheduleId ? editingPartnerUsername : select.value;
        const time = document.getElementById('schedule-time').value;
        if (!partner || !time) return;

        if (submitButton && !submitButton.dataset.defaultLabel) {
            submitButton.dataset.defaultLabel = submitButton.textContent || 'Save Schedule';
        }
        scheduleBusy = true;
        setButtonBusy(submitButton, true, editingScheduleId ? 'Updating...' : 'Saving...', submitButton?.dataset.defaultLabel || 'Save Schedule');

        try {
            await refreshAllData();
        } catch (error) {
            console.error('Unable to refresh schedules before saving.', error);
        }

        const schedules = getSchedules();
        if (editingScheduleId) {
            const scheduleIndex = schedules.findIndex((item) => item.id === editingScheduleId);
            if (scheduleIndex === -1) {
                scheduleBusy = false;
                setButtonBusy(submitButton, false, '', submitButton?.dataset.defaultLabel || 'Save Schedule');
                return;
            }
            schedules[scheduleIndex] = { ...schedules[scheduleIndex], time };
        } else {
            schedules.push({ id: `schedule-${Date.now()}`, user1: user.username, user2: partner, time });
        }
        try {
            await saveSchedules(schedules);
        } catch (error) {
            console.error('Unable to save schedule.', error);
            window.alert('Unable to save this schedule right now. Please try again.');
            scheduleBusy = false;
            setButtonBusy(submitButton, false, '', submitButton?.dataset.defaultLabel || 'Save Schedule');
            return;
        }
        editingScheduleId = '';
        editingPartnerUsername = '';
        syncPartnerOptions();
        select.value = '';
        localStorage.removeItem(STORAGE_KEYS.SCHEDULE_WITH_USER);
        document.getElementById('schedule-time').value = '';
        scheduleBusy = false;
        setButtonBusy(submitButton, false, '', submitButton?.dataset.defaultLabel || 'Save Schedule');
        renderSchedulePartners();
        renderSchedules(user);
    });

    renderSchedules(user);
}

function renderSchedules(user) {
    const container = document.getElementById('schedules-list');
    if (!container) return;

    const schedules = getSchedules()
        .filter((item) => item.user1 === user.username || item.user2 === user.username)
        .sort((left, right) => new Date(left.time) - new Date(right.time));

    container.innerHTML = schedules.length
        ? schedules.map((schedule) => {
            const partnerUsername = schedule.user1 === user.username ? schedule.user2 : schedule.user1;
            const partner = getUsers().find((item) => item.username === partnerUsername);
            return `<article class="match-card"><h3>${escapeHtml(partner?.fullName || partnerUsername)}</h3><p><strong>Time:</strong> ${escapeHtml(formatDateTime(schedule.time))}</p><div class="action-row"><button type="button" class="secondary-btn compact-btn" data-edit-schedule-id="${schedule.id}">Edit Schedule</button></div></article>`;
        }).join('')
        : '<div class="empty-state">No sessions scheduled yet.</div>';
}

function initProfilePage(user) {
    const photoImage = document.getElementById('profile-photo-image');
    const photoFallback = document.getElementById('profile-photo-fallback');
    const photoInput = document.getElementById('profile-photo-input');

    function renderProfilePhoto(photoValue) {
        const hasPhoto = typeof photoValue === 'string' && photoValue.startsWith('data:image');
        if (photoImage) {
            photoImage.hidden = !hasPhoto;
            if (hasPhoto) {
                photoImage.src = photoValue;
            } else {
                photoImage.removeAttribute('src');
            }
        }
        if (photoFallback) {
            photoFallback.hidden = hasPhoto;
        }
    }

    renderProfilePhoto(user.profilePhoto || '');

    document.getElementById('profile-info').innerHTML = `
        <p><strong>Name:</strong> ${escapeHtml(user.fullName)}</p>
        <p><strong>Course:</strong> ${escapeHtml(user.course || 'Not set')}</p>
        <p><strong>Email:</strong> ${escapeHtml(user.email || 'Not set')}</p>
        <p><strong>Username:</strong> ${escapeHtml(user.username)}</p>
    `;

    document.getElementById('profile-subjects').innerHTML = user.subjects?.length
        ? user.subjects.map((subject) => `<span class="tag">${escapeHtml(subject)}</span>`).join('')
        : '<p class="empty-state">No subjects selected yet.</p>';

    const subjectAvailabilityEntries = Object.entries(user.subjectAvailabilities || {});
    document.getElementById('profile-availability').innerHTML = subjectAvailabilityEntries.length
        ? subjectAvailabilityEntries.map(([subject, availability]) => `
            <article class="match-card">
                <h3>${escapeHtml(subject)}</h3>
                <p><strong>Start:</strong> ${escapeHtml(formatDateTime(availability.start))}</p>
                <p><strong>End:</strong> ${escapeHtml(formatDateTime(availability.end))}</p>
            </article>
        `).join('')
        : (user.availability
            ? `<p><strong>Start:</strong> ${escapeHtml(formatDateTime(user.availability.start))}</p><p><strong>End:</strong> ${escapeHtml(formatDateTime(user.availability.end))}</p>`
            : '<p class="empty-state">No availability set yet.</p>');

    photoInput?.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = async () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            try {
                await refreshAllData();
            } catch (error) {
                console.error('Unable to refresh users before saving profile photo.', error);
            }
            const users = getUsers();
            const index = users.findIndex((item) => item.username === user.username);
            if (index === -1 || !result) return;

            users[index] = { ...users[index], profilePhoto: result };
            try {
                await saveUsers(users);
            } catch (error) {
                console.error('Unable to save profile photo.', error);
                window.alert('Unable to save your profile photo right now.');
                return;
            }
            renderProfilePhoto(result);
        };
        reader.readAsDataURL(file);
    });
}

function openChat(matchId) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_CHAT_MATCH, matchId);
    window.location.href = 'chat.html';
}

function getChatPartner(matchId, user) {
    const [userA, userB] = matchId.split('__');
    const partnerUsername = user.username === userA ? userB : userA;
    return getUsers().find((item) => item.username === partnerUsername) || null;
}

function renderChatMessages(matchId, user) {
    const container = document.getElementById('messages-container');
    if (!container) return;

    const messages = getChats()
        .filter((chat) => chat.matchId === matchId)
        .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));

    container.innerHTML = messages.length
        ? messages.map((message) => {
            const cls = message.sender === user.username ? 'sent' : 'received';
            return `<div class="message ${cls}"><strong>${escapeHtml(message.sender)}</strong><p>${escapeHtml(message.content)}</p><small>${escapeHtml(formatDateTime(message.timestamp))}</small></div>`;
        }).join('')
        : '<div class="empty-state">No messages yet. Start the conversation.</div>';

    container.scrollTop = container.scrollHeight;
}

function initChatPage(user) {
    const matchId = localStorage.getItem(STORAGE_KEYS.CURRENT_CHAT_MATCH);
    if (!matchId) {
        window.location.href = 'matches.html';
        return;
    }

    const partner = getChatPartner(matchId, user);
    if (!partner) {
        window.location.href = 'matches.html';
        return;
    }

    document.getElementById('chat-partner').textContent = partner.fullName;
    document.getElementById('back-to-matches')?.addEventListener('click', () => {
        window.location.href = 'matches.html';
    });

    const messageSubmitBtn = document.querySelector('#message-form button[type="submit"]');
    let messageBusy = false;

    document.getElementById('message-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (messageBusy) return;

        const input = document.getElementById('message-input');
        const content = input.value.trim();
        if (!content) return;

        if (messageSubmitBtn && !messageSubmitBtn.dataset.defaultLabel) {
            messageSubmitBtn.dataset.defaultLabel = messageSubmitBtn.textContent || 'Send';
        }
        messageBusy = true;
        setButtonBusy(messageSubmitBtn, true, 'Sending...', messageSubmitBtn?.dataset.defaultLabel || 'Send');
        input.disabled = true;

        try {
            await refreshAllData();
        } catch (error) {
            console.error('Unable to refresh chats before sending message.', error);
        }

        const chats = getChats();
        chats.push({ id: generateId('chat'), matchId, sender: user.username, content, timestamp: new Date().toISOString() });
        try {
            await saveChats(chats);
        } catch (error) {
            console.error('Unable to send message.', error);
            window.alert('Unable to send message right now. Please try again.');
            messageBusy = false;
            setButtonBusy(messageSubmitBtn, false, '', messageSubmitBtn?.dataset.defaultLabel || 'Send');
            input.disabled = false;
            return;
        }
        input.value = '';
        input.disabled = false;
        messageBusy = false;
        setButtonBusy(messageSubmitBtn, false, '', messageSubmitBtn?.dataset.defaultLabel || 'Send');
        renderChatMessages(matchId, user);
    });

    renderChatMessages(matchId, user);
    if (!USE_SUPABASE) {
        if (chatPollId) clearInterval(chatPollId);
        chatPollId = window.setInterval(async () => {
            try {
                await refreshAllData();
                renderChatMessages(matchId, user);
            } catch (error) {
                console.error('Unable to refresh chat messages.', error);
            }
        }, 4000);
    }
}

async function removeUser(username) {
    const users = getUsers().filter((user) => user.username !== username);
    await saveUsers(users);

    const schedules = getSchedules().filter((schedule) => schedule.user1 !== username && schedule.user2 !== username);
    await saveSchedules(schedules);

    const chats = getChats().filter((chat) => !chat.matchId.split('__').includes(username));
    await saveChats(chats);
}

async function deleteSchedule(scheduleId) {
    const schedules = getSchedules().filter((schedule) => schedule.id !== scheduleId);
    await saveSchedules(schedules);
}

async function clearConversation(matchId) {
    const chats = getChats().filter((chat) => chat.matchId !== matchId);
    await saveChats(chats);
}

function getAdminConversationSummary() {
    const chats = getChats();
    const grouped = chats.reduce((map, chat) => {
        if (!map.has(chat.matchId)) {
            map.set(chat.matchId, []);
        }
        map.get(chat.matchId).push(chat);
        return map;
    }, new Map());

    return [...grouped.entries()]
        .map(([matchId, messages]) => {
            const [userA, userB] = matchId.split('__');
            return {
                matchId,
                participants: [userA, userB],
                count: messages.length,
                lastTimestamp: messages[messages.length - 1]?.timestamp || 0
            };
        })
        .sort((left, right) => new Date(right.lastTimestamp) - new Date(left.lastTimestamp));
}

function renderAdminDashboard() {
    const studentUsers = getUsers().filter((user) => user.role !== 'admin');
    const schedules = getSchedules().sort((left, right) => new Date(left.time) - new Date(right.time));
    const chats = getChats();

    document.getElementById('admin-user-count').textContent = String(studentUsers.length);
    document.getElementById('admin-subject-count').textContent = String(studentUsers.filter((user) => user.subjects?.length && user.availability).length);
    document.getElementById('admin-schedule-count').textContent = String(schedules.length);
    document.getElementById('admin-chat-count').textContent = String(chats.length);

    const userList = document.getElementById('admin-users-list');
    userList.innerHTML = studentUsers.length ? studentUsers.map((user) => `
        <article class="manager-item">
            <div>
                <h3>${escapeHtml(user.fullName)}</h3>
                <p>${escapeHtml(user.username)} | ${escapeHtml(user.course || 'No course')}</p>
                <p>${user.subjects?.length ? `${escapeHtml(user.subjects.join(', '))}` : 'No subjects selected yet'}</p>
            </div>
            <button type="button" class="danger-btn" data-remove-user="${user.username}">Remove User</button>
        </article>
    `).join('') : '<div class="empty-state">No student users yet.</div>';

    const scheduleList = document.getElementById('admin-schedules-list');
    scheduleList.innerHTML = schedules.length ? schedules.map((schedule) => `
        <article class="manager-item">
            <div>
                <h3>${escapeHtml(schedule.user1)} and ${escapeHtml(schedule.user2)}</h3>
                <p>${escapeHtml(formatDateTime(schedule.time))}</p>
            </div>
            <button type="button" class="danger-btn" data-delete-schedule="${schedule.id}">Delete</button>
        </article>
    `).join('') : '<div class="empty-state">No schedules yet.</div>';

    document.querySelectorAll('[data-remove-user]').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                if (button.disabled) return;
                button.disabled = true;
                button.textContent = 'Removing...';
                await refreshAllData();
                await removeUser(button.dataset.removeUser);
                renderAdminDashboard();
            } catch (error) {
                console.error('Unable to remove user.', error);
                window.alert('Unable to remove that user right now.');
                button.disabled = false;
                button.textContent = 'Remove User';
            }
        });
    });

    document.querySelectorAll('[data-delete-schedule]').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                if (button.disabled) return;
                button.disabled = true;
                button.textContent = 'Deleting...';
                await refreshAllData();
                await deleteSchedule(button.dataset.deleteSchedule);
                renderAdminDashboard();
            } catch (error) {
                console.error('Unable to delete schedule.', error);
                window.alert('Unable to delete that schedule right now.');
                button.disabled = false;
                button.textContent = 'Delete';
            }
        });
    });
}

function initAdminPage() {
    renderAdminDashboard();

    refreshAllData()
        .then(() => {
            renderAdminDashboard();
        })
        .catch((error) => {
            console.error('Unable to refresh admin dashboard.', error);
            renderAdminDashboard();
        });
}

async function initApp() {
    const page = getCurrentPage();
    if (page === 'auth') {
        return;
    }

    try {
        await refreshAllData();
        subscribeToRealtime();
    } catch (error) {
        console.error('Unable to initialize Study Buddy Finder data.', error);
    }

    let user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    user = initCommonPage(user);
    if (!user) return;

    if (page === 'dashboard') initDashboardPage(user);
    if (page === 'subjects') initSubjectsPage(user);
    if (page === 'matches') initMatchesPage(user);
    if (page === 'schedule') initSchedulePage(user);
    if (page === 'profile') initProfilePage(user);
    if (page === 'chat') initChatPage(user);
    if (page === 'admin') initAdminPage();

    if (page === 'admin') {
        window.setInterval(async () => {
            try {
                await refreshAllData();
                renderAdminDashboard();
            } catch (error) {
                console.error('Unable to refresh admin dashboard.', error);
            }
        }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', initApp);
