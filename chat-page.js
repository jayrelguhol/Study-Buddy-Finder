(function () {
    const core = window.AppCore;
    if (!core) return;

    function renderChatMessages(matchId, user) {
        const container = document.getElementById('messages-container');
        if (!container) return;
        const messages = core.getChats()
            .filter((chat) => chat.matchId === matchId)
            .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));

        container.innerHTML = messages.length
            ? messages.map((message) => {
                const cls = message.sender === user.username ? 'sent' : 'received';
                return `<div class="message ${cls}"><strong>${core.escapeHtml(message.sender)}</strong><p>${core.escapeHtml(message.content)}</p><small>${core.escapeHtml(core.formatDateTime(message.timestamp))}</small></div>`;
            }).join('')
            : '<div class="empty-state">No messages yet. Start the conversation.</div>';
        container.scrollTop = container.scrollHeight;
    }

    document.addEventListener('DOMContentLoaded', async function () {
        if (document.body.dataset.page !== 'chat') return;
        const user = await core.initProtectedPage('chat');
        if (!user) return;

        const matchId = localStorage.getItem(core.STORAGE_KEYS.CURRENT_CHAT_MATCH);
        if (!matchId) {
            window.location.href = 'matches.html';
            return;
        }

        const partner = core.getChatPartner(matchId, user);
        if (!partner) {
            window.location.href = 'matches.html';
            return;
        }

        document.getElementById('chat-partner').textContent = partner.fullName;
        document.getElementById('back-to-matches')?.addEventListener('click', function () {
            window.location.href = 'matches.html';
        });

        document.getElementById('message-form')?.addEventListener('submit', async function (event) {
            event.preventDefault();
            const input = document.getElementById('message-input');
            const content = input?.value.trim() || '';
            if (!content) return;
            try {
                await core.refreshAllData();
                const chats = core.getChats();
                chats.push({ id: core.generateId('chat'), matchId, sender: user.username, content, timestamp: new Date().toISOString() });
                await core.saveChats(chats);
                input.value = '';
                renderChatMessages(matchId, user);
            } catch (error) {
                console.error('Unable to send message.', error);
                window.alert('Unable to send message right now.');
            }
        });

        renderChatMessages(matchId, user);
        core.subscribeTables(['chats', 'users'], function () {
            const activeUser = core.getCurrentUser() || user;
            renderChatMessages(matchId, activeUser);
        });
    });
})();
