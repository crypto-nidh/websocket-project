class AnonymousChat {
    constructor() {
        this.socket = null;
        this.currentChat = {
            type: null,
            id: null,
            name: null,
            targetUser: null
        };
        this.friends = [];
        this.groups = [];
        this.onlineUsers = [];
        this.chats = [];
        this.stories = [];
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
        
        this.connect();
        this.setupEvents();
        this.loadStories();
        this.setupTabs();
    }

    connect() {
        try {
            console.log("🔌 Attempting to connect to server...");
            
            this.socket = io({
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: this.reconnectDelay,
                reconnectionDelayMax: 5000,
                timeout: 20000
            });

            this.socket.on('connect', () => {
                console.log("✅ Connected to server successfully");
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateConnectionStatus('Connected', 'success');
                this.showNotification('Connected to chat server', 'success');
                this.loadInitialData();
            });

            this.socket.on('connection_success', (data) => {
                console.log("🔗 Connection confirmed:", data.message);
            });

            this.socket.on('disconnect', (reason) => {
                console.log("❌ Disconnected from server:", reason);
                this.isConnected = false;
                this.updateConnectionStatus('Disconnected', 'error');
                
                if (reason === 'io server disconnect') {
                    // Server initiated disconnect, need to manually reconnect
                    this.socket.connect();
                }
            });

            this.socket.on('reconnect', (attemptNumber) => {
                console.log(`🔁 Reconnected after ${attemptNumber} attempts`);
                this.isConnected = true;
                this.updateConnectionStatus('Connected', 'success');
                this.showNotification('Reconnected to chat server', 'success');
            });

            this.socket.on('reconnect_attempt', (attemptNumber) => {
                console.log(`🔄 Reconnection attempt ${attemptNumber}`);
                this.updateConnectionStatus(`Reconnecting... (${attemptNumber})`, 'warning');
            });

            this.socket.on('reconnect_error', (error) => {
                console.log('💥 Reconnection error:', error);
                this.updateConnectionStatus('Reconnection failed', 'error');
            });

            this.socket.on('reconnect_failed', () => {
                console.log('💥 All reconnection attempts failed');
                this.updateConnectionStatus('Connection lost', 'error');
                this.showNotification('Failed to reconnect. Please refresh the page.', 'error');
            });

            this.socket.on('connect_error', (error) => {
                console.error('💥 Connection error:', error);
                this.updateConnectionStatus('Connection failed', 'error');
                this.showNotification('Failed to connect to server', 'error');
            });

            // Message events
            this.socket.on('private_message', (data) => {
                console.log("🔒 Private message received:", data);
                this.handlePrivateMessage(data);
            });

            this.socket.on('group_message', (data) => {
                console.log("🏠 Group message received:", data);
                this.handleGroupMessage(data);
            });

            this.socket.on('new_private_message', (data) => {
                console.log("💬 New private message notification:", data);
                this.showNotification(`New message from ${data.from_username}: ${data.message_preview}`);
            });

            this.socket.on('message_error', (data) => {
                console.error('❌ Message error:', data);
                this.showNotification(data.message, 'error');
            });

            // Friend events
            this.socket.on('friend_request', (data) => {
                console.log("🤝 Friend request received:", data);
                this.showFriendRequest(data);
            });

            this.socket.on('friend_added', (data) => {
                console.log("✅ Friend added:", data);
                this.handleFriendAdded(data);
            });

            this.socket.on('friend_online', (data) => {
                console.log("🟢 Friend online:", data);
                this.updateFriendStatus(data.user_id, true);
            });

            this.socket.on('friend_offline', (data) => {
                console.log("🔴 Friend offline:", data);
                this.updateFriendStatus(data.user_id, false);
            });

            // Group events
            this.socket.on('group_created', (data) => {
                console.log("🏠 Group created:", data);
                this.handleGroupCreated(data);
            });

            this.socket.on('added_to_group', (data) => {
                console.log("➕ Added to group:", data);
                this.handleAddedToGroup(data);
            });

            // Story events
            this.socket.on('new_story', (data) => {
                console.log("📖 New story:", data);
                this.handleNewStory(data);
            });

            // User typing events
            this.socket.on('user_typing', (data) => {
                this.handleUserTyping(data);
            });

            // User list updates
            this.socket.on('user_list_update', (data) => {
                console.log("👥 User list updated:", data.users.length, "users online");
                this.updateUserList(data.users);
            });

        } catch (error) {
            console.error("💥 Connection initialization failed:", error);
            this.showNotification('Failed to initialize chat connection', 'error');
        }
    }

    setupEvents() {
        const sendBtn = document.getElementById('send-button');
        const messageInput = document.getElementById('message-input');

        // Message sending with connection check
        sendBtn.addEventListener('click', () => this.sendMessage());
        
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        messageInput.addEventListener('input', (e) => {
            const hasText = e.target.value.trim() !== '';
            sendBtn.disabled = !hasText || !this.isConnected;
            
            // Typing indicators
            if (this.currentChat.type && this.currentChat.targetUser) {
                if (hasText) {
                    this.socket.emit('typing_start', {
                        target_user_id: this.currentChat.type === 'private' ? this.currentChat.targetUser.user_id : this.currentChat.id,
                        chat_type: this.currentChat.type
                    });
                } else {
                    this.socket.emit('typing_stop', {
                        target_user_id: this.currentChat.type === 'private' ? this.currentChat.targetUser.user_id : this.currentChat.id,
                        chat_type: this.currentChat.type
                    });
                }
            }
        });

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !this.isConnected) {
                console.log('🔄 Page visible, attempting reconnect...');
                this.socket.connect();
            }
        });

        // Handle beforeunload
        window.addEventListener('beforeunload', () => {
            if (this.socket) {
                this.socket.disconnect();
            }
        });

        // Search functionality
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterChats(e.target.value);
            });
        }

        // Initialize send button as disabled
        sendBtn.disabled = true;

        // Set focus to message input
        setTimeout(() => {
            if (messageInput) {
                messageInput.focus();
            }
        }, 1000);
    }

    setupTabs() {
        // Sidebar tabs
        document.querySelectorAll('.tab-btn').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // Modal tabs
        document.querySelectorAll('.modal-tab-btn').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                this.switchModalTab(tabName);
            });
        });
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }

    switchModalTab(tabName) {
        document.querySelectorAll('.modal-tab-btn').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        document.querySelectorAll('.modal-tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }

    loadInitialData() {
        this.updateChatsList();
        this.loadStories();
    }

    // Chat Management
    startPrivateChat(userId, userName) {
        if (!this.isConnected) {
            this.showNotification('Not connected to server. Please wait...', 'error');
            return;
        }

        console.log(`🔒 Starting private chat with:`, userName);
        
        this.currentChat = {
            type: 'private',
            id: this.getPrivateRoomId(userId),
            name: userName,
            targetUser: { user_id: userId, username: userName }
        };

        this.updateChatUI();
        this.joinPrivateChat(userId);
        this.loadPrivateChatHistory(userId);
        this.addToRecentChats('private', userId, userName);
        
        closeNewChatModal();
    }

    openGroupChat(groupId, groupName) {
        if (!this.isConnected) {
            this.showNotification('Not connected to server. Please wait...', 'error');
            return;
        }

        console.log(`🏠 Opening group chat:`, groupName);
        
        this.currentChat = {
            type: 'group',
            id: groupId,
            name: groupName
        };

        this.updateChatUI();
        this.loadGroupChatHistory(groupId);
        this.addToRecentChats('group', groupId, groupName);
    }

    updateChatUI() {
        const chatHeader = document.getElementById('chat-header');
        const chatInput = document.getElementById('chat-input-container');
        const chatAvatar = document.getElementById('chat-avatar');
        const chatName = document.getElementById('chat-name');
        const chatStatus = document.getElementById('chat-status');

        if (this.currentChat.type) {
            chatAvatar.textContent = this.currentChat.type === 'private' ? '👤' : '🏠';
            chatName.textContent = this.currentChat.name;
            chatStatus.textContent = this.currentChat.type === 'private' ? 'Online' : `${this.getGroupMemberCount(this.currentChat.id)} members`;
            chatInput.style.display = 'block';
        } else {
            chatInput.style.display = 'none';
        }

        // Clear messages
        document.getElementById('chat-messages').innerHTML = this.currentChat.type ? '' : `
            <div class="welcome-message">
                <h3>Welcome to Anonymous Chat!</h3>
                <p>Start private conversations with friends or join group chats.</p>
            </div>
        `;
    }

    joinPrivateChat(targetUserId) {
        if (this.socket && this.isConnected) {
            this.socket.emit('join_private_chat', { target_user_id: targetUserId });
        }
    }

    async loadPrivateChatHistory(targetUserId) {
        try {
            const response = await fetch(`/get_private_chat_history?user_id=${targetUserId}`);
            if (!response.ok) throw new Error('Network response was not ok');
            
            const data = await response.json();
            
            if (data.success) {
                data.messages.forEach(msg => {
                    this.addPrivateMessageToChat(msg);
                });
            }
        } catch (error) {
            console.error('Error loading private chat history:', error);
            this.showNotification('Failed to load chat history', 'error');
        }
    }

    async loadGroupChatHistory(groupId) {
        try {
            const response = await fetch(`/get_group_chat_history?group_id=${groupId}`);
            if (!response.ok) throw new Error('Network response was not ok');
            
            const data = await response.json();
            
            if (data.success) {
                data.messages.forEach(msg => {
                    this.addGroupMessageToChat(msg);
                });
            }
        } catch (error) {
            console.error('Error loading group chat history:', error);
            this.showNotification('Failed to load group chat history', 'error');
        }
    }

    sendMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();

        if (!message) {
            this.showNotification('Please enter a message', 'error');
            return;
        }

        if (!this.isConnected) {
            this.showNotification('Not connected to server. Please wait...', 'error');
            return;
        }

        console.log("📤 Sending message:", message);

        try {
            if (this.currentChat.type === 'private') {
                this.socket.emit('send_private_message', { 
                    target_user_id: this.currentChat.targetUser.user_id,
                    message: message
                });
                
                // Add message to UI immediately for better UX
                this.addPrivateMessageToChat({
                    id: 'temp-' + Date.now(),
                    from_user_id: 'current',
                    from_username: 'You',
                    to_user_id: this.currentChat.targetUser.user_id,
                    message: message,
                    timestamp: Date.now() / 1000,
                    type: 'private'
                });
                
            } else if (this.currentChat.type === 'group') {
                this.socket.emit('send_group_message', { 
                    group_id: this.currentChat.id,
                    message: message
                });
                
                // Add message to UI immediately for better UX
                this.addGroupMessageToChat({
                    id: 'temp-' + Date.now(),
                    user_id: 'current',
                    username: 'You',
                    message: message,
                    timestamp: Date.now() / 1000,
                    room: this.currentChat.id,
                    type: 'group_message'
                });
            }

            input.value = '';
            document.getElementById('send-button').disabled = true;
            input.focus();

            // Stop typing indicator
            this.socket.emit('typing_stop', {
                target_user_id: this.currentChat.type === 'private' ? this.currentChat.targetUser.user_id : this.currentChat.id,
                chat_type: this.currentChat.type
            });

        } catch (error) {
            console.error('Error sending message:', error);
            this.showNotification('Failed to send message', 'error');
        }
    }

    // Message Handling
    handlePrivateMessage(data) {
        if (this.currentChat.type === 'private' && 
            this.currentChat.targetUser.user_id === data.from_user_id) {
            this.addPrivateMessageToChat(data);
        }
        this.addToRecentChats('private', data.from_user_id, data.from_username, data.message, data.timestamp);
    }

    handleGroupMessage(data) {
        if (this.currentChat.type === 'group' && this.currentChat.id === data.room) {
            this.addGroupMessageToChat(data);
        }
        this.addToRecentChats('group', data.room, data.username, data.message, data.timestamp);
    }

    addPrivateMessageToChat(data) {
        const container = document.getElementById('chat-messages');
        this.clearWelcomeMessage();

        // Remove temporary message if exists
        const tempMsg = container.querySelector(`[data-temp-id="temp-${data.id}"]`);
        if (tempMsg) {
            tempMsg.remove();
        }

        const msgEl = document.createElement('div');
        msgEl.className = `message private-message ${data.from_user_id === 'current' || data.from_user_id !== this.currentChat.targetUser.user_id ? 'sent' : 'received'}`;

        const timestamp = new Date(data.timestamp * 1000).toLocaleTimeString();

        msgEl.innerHTML = `
            <div class="message-header">
                <span class="message-username">${data.from_user_id === 'current' || data.from_user_id !== this.currentChat.targetUser.user_id ? 'You' : this.escape(data.from_username)}</span>
                <span class="message-timestamp">${timestamp}</span>
            </div>
            <div class="message-content">${this.escape(data.message)}</div>
        `;

        container.appendChild(msgEl);
        container.scrollTop = container.scrollHeight;
    }

    addGroupMessageToChat(data) {
        const container = document.getElementById('chat-messages');
        this.clearWelcomeMessage();

        // Remove temporary message if exists
        const tempMsg = container.querySelector(`[data-temp-id="temp-${data.id}"]`);
        if (tempMsg) {
            tempMsg.remove();
        }

        const msgEl = document.createElement('div');
        msgEl.className = `message group-message`;

        const timestamp = new Date(data.timestamp * 1000).toLocaleTimeString();
        const isCurrentUser = data.user_id === 'current' || data.user_id === this.currentUserId;

        msgEl.innerHTML = `
            <div class="message-header">
                <span class="message-username">${isCurrentUser ? 'You' : this.escape(data.username)}</span>
                <span class="message-timestamp">${timestamp}</span>
            </div>
            <div class="message-content">${this.escape(data.message)}</div>
        `;

        container.appendChild(msgEl);
        container.scrollTop = container.scrollHeight;
    }

    handleUserTyping(data) {
        const container = document.getElementById('chat-messages');
        let typingIndicator = container.querySelector('.typing-indicator');
        
        if (data.typing) {
            if (!typingIndicator) {
                typingIndicator = document.createElement('div');
                typingIndicator.className = 'typing-indicator';
                typingIndicator.innerHTML = `
                    <div class="typing-dots">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                    <span>${this.escape(data.username)} is typing...</span>
                `;
                container.appendChild(typingIndicator);
            }
            container.scrollTop = container.scrollHeight;
        } else {
            if (typingIndicator) {
                typingIndicator.remove();
            }
        }
    }

    clearWelcomeMessage() {
        const container = document.getElementById('chat-messages');
        const welcomeMsg = container.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }
    }

    // Friends System
    async sendFriendRequest(userId) {
        if (!this.isConnected) {
            this.showNotification('Not connected to server', 'error');
            return;
        }

        try {
            const response = await fetch('/send_friend_request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ user_id: userId })
            });
            
            if (!response.ok) throw new Error('Network response was not ok');
            
            const data = await response.json();
            if (data.success) {
                this.showNotification('Friend request sent!', 'success');
            } else {
                this.showNotification('Error: ' + data.message, 'error');
            }
        } catch (error) {
            console.error('Error sending friend request:', error);
            this.showNotification('Error sending friend request', 'error');
        }
    }

    async acceptFriendRequest(userId) {
        try {
            const response = await fetch('/accept_friend_request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ user_id: userId })
            });
            
            if (!response.ok) throw new Error('Network response was not ok');
            
            const data = await response.json();
            if (data.success) {
                this.showNotification('Friend request accepted!', 'success');
                this.removePendingRequest(userId);
            }
        } catch (error) {
            console.error('Error accepting friend request:', error);
            this.showNotification('Error accepting friend request', 'error');
        }
    }

    async removeFriend(userId) {
        if (!confirm('Are you sure you want to remove this friend?')) return;

        try {
            const response = await fetch('/remove_friend', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ user_id: userId })
            });
            
            if (!response.ok) throw new Error('Network response was not ok');
            
            const data = await response.json();
            if (data.success) {
                this.showNotification('Friend removed', 'success');
                this.updateFriendsList();
            }
        } catch (error) {
            console.error('Error removing friend:', error);
            this.showNotification('Error removing friend', 'error');
        }
    }

    handleFriendAdded(data) {
        this.showNotification(`You are now friends with ${data.username}`, 'success');
        this.updateFriendsList();
    }

    updateFriendStatus(userId, isOnline) {
        const friendElement = document.querySelector(`[data-user-id="${userId}"]`);
        if (friendElement) {
            const statusElement = friendElement.querySelector('.friend-status');
            const avatarElement = friendElement.querySelector('.friend-avatar');
            
            if (isOnline) {
                statusElement.textContent = 'Online';
                statusElement.className = 'friend-status online';
                avatarElement.className = 'friend-avatar online';
            } else {
                statusElement.textContent = 'Offline';
                statusElement.className = 'friend-status offline';
                avatarElement.className = 'friend-avatar offline';
            }
        }
    }

    // Groups System
    async createGroup() {
        const groupName = document.getElementById('group-name').value.trim();
        const description = document.getElementById('group-desc').value.trim();
        const selectedFriends = Array.from(document.querySelectorAll('#friends-selector input:checked'))
            .map(checkbox => checkbox.value);

        if (!groupName) {
            this.showNotification('Please enter a group name', 'error');
            return;
        }

        if (!this.isConnected) {
            this.showNotification('Not connected to server', 'error');
            return;
        }

        try {
            const response = await fetch('/create_group', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    name: groupName,
                    description: description,
                    members: selectedFriends
                })
            });
            
            if (!response.ok) throw new Error('Network response was not ok');
            
            const data = await response.json();
            if (data.success) {
                this.showNotification('Group created successfully!', 'success');
                closeCreateGroupModal();
                this.updateGroupsList();
            } else {
                this.showNotification('Error: ' + data.message, 'error');
            }
        } catch (error) {
            console.error('Error creating group:', error);
            this.showNotification('Error creating group', 'error');
        }
    }

    handleGroupCreated(data) {
        this.showNotification(`You were added to group: ${data.group_name}`, 'success');
        this.updateGroupsList();
    }

    handleAddedToGroup(data) {
        this.showNotification(`You were added to group: ${data.group_name}`, 'success');
        this.updateGroupsList();
    }

    // Stories System
    async loadStories() {
        try {
            const response = await fetch('/get_stories');
            if (!response.ok) throw new Error('Network response was not ok');
            
            const data = await response.json();
            this.stories = data.stories;
            this.renderStories();
        } catch (error) {
            console.error('Error loading stories:', error);
        }
    }

    renderStories() {
        const container = document.getElementById('stories-list');
        
        if (!container) return;
        
        if (this.stories.length === 0) {
            container.innerHTML = '<div class="no-stories">No stories yet. Be the first to share!</div>';
            return;
        }

        container.innerHTML = this.stories.slice(0, 10).map(story => `
            <div class="story-item" onclick="viewStory('${story.id}')">
                <div class="story-avatar">${story.username[0]}</div>
                <div class="story-content">
                    <div class="story-author">${this.escape(story.username)}</div>
                    <div class="story-text">${this.escape(story.text)}</div>
                    <div class="story-time">${this.formatTime(story.timestamp)}</div>
                </div>
            </div>
        `).join('');
    }

    handleNewStory(data) {
        this.stories.unshift(data);
        if (this.stories.length > 10) {
            this.stories = this.stories.slice(0, 10);
        }
        this.renderStories();
    }

    // Utility Methods
    getPrivateRoomId(user1, user2) {
        return `private_${[user1, user2].sort().join('_')}`;
    }

    getGroupMemberCount(groupId) {
        const group = this.groups.find(g => g.id === groupId);
        return group ? group.member_count : 0;
    }

    addToRecentChats(type, id, name, lastMessage = null, timestamp = null) {
        // Implementation for recent chats list
        // This would update the chats list in the sidebar
    }

    updateChatsList() {
        // Update recent chats list
    }

    updateUserList(users) {
        this.onlineUsers = users;
        const container = document.getElementById('user-list');
        const onlineCount = document.getElementById('online-count');
        const totalOnline = document.getElementById('total-online');

        if (onlineCount) onlineCount.textContent = users.length;
        if (totalOnline) totalOnline.textContent = users.length;

        if (!container) return;

        if (users.length === 0) {
            container.innerHTML = '<div class="loading">No users online</div>';
            return;
        }

        container.innerHTML = users.map(user => `
            <div class="user-item" onclick="startPrivateChat('${user.user_id}', '${user.username}')">
                <div class="user-item-avatar online">${user.username.charAt(0).toUpperCase()}</div>
                <div class="user-item-name">${this.escape(user.username)}</div>
                <div class="user-item-action">
                    <button class="chat-btn" title="Start Chat">💬</button>
                </div>
            </div>
        `).join('');
    }

    updateFriendsList() {
        // Refresh friends list - would typically reload from server
    }

    updateGroupsList() {
        // Refresh groups list - would typically reload from server
    }

    filterChats(query) {
        // Filter chats based on search query
    }

    formatTime(timestamp) {
        const now = Date.now() / 1000;
        const diff = now - timestamp;
        
        if (diff < 3600) {
            return `${Math.floor(diff / 60)}m ago`;
        } else if (diff < 86400) {
            return `${Math.floor(diff / 3600)}h ago`;
        } else {
            return '24h+ ago';
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        const notificationText = document.getElementById('notification-text');
        
        if (!notification || !notificationText) return;
        
        notificationText.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.remove('hidden');
        
        setTimeout(() => {
            notification.classList.add('hidden');
        }, 5000);
    }

    updateConnectionStatus(status, type) {
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = `connection-status ${type}`;
        }
    }

    showFriendRequest(data) {
        if (confirm(`Friend request from ${data.from_username}. Accept?`)) {
            this.acceptFriendRequest(data.from_user_id);
        }
    }

    removePendingRequest(userId) {
        const requestElement = document.querySelector(`[data-user-id="${userId}"]`);
        if (requestElement) {
            requestElement.remove();
        }
    }

    escape(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Global Functions
function startPrivateChat(userId, userName) {
    if (window.chatApp) {
        window.chatApp.startPrivateChat(userId, userName);
    }
}

function openGroupChat(groupId, groupName) {
    if (window.chatApp) {
        window.chatApp.openGroupChat(groupId, groupName);
    }
}

async function sendFriendRequest(userId) {
    if (window.chatApp) {
        await window.chatApp.sendFriendRequest(userId);
    }
}

async function acceptFriendRequest(userId) {
    if (window.chatApp) {
        await window.chatApp.acceptFriendRequest(userId);
    }
}

async function removeFriend(userId) {
    if (window.chatApp) {
        await window.chatApp.removeFriend(userId);
    }
}

async function createGroup() {
    if (window.chatApp) {
        await window.chatApp.createGroup();
    }
}

// Modal Functions
function openNewChatModal() {
    document.getElementById('newChatModal').style.display = 'block';
}

function closeNewChatModal() {
    document.getElementById('newChatModal').style.display = 'none';
}

function openCreateGroupModal() {
    document.getElementById('createGroupModal').style.display = 'block';
}

function closeCreateGroupModal() {
    document.getElementById('createGroupModal').style.display = 'none';
    document.getElementById('group-name').value = '';
    document.getElementById('group-desc').value = '';
    document.querySelectorAll('#friends-selector input').forEach(checkbox => {
        checkbox.checked = false;
    });
}

function openStoryModal() {
    document.getElementById('storyModal').style.display = 'block';
    document.getElementById('story-text').focus();
}

function closeStoryModal() {
    document.getElementById('storyModal').style.display = 'none';
    document.getElementById('story-text').value = '';
    document.getElementById('char-count').textContent = '0';
}

function openSettingsModal() {
    document.getElementById('settingsModal').style.display = 'block';
}

function closeSettingsModal() {
    document.getElementById('settingsModal').style.display = 'none';
}

function closeNotification() {
    const notification = document.getElementById('notification');
    if (notification) {
        notification.classList.add('hidden');
    }
}

async function postStory() {
    const storyText = document.getElementById('story-text').value.trim();
    
    if (!storyText) {
        alert('Please enter some text for your story');
        return;
    }
    
    if (storyText.length > 500) {
        alert('Story must be 500 characters or less');
        return;
    }
    
    try {
        const response = await fetch('/post_story', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ story: storyText })
        });
        
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        
        if (data.success) {
            closeStoryModal();
            if (window.chatApp) {
                window.chatApp.showNotification('Your story has been posted!', 'success');
            }
        } else {
            alert('Error: ' + data.message);
        }
    } catch (error) {
        console.error('Error posting story:', error);
        alert('Error posting story. Please try again.');
    }
}

function viewStory(storyId) {
    if (window.chatApp) {
        const story = window.chatApp.stories.find(s => s.id === storyId);
        if (story) {
            alert(`Story by ${story.username}:\n\n${story.text}\n\nPosted ${window.chatApp.formatTime(story.timestamp)}`);
        }
    }
}

function clearChat() {
    if (confirm('Are you sure you want to clear the chat? This will only clear your view.')) {
        const container = document.getElementById('chat-messages');
        if (container) {
            container.innerHTML = '<div class="welcome-message"><h3>Chat Cleared</h3><p>Start chatting again...</p></div>';
        }
    }
}

function toggleTheme() {
    document.body.classList.toggle('dark-theme');
}

// Close modals when clicking outside
window.onclick = function(event) {
    const modals = ['newChatModal', 'createGroupModal', 'storyModal', 'settingsModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (event.target === modal) {
            const closeFunction = window[`close${modalId.charAt(0).toUpperCase() + modalId.slice(1)}`];
            if (closeFunction) closeFunction();
        }
    });
}

// Story character count
document.getElementById('story-text')?.addEventListener('input', function(e) {
    const charCount = document.getElementById('char-count');
    if (charCount) {
        charCount.textContent = e.target.value.length;
    }
});

// Start the app when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new AnonymousChat();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (window.chatApp && window.chatApp.socket) {
        window.chatApp.socket.disconnect();
    }
});