(function () {
    const STORAGE_KEYS = {
        CURRENT_USER: 'studybuddy_currentUser',
        CURRENT_CHAT_MATCH: 'studybuddy_currentChatMatch',
        SCHEDULE_WITH_USER: 'studybuddy_scheduleWithUser',
        DARK_MODE: 'studybuddy_darkMode'
    };

    function bindLogout() {
        const logoutBtn = document.getElementById('logout-btn');
        if (!logoutBtn) return;

        logoutBtn.addEventListener('click', function () {
            localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
            localStorage.removeItem(STORAGE_KEYS.CURRENT_CHAT_MATCH);
            localStorage.removeItem(STORAGE_KEYS.SCHEDULE_WITH_USER);
            window.location.href = 'index.html';
        });
    }

    function bindTheme() {
        const themeBtn = document.getElementById('dark-toggle');
        if (!themeBtn) return;

        const isDark = localStorage.getItem(STORAGE_KEYS.DARK_MODE) === 'true';
        document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
        themeBtn.textContent = isDark ? 'Light' : 'Dark';

        themeBtn.addEventListener('click', function () {
            const dark = document.documentElement.dataset.theme === 'dark';
            document.documentElement.dataset.theme = dark ? 'light' : 'dark';
            localStorage.setItem(STORAGE_KEYS.DARK_MODE, String(!dark));
            themeBtn.textContent = dark ? 'Dark' : 'Light';
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        bindLogout();
        bindTheme();
    });
})();
