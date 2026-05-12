(function () {
    const supabase = window.supabaseClient || null;
    const STORAGE_KEYS = {
        USERS: 'studybuddy_users',
        CURRENT_USER: 'studybuddy_currentUser'
    };

    let authMode = 'login';
    let authBusy = false;

    function readStorage(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function writeStorage(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function mergeUserIntoCache(user) {
        const users = readStorage(STORAGE_KEYS.USERS, []);
        const filtered = users.filter((entry) => String(entry.username || '') !== String(user.username || ''));
        filtered.push(user);
        writeStorage(STORAGE_KEYS.USERS, filtered);
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

    function getDisplayName(user) {
        return String(user?.full_name || user?.fullName || user?.username || 'Student').trim();
    }

    function getHomePageForUser(user) {
        return user?.role === 'admin' ? 'admin_dashboard.html' : 'dashboard.html';
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

        const title = document.getElementById('form-title');
        const submitBtn = document.getElementById('submit-btn');
        const toggleBtn = document.getElementById('toggle-form');

        if (title) title.textContent = isSignup ? 'Create your account' : 'Login';
        if (submitBtn) submitBtn.textContent = isSignup ? 'Create Account' : 'Login';
        if (toggleBtn) toggleBtn.textContent = isSignup ? 'Back to login' : 'Create a new account';
        if (modeNote) {
            modeNote.textContent = isSignup
                ? 'Fill in your student details to create a new account.'
                : 'Use your username and password to continue.';
        }
        clearFeedback();
    }

    async function ensureRemoteAdmin() {
        if (!supabase) return;
        await supabase
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
    }

    async function findUserByCredentials(username, password) {
        if (!supabase) {
            const users = readStorage(STORAGE_KEYS.USERS, []);
            return users.find((user) => user.username === username && user.password === password) || null;
        }

        await ensureRemoteAdmin();
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .maybeSingle();

        if (error) {
            throw error;
        }

        return data || null;
    }

    async function createUserAccount(payload) {
        if (!supabase) {
            const users = readStorage(STORAGE_KEYS.USERS, []);
            if (users.some((user) => String(user.username || '').toLowerCase() === payload.username.toLowerCase())) {
                return { ok: false, error: 'That username is already taken.' };
            }
            if (users.some((user) => String(user.email || '').toLowerCase() === payload.email.toLowerCase())) {
                return { ok: false, error: 'That email is already being used.' };
            }
            users.push(payload);
            writeStorage(STORAGE_KEYS.USERS, users);
            return { ok: true };
        }

        const [usernameCheck, emailCheck] = await Promise.all([
            supabase.from('users').select('username').eq('username', payload.username).maybeSingle(),
            supabase.from('users').select('email').eq('email', payload.email).maybeSingle()
        ]);

        if (usernameCheck.error) {
            throw usernameCheck.error;
        }
        if (emailCheck.error) {
            throw emailCheck.error;
        }
        if (usernameCheck.data) {
            return { ok: false, error: 'That username is already taken.' };
        }
        if (emailCheck.data) {
            return { ok: false, error: 'That email is already being used.' };
        }

        const { error } = await supabase
            .from('users')
            .insert({
                username: payload.username,
                password: payload.password,
                full_name: payload.full_name,
                course: payload.course,
                email: payload.email,
                role: 'user',
                subjects: [],
                selected_topics: [],
                subject_topics: {},
                subject_availabilities: {},
                profile_photo: '',
                availability_start: null,
                availability_end: null,
                created_at: new Date().toISOString()
            });

        if (error) {
            throw error;
        }

        return { ok: true };
    }

    async function initAuthPage() {
        const form = document.getElementById('auth-form');
        const submitBtn = document.getElementById('submit-btn');
        const toggleBtn = document.getElementById('toggle-form');
        if (!form || !submitBtn || !toggleBtn) return;

        toggleBtn.addEventListener('click', function () {
            setAuthMode(authMode === 'login' ? 'signup' : 'login');
        });

        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (authBusy) return false;

            const username = document.getElementById('username')?.value.trim() || '';
            const password = document.getElementById('password')?.value || '';

            if (!username || !password) {
                showFeedback('Please complete your username and password.');
                return false;
            }

            authBusy = true;
            setButtonBusy(submitBtn, true, authMode === 'signup' ? 'Creating Account...' : 'Checking...', authMode === 'signup' ? 'Create Account' : 'Login');
            toggleBtn.disabled = true;

            try {
                if (authMode === 'signup') {
                    const fullName = document.getElementById('name')?.value.trim() || '';
                    const course = document.getElementById('course')?.value.trim() || '';
                    const email = document.getElementById('email')?.value.trim() || '';

                    if (!fullName || !course || !email) {
                        showFeedback('Please complete all signup fields.');
                        return false;
                    }

                    const result = await createUserAccount({
                        username,
                        password,
                        full_name: fullName,
                        course,
                        email
                    });

                    if (!result.ok) {
                        showFeedback(result.error || 'Unable to create account right now. Please try again.');
                        return false;
                    }

                    mergeUserIntoCache({
                        username,
                        password,
                        fullName,
                        course,
                        email,
                        role: 'user',
                        subjects: [],
                        selectedTopics: [],
                        subjectTopics: {},
                        subjectAvailabilities: {},
                        profilePhoto: '',
                        availability: null
                    });
                    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, username);
                    window.location.href = 'dashboard.html';
                    return false;
                }

                const user = await findUserByCredentials(username, password);
                if (!user) {
                    showFeedback('Invalid username or password.');
                    return false;
                }

                mergeUserIntoCache({
                    username: user.username,
                    password: user.password,
                    fullName: user.full_name || user.fullName || '',
                    course: user.course || '',
                    email: user.email || '',
                    role: user.role || 'user',
                    subjects: Array.isArray(user.subjects) ? user.subjects : [],
                    selectedTopics: Array.isArray(user.selected_topics || user.selectedTopics) ? (user.selected_topics || user.selectedTopics) : [],
                    subjectTopics: user.subject_topics || user.subjectTopics || {},
                    subjectAvailabilities: user.subject_availabilities || user.subjectAvailabilities || {},
                    profilePhoto: user.profile_photo || user.profilePhoto || '',
                    availability: (user.availability_start || user.availability_end)
                        ? {
                            start: user.availability_start || null,
                            end: user.availability_end || null
                        }
                        : (user.availability || null)
                });
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, user.username);
                window.location.href = getHomePageForUser(user);
                return false;
            } catch (error) {
                console.error('Auth flow failed.', error);
                showFeedback(error?.message || 'Unable to connect right now. Please try again.');
                return false;
            } finally {
                authBusy = false;
                setButtonBusy(submitBtn, false, '', authMode === 'signup' ? 'Create Account' : 'Login');
                toggleBtn.disabled = false;
            }
        });

        setAuthMode('login');

        const currentUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
        if (currentUser) {
            showFeedback(`Signed in as ${currentUser}. You can still log in with another account or create a new one here.`, 'success');
        }
    }

    document.addEventListener('DOMContentLoaded', initAuthPage);
})();
