from flask import Flask, render_template, request, session, redirect, url_for, flash, jsonify
from flask_socketio import SocketIO, join_room, leave_room
import uuid
import random
import time
import hashlib
import json
from datetime import datetime, timedelta
from collections import defaultdict
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'anonymous_chat_secret_key_2024'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

# Configure SocketIO with better settings for stability
socketio = SocketIO(app, 
                   async_mode='threading',
                   cors_allowed_origins="*",
                   logger=True,
                   engineio_logger=True,
                   ping_timeout=60,
                   ping_interval=25,
                   max_http_buffer_size=1000000)

# Storage
users = {}
active_users = {}
messages = []
private_messages = defaultdict(list)
group_messages = defaultdict(list)
user_stories = {}

# Groups storage
groups = {}
user_groups = defaultdict(set)
group_members = defaultdict(set)

# Friends system
friends = defaultdict(set)
friend_requests = defaultdict(set)

class User:
    def __init__(self, username, password_hash, user_id):
        self.username = f"User_{random.randint(10000, 99999)}"
        self.original_username = username
        self.password_hash = password_hash
        self.user_id = user_id
        self.created_at = datetime.now()
        self.last_seen = datetime.now()
        self.is_online = False
        self.status = "Available"

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def generate_anonymous_name():
    adjectives = ['Silent', 'Mysterious', 'Hidden', 'Secret', 'Unknown', 'Quiet', 'Shadow', 'Ghost']
    nouns = ['Stranger', 'Visitor', 'Traveler', 'Watcher', 'Listener', 'Speaker', 'Thinker']
    return f"{random.choice(adjectives)}_{random.choice(nouns)}_{random.randint(1000, 9999)}"

def get_private_room_id(user1, user2):
    return f"private_{min(user1, user2)}_{max(user1, user2)}"

def create_default_groups():
    default_groups = {
        'general': {
            'id': 'general',
            'name': 'General Chat',
            'description': 'General discussions for everyone',
            'created_by': 'system',
            'created_at': datetime.now(),
            'is_public': True,
            'member_count': 0
        },
        'random': {
            'id': 'random',
            'name': 'Random Talks',
            'description': 'Anything and everything',
            'created_by': 'system',
            'created_at': datetime.now(),
            'is_public': True,
            'member_count': 0
        }
    }
    
    for group_id, group_data in default_groups.items():
        groups[group_id] = group_data

create_default_groups()

@app.route('/')
def index():
    if 'user_id' in session and session['user_id'] in users:
        return redirect(url_for('chat'))
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        
        user = next((u for u in users.values() if u.original_username == username), None)
        
        if user and user.password_hash == hash_password(password):
            session['user_id'] = user.user_id
            session['username'] = user.username
            session.permanent = True
            user.last_seen = datetime.now()
            user.is_online = True
            flash('Login successful!', 'success')
            return redirect(url_for('chat'))
        else:
            flash('Invalid username or password', 'error')
    
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        confirm_password = request.form.get('confirm_password', '').strip()
        
        if not username or len(username) < 3:
            flash('Username must be at least 3 characters long', 'error')
        elif not password or len(password) < 6:
            flash('Password must be at least 6 characters long', 'error')
        elif password != confirm_password:
            flash('Passwords do not match', 'error')
        elif any(u.original_username == username for u in users.values()):
            flash('Username already exists', 'error')
        else:
            user_id = str(uuid.uuid4())[:12]
            anonymous_name = generate_anonymous_name()
            users[user_id] = User(username, hash_password(password), user_id)
            
            # Auto-join default groups
            user_groups[user_id].add('general')
            user_groups[user_id].add('random')
            group_members['general'].add(user_id)
            group_members['random'].add(user_id)
            groups['general']['member_count'] = len(group_members['general'])
            groups['random']['member_count'] = len(group_members['random'])
            
            flash(f'Registration successful! Your anonymous name is: {anonymous_name}', 'success')
            return redirect(url_for('login'))
    
    return render_template('register.html')

@app.route('/chat')
def chat():
    if 'user_id' not in session or session['user_id'] not in users:
        return redirect(url_for('login'))
    
    user_id = session['user_id']
    user = users[user_id]
    
    # Get user's data
    user_friends = [{'user_id': fid, 'username': users[fid].username, 'is_online': users[fid].is_online} 
                   for fid in friends[user_id] if fid in users]
    
    user_groups_list = [groups[gid] for gid in user_groups[user_id] if gid in groups]
    
    # Get online users (non-friends)
    online_users = []
    for uid, user_data in active_users.items():
        if uid != user_id and uid not in friends[user_id]:
            online_users.append({
                'user_id': uid,
                'username': user_data['username'],
                'is_online': True
            })
    
    # Get pending friend requests
    pending_requests = [{'user_id': fid, 'username': users[fid].username} 
                       for fid in friend_requests[user_id] if fid in users]
    
    return render_template('chat.html', 
                         username=user.username,
                         user_id=user_id,
                         friends=user_friends,
                         groups=user_groups_list,
                         online_users=online_users,
                         pending_requests=pending_requests)

# Friend System Endpoints
@app.route('/send_friend_request', methods=['POST'])
def send_friend_request():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in'})
    
    data = request.get_json()
    target_user_id = data.get('user_id')
    
    if not target_user_id or target_user_id not in users:
        return jsonify({'success': False, 'message': 'User not found'})
    
    current_user_id = session['user_id']
    
    if target_user_id == current_user_id:
        return jsonify({'success': False, 'message': 'Cannot send request to yourself'})
    
    if target_user_id in friends[current_user_id]:
        return jsonify({'success': False, 'message': 'Already friends'})
    
    # Add to pending requests
    friend_requests[target_user_id].add(current_user_id)
    
    # Notify target user
    if target_user_id in active_users:
        socketio.emit('friend_request', {
            'from_user_id': current_user_id,
            'from_username': users[current_user_id].username
        }, room=active_users[target_user_id]['sid'])
    
    return jsonify({'success': True, 'message': 'Friend request sent'})

@app.route('/accept_friend_request', methods=['POST'])
def accept_friend_request():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in'})
    
    data = request.get_json()
    from_user_id = data.get('user_id')
    
    current_user_id = session['user_id']
    
    if from_user_id not in friend_requests[current_user_id]:
        return jsonify({'success': False, 'message': 'No pending request'})
    
    # Add each other as friends
    friends[current_user_id].add(from_user_id)
    friends[from_user_id].add(current_user_id)
    friend_requests[current_user_id].discard(from_user_id)
    
    # Notify both users
    if from_user_id in active_users:
        socketio.emit('friend_added', {
            'user_id': current_user_id,
            'username': users[current_user_id].username
        }, room=active_users[from_user_id]['sid'])
    
    if current_user_id in active_users:
        socketio.emit('friend_added', {
            'user_id': from_user_id,
            'username': users[from_user_id].username
        }, room=active_users[current_user_id]['sid'])
    
    return jsonify({'success': True, 'message': 'Friend request accepted'})

@app.route('/remove_friend', methods=['POST'])
def remove_friend():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in'})
    
    data = request.get_json()
    friend_id = data.get('user_id')
    
    current_user_id = session['user_id']
    
    if friend_id not in friends[current_user_id]:
        return jsonify({'success': False, 'message': 'Not friends'})
    
    # Remove from both sides
    friends[current_user_id].discard(friend_id)
    if friend_id in friends:
        friends[friend_id].discard(current_user_id)
    
    return jsonify({'success': True, 'message': 'Friend removed'})

# Group System Endpoints
@app.route('/create_group', methods=['POST'])
def create_group():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in'})
    
    data = request.get_json()
    group_name = data.get('name', '').strip()
    description = data.get('description', '').strip()
    member_ids = data.get('members', [])
    
    if not group_name:
        return jsonify({'success': False, 'message': 'Group name required'})
    
    current_user_id = session['user_id']
    group_id = str(uuid.uuid4())[:8]
    
    # Create group
    groups[group_id] = {
        'id': group_id,
        'name': group_name,
        'description': description,
        'created_by': current_user_id,
        'created_at': datetime.now(),
        'is_public': False,
        'member_count': 1
    }
    
    # Add creator to group
    user_groups[current_user_id].add(group_id)
    group_members[group_id].add(current_user_id)
    
    # Add members to group
    for member_id in member_ids:
        if member_id in users and member_id in friends[current_user_id]:
            user_groups[member_id].add(group_id)
            group_members[group_id].add(member_id)
    
    groups[group_id]['member_count'] = len(group_members[group_id])
    
    # Notify members
    for member_id in group_members[group_id]:
        if member_id in active_users:
            socketio.emit('group_created', {
                'group_id': group_id,
                'group_name': group_name,
                'created_by': users[current_user_id].username
            }, room=active_users[member_id]['sid'])
    
    return jsonify({'success': True, 'group_id': group_id, 'message': 'Group created successfully'})

@app.route('/add_to_group', methods=['POST'])
def add_to_group():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in'})
    
    data = request.get_json()
    group_id = data.get('group_id')
    user_id = data.get('user_id')
    
    if group_id not in groups:
        return jsonify({'success': False, 'message': 'Group not found'})
    
    current_user_id = session['user_id']
    
    if current_user_id not in group_members[group_id]:
        return jsonify({'success': False, 'message': 'Not a group member'})
    
    if user_id not in users:
        return jsonify({'success': False, 'message': 'User not found'})
    
    # Add user to group
    user_groups[user_id].add(group_id)
    group_members[group_id].add(user_id)
    groups[group_id]['member_count'] = len(group_members[group_id])
    
    # Notify group and user
    group_message = {
        'id': str(uuid.uuid4()),
        'user_id': 'system',
        'username': 'System',
        'message': f'{users[user_id].username} was added to the group',
        'timestamp': time.time(),
        'room': group_id,
        'type': 'system'
    }
    group_messages[group_id].append(group_message)
    socketio.emit('group_message', group_message, room=group_id)
    
    if user_id in active_users:
        socketio.emit('added_to_group', {
            'group_id': group_id,
            'group_name': groups[group_id]['name']
        }, room=active_users[user_id]['sid'])
    
    return jsonify({'success': True, 'message': 'User added to group'})

@app.route('/leave_group', methods=['POST'])
def leave_group():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in'})
    
    data = request.get_json()
    group_id = data.get('group_id')
    
    current_user_id = session['user_id']
    
    if group_id not in groups or current_user_id not in group_members[group_id]:
        return jsonify({'success': False, 'message': 'Not in group'})
    
    # Remove user from group
    user_groups[current_user_id].discard(group_id)
    group_members[group_id].discard(current_user_id)
    groups[group_id]['member_count'] = len(group_members[group_id])
    
    # Notify group
    leave_message = {
        'id': str(uuid.uuid4()),
        'user_id': 'system',
        'username': 'System',
        'message': f'{users[current_user_id].username} left the group',
        'timestamp': time.time(),
        'room': group_id,
        'type': 'system'
    }
    group_messages[group_id].append(leave_message)
    socketio.emit('group_message', leave_message, room=group_id)
    
    return jsonify({'success': True, 'message': 'Left group successfully'})

# Message Endpoints
@app.route('/get_private_chat_history', methods=['GET'])
def get_private_chat_history():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in'})
    
    current_user_id = session['user_id']
    target_user_id = request.args.get('user_id')
    
    if not target_user_id:
        return jsonify({'success': False, 'message': 'User ID required'})
    
    room_id = get_private_room_id(current_user_id, target_user_id)
    chat_history = private_messages.get(room_id, [])
    
    return jsonify({'success': True, 'messages': chat_history[-100:]})

@app.route('/get_group_chat_history', methods=['GET'])
def get_group_chat_history():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in'})
    
    group_id = request.args.get('group_id')
    
    if not group_id or group_id not in groups:
        return jsonify({'success': False, 'message': 'Group not found'})
    
    chat_history = group_messages.get(group_id, [])
    
    return jsonify({'success': True, 'messages': chat_history[-100:]})

# Stories Endpoints
@app.route('/post_story', methods=['POST'])
def post_story():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not logged in'})
    
    data = request.get_json()
    story_text = data.get('story', '').strip()
    
    if not story_text:
        return jsonify({'success': False, 'message': 'Story text required'})
    
    user_id = session['user_id']
    story_id = str(uuid.uuid4())
    
    if user_id not in user_stories:
        user_stories[user_id] = []
    
    story = {
        'id': story_id,
        'user_id': user_id,
        'username': users[user_id].username,
        'text': story_text,
        'timestamp': time.time(),
        'expires_at': time.time() + 86400
    }
    
    user_stories[user_id].append(story)
    
    socketio.emit('new_story', story, broadcast=True)
    
    return jsonify({'success': True, 'message': 'Story posted successfully'})

@app.route('/get_stories', methods=['GET'])
def get_stories():
    current_time = time.time()
    for user_id in list(user_stories.keys()):
        user_stories[user_id] = [story for story in user_stories[user_id] if story['expires_at'] > current_time]
        if not user_stories[user_id]:
            del user_stories[user_id]
    
    all_stories = []
    for stories in user_stories.values():
        all_stories.extend(stories)
    
    all_stories.sort(key=lambda x: x['timestamp'], reverse=True)
    return jsonify({'stories': all_stories})

@app.route('/logout')
def logout():
    user_id = session.get('user_id')
    if user_id and user_id in users:
        users[user_id].is_online = False
        users[user_id].last_seen = datetime.now()
        if user_id in active_users:
            del active_users[user_id]
    
    session.clear()
    flash('You have been logged out successfully', 'success')
    return redirect(url_for('login'))

# Socket Events with Error Handling
@socketio.on('connect')
def handle_connect():
    try:
        print(f"🔗 Client connecting: {request.sid}")
        user_id = session.get('user_id')
        if user_id and user_id in users:
            user = users[user_id]
            user.is_online = True
            user.last_seen = datetime.now()
            
            active_users[user_id] = {
                'username': user.username,
                'sid': request.sid,
                'joined_at': datetime.now()
            }
            
            # Join user to their personal room
            join_room(user_id)
            
            # Join user's groups
            for group_id in user_groups[user_id]:
                join_room(group_id)
                print(f"👤 User {user.username} joined group {group_id}")
            
            # Update online status for friends
            for friend_id in friends[user_id]:
                if friend_id in active_users:
                    socketio.emit('friend_online', {
                        'user_id': user_id,
                        'username': user.username
                    }, room=active_users[friend_id]['sid'])
            
            update_user_lists()
            print(f"✅ User {user.username} connected successfully")
            
            # Send connection success message
            socketio.emit('connection_success', {
                'message': 'Connected to chat server'
            }, room=request.sid)
            
    except Exception as e:
        print(f"❌ Connection error: {str(e)}")
        socketio.emit('connection_error', {
            'message': 'Failed to connect to chat server'
        }, room=request.sid)

@socketio.on('disconnect')
def handle_disconnect():
    try:
        print(f"🔌 Client disconnecting: {request.sid}")
        user_id = session.get('user_id')
        if user_id and user_id in users:
            user = users[user_id]
            user.is_online = False
            user.last_seen = datetime.now()
            
            if user_id in active_users:
                username = active_users[user_id]['username']
                del active_users[user_id]
                
                # Update offline status for friends
                for friend_id in friends[user_id]:
                    if friend_id in active_users:
                        socketio.emit('friend_offline', {
                            'user_id': user_id,
                            'username': username
                        }, room=active_users[friend_id]['sid'])
                
                update_user_lists()
                print(f"✅ User {username} disconnected successfully")
                
    except Exception as e:
        print(f"❌ Disconnection error: {str(e)}")

@socketio.on('join_private_chat')
def handle_join_private_chat(data):
    try:
        user_id = session.get('user_id')
        target_user_id = data.get('target_user_id')
        
        if user_id and target_user_id and target_user_id in users:
            room_id = get_private_room_id(user_id, target_user_id)
            join_room(room_id)
            print(f"🔒 User {user_id} joined private chat with {target_user_id}")
            
    except Exception as e:
        print(f"❌ Join private chat error: {str(e)}")

@socketio.on('send_private_message')
def handle_send_private_message(data):
    try:
        user_id = session.get('user_id')
        target_user_id = data.get('target_user_id')
        message_text = data.get('message', '').strip()
        
        if user_id and target_user_id and message_text:
            room_id = get_private_room_id(user_id, target_user_id)
            
            # Create private message
            msg_data = {
                'id': str(uuid.uuid4()),
                'from_user_id': user_id,
                'from_username': users[user_id].username,
                'to_user_id': target_user_id,
                'message': message_text,
                'timestamp': time.time(),
                'type': 'private'
            }
            
            # Store private message
            private_messages[room_id].append(msg_data)
            
            # Keep only last 200 messages per private chat
            if len(private_messages[room_id]) > 200:
                private_messages[room_id].pop(0)
            
            # Send to both users
            socketio.emit('private_message', msg_data, room=room_id)
            
            # Notify target user if they are online
            if target_user_id in active_users:
                socketio.emit('new_private_message', {
                    'from_user_id': user_id,
                    'from_username': users[user_id].username,
                    'message_preview': message_text[:50] + '...' if len(message_text) > 50 else message_text
                }, room=active_users[target_user_id]['sid'])
            
            print(f"📨 Private message sent from {user_id} to {target_user_id}")
            
    except Exception as e:
        print(f"❌ Send private message error: {str(e)}")
        socketio.emit('message_error', {
            'message': 'Failed to send message'
        }, room=request.sid)

@socketio.on('send_group_message')
def handle_send_group_message(data):
    try:
        user_id = session.get('user_id')
        group_id = data.get('group_id')
        message_text = data.get('message', '').strip()
        
        if user_id and group_id and message_text and group_id in user_groups[user_id]:
            # Create group message
            msg_data = {
                'id': str(uuid.uuid4()),
                'user_id': user_id,
                'username': users[user_id].username,
                'message': message_text,
                'timestamp': time.time(),
                'room': group_id,
                'type': 'group_message'
            }
            
            # Store group message
            group_messages[group_id].append(msg_data)
            
            # Keep only last 500 messages per group
            if len(group_messages[group_id]) > 500:
                group_messages[group_id].pop(0)
            
            # Send to group
            socketio.emit('group_message', msg_data, room=group_id)
            print(f"🏠 Group message sent to {group_id} by {user_id}")
            
    except Exception as e:
        print(f"❌ Send group message error: {str(e)}")
        socketio.emit('message_error', {
            'message': 'Failed to send group message'
        }, room=request.sid)

@socketio.on('typing_start')
def handle_typing_start(data):
    try:
        user_id = session.get('user_id')
        target_user_id = data.get('target_user_id')
        chat_type = data.get('chat_type')  # 'private' or 'group'
        
        if user_id and target_user_id:
            if chat_type == 'private':
                room_id = get_private_room_id(user_id, target_user_id)
                socketio.emit('user_typing', {
                    'user_id': user_id,
                    'username': users[user_id].username,
                    'typing': True
                }, room=room_id)
            elif chat_type == 'group':
                socketio.emit('user_typing', {
                    'user_id': user_id,
                    'username': users[user_id].username,
                    'typing': True
                }, room=target_user_id)
                
    except Exception as e:
        print(f"❌ Typing start error: {str(e)}")

@socketio.on('typing_stop')
def handle_typing_stop(data):
    try:
        user_id = session.get('user_id')
        target_user_id = data.get('target_user_id')
        chat_type = data.get('chat_type')
        
        if user_id and target_user_id:
            if chat_type == 'private':
                room_id = get_private_room_id(user_id, target_user_id)
                socketio.emit('user_typing', {
                    'user_id': user_id,
                    'username': users[user_id].username,
                    'typing': False
                }, room=room_id)
            elif chat_type == 'group':
                socketio.emit('user_typing', {
                    'user_id': user_id,
                    'username': users[user_id].username,
                    'typing': False
                }, room=target_user_id)
                
    except Exception as e:
        print(f"❌ Typing stop error: {str(e)}")

def update_user_lists():
    try:
        online_users = [{
            'user_id': user_id,
            'username': user['username'],
            'status': 'online'
        } for user_id, user in active_users.items()]
        
        socketio.emit('user_list_update', {'users': online_users}, broadcast=True)
        print("👥 User list updated")
        
    except Exception as e:
        print(f"❌ Update user list error: {str(e)}")

if __name__ == '__main__':
    print("🚀 Starting Anonymous WhatsApp-like Chat Application")
    print("📡 Server Ready on http://localhost:5000")
    print("💬 Features: Private Chat, Groups, Friends, Stories, WebSocket")
    print("🔧 Debug mode: ON")
    
    socketio.run(app, 
                host='0.0.0.0', 
                port=5000, 
                debug=True, 
                allow_unsafe_werkzeug=True,
                use_reloader=True)