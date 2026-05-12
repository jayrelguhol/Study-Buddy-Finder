(function () {
    const core = window.AppCore;
    if (!core) return;

    document.addEventListener('DOMContentLoaded', async function () {
        if (document.body.dataset.page !== 'subjects') return;
        const user = await core.initProtectedPage('subjects');
        if (!user) return;

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
        localStorage.removeItem(core.STORAGE_KEYS.CURRENT_MATCH_SUBJECT);

        const lastActiveSubject = savedSubjects[savedSubjects.length - 1] || '';
        const initialSubject = wantsNewSubject
            ? core.SUBJECTS.find((subject) => !savedSubjects.includes(subject)) || core.SUBJECTS[0]
            : lastActiveSubject || core.SUBJECTS[0];

        if (initialSubject) {
            select.value = initialSubject;
        }

        function getSelectedSubject() {
            return select.value ? [select.value] : [];
        }

        function getCurrentTopicKeys() {
            const fallbackKey = String(selectedTopicInput?.value || '').trim();
            if (fallbackKey) return [fallbackKey];
            return core.getSubjectTopics({ ...user, subjectTopics }, select.value);
        }

        function syncAvailabilityInputs() {
            const availability = core.getSubjectAvailability(user, select.value);
            document.getElementById('availability-start').value = availability?.start || '';
            document.getElementById('availability-end').value = availability?.end || '';
        }

        function renderSubjectTopics() {
            const selectedSubjects = getSelectedSubject();
            const selectedTopicKeys = getCurrentTopicKeys();
            if (!selectedSubjects.length) {
                topicsContainer.className = 'topics-empty-state';
                topicsContainer.innerHTML = 'Select a subject to view suggested topics you can study together.';
                if (topicsSelectionNote) topicsSelectionNote.textContent = 'Tap a topic to mark what you want to study together.';
                return;
            }

            topicsContainer.className = 'topics-grid';
            topicsContainer.innerHTML = selectedSubjects.map((subject) => `
                <article class="topic-card">
                    <h3>${core.escapeHtml(subject)}</h3>
                    <div class="topic-chip-list">
                        ${core.SUBJECT_TOPICS[subject].map((topic) => {
                            const key = `${subject}::${topic}`;
                            const isSelected = selectedTopicKeys.includes(key);
                            return `<button type="button" class="topic-chip ${isSelected ? 'is-selected' : ''}" data-topic-key="${core.escapeHtml(key)}" aria-pressed="${isSelected ? 'true' : 'false'}">${core.escapeHtml(topic)}</button>`;
                        }).join('')}
                    </div>
                </article>
            `).join('');

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

        select.addEventListener('change', syncSubjectsUi);
        select.addEventListener('input', syncSubjectsUi);
        topicsContainer?.addEventListener('click', function (event) {
            const button = event.target.closest('[data-topic-key]');
            if (!button) return;
            const key = button.dataset.topicKey || '';
            let selectedTopicKeys = getCurrentTopicKeys();
            selectedTopicKeys = selectedTopicKeys.includes(key) ? [] : [key];
            subjectTopics[select.value] = selectedTopicKeys;
            if (selectedTopicInput) selectedTopicInput.value = selectedTopicKeys[0] || '';
            renderSubjectTopics();
        });

        syncSubjectsUi();

        document.getElementById('subjects-form')?.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (subjectsBusy) return;

            const subjects = getSelectedSubject();
            const start = document.getElementById('availability-start').value;
            const end = document.getElementById('availability-end').value;
            if (!subjects.length) return window.alert('Select at least one subject.');
            if (!start || !end || new Date(start) >= new Date(end)) return window.alert('Please choose a valid availability range.');
            if (getCurrentTopicKeys().length !== 1) return window.alert('Please select exactly one topic for this subject.');

            subjectsBusy = true;
            if (subjectsSubmitBtn) {
                subjectsSubmitBtn.disabled = true;
                subjectsSubmitBtn.textContent = 'Saving...';
            }

            try {
                await core.refreshAllData();
                const users = core.getUsers();
                const index = users.findIndex((item) => item.username === user.username);
                if (index === -1) return;

                const selectedSubject = subjects[0];
                const updatedSubjectAvailabilities = {
                    ...(users[index].subjectAvailabilities || {}),
                    [selectedSubject]: { start, end }
                };
                const updatedSubjectTopics = {
                    ...(users[index].subjectTopics || {}),
                    [selectedSubject]: getCurrentTopicKeys()
                };
                await core.upsertUser({
                    ...users[index],
                    subjects: Array.from(new Set([...(users[index].subjects || []), selectedSubject])),
                    selectedTopics: core.flattenSubjectTopics(updatedSubjectTopics),
                    subjectTopics: updatedSubjectTopics,
                    subjectAvailabilities: updatedSubjectAvailabilities,
                    availability: { start, end }
                });
                localStorage.setItem(core.STORAGE_KEYS.CURRENT_MATCH_SUBJECT, selectedSubject);
                window.location.href = `matches.html?subject=${encodeURIComponent(selectedSubject)}`;
            } catch (error) {
                console.error('Unable to save subject setup.', error);
                window.alert('Unable to save your subject setup right now. Please try again.');
            } finally {
                subjectsBusy = false;
                if (subjectsSubmitBtn) {
                    subjectsSubmitBtn.disabled = false;
                    subjectsSubmitBtn.textContent = 'Upload Subject and Find Matches';
                }
            }
        });
    });
})();
