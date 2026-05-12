(function () {
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
    const supabase = window.supabaseClient || null;
    const USE_SUPABASE = Boolean(supabase);
    const state = {
        users: [],
        chats: [],
        schedules: [],
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
            }, { onConflict: 'username' });

        if (error) {
            console.error('Unable to seed admin user.', error);
        }
    }

    async function refreshAllData() {
        if (state.syncPromise) return state.syncPromise;

        state.syncPromise = (async () => {
            if (!USE_SUPABASE) {
                state.users = getLocalSeededUsers();
                state.chats = readStorage(STORAGE_KEYS.CHATS, []).map(normalizeChat);
                state.schedules = readStorage(STORAGE_KEYS.SCHEDULES, []).map(normalizeSchedule);
                persistCollectionsToCache();
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

    function getChats() {
        return state.chats || [];
    }

    function getSchedules() {
        return state.schedules || [];
    }

    function replaceUserInState(nextUser) {
        const normalizedUser = normalizeUser(nextUser);
        const existingUsers = getUsers();
        state.users = existingUsers.some((user) => user.username === normalizedUser.username)
            ? existingUsers.map((user) => user.username === normalizedUser.username ? normalizedUser : user)
            : existingUsers.concat(normalizedUser);
        persistCollectionsToCache();
        return normalizedUser;
    }

    async function upsertUser(user) {
        const normalizedUser = normalizeUser(user);

        if (!USE_SUPABASE) {
            return replaceUserInState(normalizedUser);
        }

        const { data, error } = await supabase
            .from('users')
            .upsert(toRemoteUser(normalizedUser), { onConflict: 'username' })
            .select()
            .single();

        if (error) throw error;
        return replaceUserInState(data || normalizedUser);
    }

    async function deleteUsersByUsername(usernames) {
        const usernamesToRemove = [...new Set((usernames || []).map((username) => String(username || '').trim()).filter(Boolean))];
        if (!usernamesToRemove.length) return;

        if (!USE_SUPABASE) {
            state.users = getUsers().filter((user) => !usernamesToRemove.includes(user.username));
            persistCollectionsToCache();
            return;
        }

        const { error } = await supabase
            .from('users')
            .delete()
            .in('username', usernamesToRemove);

        if (error) throw error;
        state.users = getUsers().filter((user) => !usernamesToRemove.includes(user.username));
        persistCollectionsToCache();
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
            const { error } = await supabase.from('chats').delete().in('id', removedIds);
            if (error) throw error;
        }

        const { error } = await supabase
            .from('chats')
            .upsert(normalizedChats.map(toRemoteChat), { onConflict: 'id' });
        if (error) throw error;

        state.chats = normalizedChats;
        persistCollectionsToCache();
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
            const { error } = await supabase.from('schedules').delete().in('id', removedIds);
            if (error) throw error;
        }

        const { error } = await supabase
            .from('schedules')
            .upsert(normalizedSchedules.map(toRemoteSchedule), { onConflict: 'id' });
        if (error) throw error;

        state.schedules = normalizedSchedules;
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
        if (existingUsernameResult.error) return { ok: false, error: existingUsernameResult.error.message || 'Unable to create account right now.' };
        if (existingEmailResult.error) return { ok: false, error: existingEmailResult.error.message || 'Unable to create account right now.' };
        if (existingUsernameResult.data) return { ok: false, error: 'That username is already taken.' };
        if (existingEmailResult.data) return { ok: false, error: 'That email is already being used.' };

        const { error } = await supabase.from('users').insert(toRemoteUser(nextUser));
        if (error) return { ok: false, error: error.message || 'Unable to create account right now.' };

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

    async function initProtectedPage(page) {
        await refreshAllData();
        const user = getCurrentUser();
        if (!user) {
            window.location.href = 'index.html';
            return null;
        }
        if (!enforceRoleAccess(user, page)) return null;
        return user;
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
        return getDisplayName(user).split(/\s+/).filter(Boolean)[0] || 'Student';
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
        if (Array.isArray(savedTopics)) return [...savedTopics];
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

    function getMatchesForUser(user, preferredSubject = '') {
        if (!user || user.role === 'admin') return [];

        return getUsers()
            .filter((other) => other.username !== user.username && other.role !== 'admin')
            .map((other) => {
                const userSubjects = Array.isArray(user.subjects) ? user.subjects : [];
                const otherSubjects = Array.isArray(other.subjects) ? other.subjects : [];
                const sharedSubjects = userSubjects.filter((subject) => otherSubjects.includes(subject));
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
                const relatedScore = preferredSubject && !availableSubjects.includes(preferredSubject) && relatedPreferredSubjects.length ? 50 : 0;
                const sharedScore = sharedSubjects.length * 10;

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
                    preferredSubjectLabel: preferredSubject && availableSubjects.includes(preferredSubject) ? `${preferredSubject} was uploaded by this user.` : '',
                    score: priorityScore + relatedScore + sharedScore
                };
            })
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                return getDisplayName(left.otherUser).localeCompare(getDisplayName(right.otherUser));
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

    function subscribeTables(tables, onChange) {
        if (!USE_SUPABASE || !supabase || typeof onChange !== 'function') return null;
        const tableList = Array.isArray(tables) ? tables : [];
        const channel = supabase.channel(`ui-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
        tableList.forEach((table) => {
            channel.on('postgres_changes', { event: '*', schema: 'public', table }, async () => {
                try {
                    await refreshAllData();
                    onChange();
                } catch (error) {
                    console.error(`Unable to refresh ${table} realtime data.`, error);
                }
            });
        });
        channel.subscribe();
        return channel;
    }

    window.AppCore = {
        SUBJECTS,
        SUBJECT_TOPICS,
        STORAGE_KEYS,
        USE_SUPABASE,
        readStorage,
        writeStorage,
        generateId,
        refreshAllData,
        getUsers,
        getChats,
        getSchedules,
        upsertUser,
        deleteUsersByUsername,
        saveChats,
        saveSchedules,
        createUserAccount,
        findUserByCredentials,
        getCurrentUser,
        saveCurrentUser,
        clearCurrentUser,
        initProtectedPage,
        escapeHtml,
        getDisplayName,
        getFirstName,
        formatDateTime,
        getSubjectAvailability,
        getSubjectTopics,
        flattenSubjectTopics,
        getMatchesForUser,
        openChat,
        getChatPartner,
        subscribeTables
    };
})();
