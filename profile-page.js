(function () {
    const core = window.AppCore;
    if (!core) return;

    function renderProfile(user) {
        const photoImage = document.getElementById('profile-photo-image');
        const photoFallback = document.getElementById('profile-photo-fallback');
        const hasPhoto = typeof user.profilePhoto === 'string' && user.profilePhoto.startsWith('data:image');

        if (photoImage) {
            photoImage.hidden = !hasPhoto;
            if (hasPhoto) photoImage.src = user.profilePhoto;
            else photoImage.removeAttribute('src');
        }
        if (photoFallback) photoFallback.hidden = hasPhoto;

        document.getElementById('profile-info').innerHTML = `
            <p><strong>Name:</strong> ${core.escapeHtml(user.fullName)}</p>
            <p><strong>Course:</strong> ${core.escapeHtml(user.course || 'Not set')}</p>
            <p><strong>Email:</strong> ${core.escapeHtml(user.email || 'Not set')}</p>
            <p><strong>Username:</strong> ${core.escapeHtml(user.username)}</p>
        `;

        document.getElementById('profile-subjects').innerHTML = user.subjects?.length
            ? user.subjects.map((subject) => `<span class="tag">${core.escapeHtml(subject)}</span>`).join('')
            : '<p class="empty-state">No subjects selected yet.</p>';

        const subjectAvailabilityEntries = Object.entries(user.subjectAvailabilities || {});
        document.getElementById('profile-availability').innerHTML = subjectAvailabilityEntries.length
            ? subjectAvailabilityEntries.map(([subject, availability]) => `
                <article class="match-card">
                    <h3>${core.escapeHtml(subject)}</h3>
                    <p><strong>Start:</strong> ${core.escapeHtml(core.formatDateTime(availability.start))}</p>
                    <p><strong>End:</strong> ${core.escapeHtml(core.formatDateTime(availability.end))}</p>
                </article>
            `).join('')
            : '<p class="empty-state">No availability set yet.</p>';
    }

    document.addEventListener('DOMContentLoaded', async function () {
        if (document.body.dataset.page !== 'profile') return;
        const user = await core.initProtectedPage('profile');
        if (!user) return;

        renderProfile(user);

        document.getElementById('profile-photo-input')?.addEventListener('change', function (event) {
            const file = event.target.files?.[0];
            if (!file || !file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = async function () {
                const result = typeof reader.result === 'string' ? reader.result : '';
                if (!result) return;
                try {
                    await core.refreshAllData();
                    const activeUser = core.getCurrentUser() || user;
                    await core.upsertUser({ ...activeUser, profilePhoto: result });
                    renderProfile({ ...activeUser, profilePhoto: result });
                } catch (error) {
                    console.error('Unable to save profile photo.', error);
                    window.alert('Unable to save your profile photo right now.');
                }
            };
            reader.readAsDataURL(file);
        });

        core.subscribeTables(['users'], function () {
            const activeUser = core.getCurrentUser() || user;
            renderProfile(activeUser);
        });
    });
})();
