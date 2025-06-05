use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, TimeDuration};

#[table(name = room, public)]
pub struct Room {
    #[primary_key]
    code: String,
    host_identity: Identity,
    password_hash: String,
    message_ttl_seconds: u32, // 0 means no auto-deletion
    messages_enabled: bool,
    created_at: Timestamp,
    last_activity: Timestamp,
}

#[table(name = sandbox_user, public)]
pub struct SandboxUser {
    #[primary_key]
    identity: Identity,
    name: Option<String>,
    cursor_x: f32,
    cursor_y: f32,
    color: String,
    last_activity: Timestamp,
    room_code: Option<String>, // Which room the user is in
}

#[table(name = live_typing, public)]
pub struct LiveTyping {
    #[primary_key]
    identity: Identity,
    text: String,
    position_x: f32,
    position_y: f32,
    is_typing: bool,
    selection_start: u32,
    selection_end: u32,
    updated_at: Timestamp,
    room_code: String, // Room-scoped
}

#[table(name = sandbox_message, public)]
pub struct SandboxMessage {
    #[primary_key]
    #[auto_inc]
    id: u64,
    sender_identity: Identity,
    text: String,
    position_x: f32,
    position_y: f32,
    created_at: Timestamp,
    room_code: String, // Room-scoped
}

#[table(name = cleanup_schedule, scheduled(cleanup_old_messages))]
pub struct CleanupSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

fn get_user_color(index: u32) -> String {
    let colors = vec![
        "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", 
        "#FECA57", "#FF9FF3", "#54A0FF", "#48DBFB"
    ];
    colors[(index as usize) % colors.len()].to_string()
}

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    log::info!("🚀 Sandbox module initialized at {}", ctx.timestamp.to_micros_since_unix_epoch());
    
    // Schedule cleanup to run every 3 seconds
    let cleanup_interval = TimeDuration::from_micros(1_000_000);
    ctx.db.cleanup_schedule().insert(CleanupSchedule {
        scheduled_id: 0, // auto_inc will assign actual value
        scheduled_at: cleanup_interval.into(),
    });
    log::info!("⏰ Scheduled cleanup to run every 3 seconds");
}

#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    let user_count = ctx.db.sandbox_user().iter().count() as u32;
    
    ctx.db.sandbox_user().insert(SandboxUser {
        identity: ctx.sender,
        name: None,
        cursor_x: 50.0,
        cursor_y: 50.0,
        color: get_user_color(user_count),
        last_activity: ctx.timestamp,
        room_code: None, // Not in any room initially
    });
    
    log::info!("User connected: {:?}", ctx.sender);
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    // Leave room if in one
    if let Some(user) = ctx.db.sandbox_user().identity().find(ctx.sender) {
        if let Some(room_code) = user.room_code {
            let _ = leave_room_internal(ctx, &room_code);
        }
    }
    
    ctx.db.sandbox_user().identity().delete(ctx.sender);
    
    log::info!("User disconnected and cleaned up: {:?}", ctx.sender);
}

#[reducer]
pub fn update_cursor(ctx: &ReducerContext, x: f32, y: f32) -> Result<(), String> {
    if let Some(user) = ctx.db.sandbox_user().identity().find(ctx.sender) {
        ctx.db.sandbox_user().identity().update(SandboxUser {
            cursor_x: x,
            cursor_y: y,
            last_activity: ctx.timestamp,
            ..user
        });
        Ok(())
    } else {
        Err("User not found in sandbox".to_string())
    }
}

#[reducer]
pub fn update_typing(ctx: &ReducerContext, text: String, x: f32, y: f32, selection_start: u32, selection_end: u32) -> Result<(), String> {
    let user = ctx.db.sandbox_user().identity().find(ctx.sender)
        .ok_or("User not found")?;
    
    let room_code = user.room_code.ok_or("User not in a room")?;
    
    let text = if text.len() > 200 {
        text.chars().take(200).collect()
    } else {
        text
    };
    
    let is_typing = !text.is_empty();
    
    // Remove existing typing states for this user in this room
    let existing_typing: Vec<_> = ctx.db.live_typing().iter()
        .filter(|t| t.identity == ctx.sender && t.room_code == room_code)
        .map(|t| t.identity.clone())
        .collect();
    
    for identity in existing_typing {
        ctx.db.live_typing().identity().delete(&identity);
    }
    
    // Insert new typing state
    ctx.db.live_typing().insert(LiveTyping {
            identity: ctx.sender,
            text,
            position_x: x,
            position_y: y,
            is_typing,
            selection_start,
            selection_end,
            updated_at: ctx.timestamp,
        room_code,
        });
    
        Ok(())
}

#[reducer]
pub fn set_display_name(ctx: &ReducerContext, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if name.len() > 20 {
        return Err("Name too long (max 20 characters)".to_string());
    }
    
    if let Some(user) = ctx.db.sandbox_user().identity().find(ctx.sender) {
        ctx.db.sandbox_user().identity().update(SandboxUser {
            name: Some(name),
            ..user
        });
        Ok(())
    } else {
        Err("User not found in sandbox".to_string())
    }
}

#[reducer]
pub fn send_message(ctx: &ReducerContext, text: String, x: f32, y: f32) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Message cannot be empty".to_string());
    }
    if text.len() > 200 {
        return Err("Message too long (max 200 characters)".to_string());
    }
    
    let user = ctx.db.sandbox_user().identity().find(ctx.sender)
        .ok_or("User not found")?;
    
    let room_code = user.room_code.ok_or("User not in a room")?;
    
    // Check if room allows messages
    let room = ctx.db.room().code().find(&room_code)
        .ok_or("Room not found")?;
    
    if !room.messages_enabled {
        return Err("Messages are disabled in this room".to_string());
    }
    
    let message = ctx.db.sandbox_message().insert(SandboxMessage {
        id: 0, // auto_inc will assign actual value
        sender_identity: ctx.sender,
        text: text.clone(),
        position_x: x,
        position_y: y,
        created_at: ctx.timestamp,
        room_code: room_code.clone(),
    });
    
    log::info!("📩 Message {} sent in room {} at {}: '{}'", message.id, room_code, ctx.timestamp.to_micros_since_unix_epoch(), text);
    
    // Clear typing state after sending message
    let typing_to_clear: Vec<_> = ctx.db.live_typing().iter()
        .filter(|t| t.identity == ctx.sender && t.room_code == room_code)
        .map(|t| t.identity.clone())
        .collect();
    
    for identity in typing_to_clear {
        ctx.db.live_typing().identity().delete(&identity);
    }
    
    ctx.db.live_typing().insert(LiveTyping {
            identity: ctx.sender,
            text: String::new(),
            position_x: 0.0,
            position_y: 0.0,
            is_typing: false,
            selection_start: 0,
            selection_end: 0,
            updated_at: ctx.timestamp,
        room_code,
    });
    
    // Schedule room-specific cleanup if TTL is set
    if room.message_ttl_seconds > 0 {
        let cleanup_time = TimeDuration::from_micros((room.message_ttl_seconds as i64) * 1_000_000);
        ctx.db.cleanup_schedule().insert(CleanupSchedule {
            scheduled_id: 0,
            scheduled_at: cleanup_time.into(),
        });
    }
    
    Ok(())
}

#[reducer]
pub fn dismiss_message(ctx: &ReducerContext, message_id: u64) -> Result<(), String> {
    // Find the message
    if let Some(message) = ctx.db.sandbox_message().id().find(message_id) {
        // Verify user is in the same room
        let user = ctx.db.sandbox_user().identity().find(ctx.sender)
            .ok_or("User not found")?;
        
        if user.room_code.as_ref() != Some(&message.room_code) {
            return Err("You can only dismiss messages in your current room".to_string());
        }
        
        // Only allow the sender to dismiss their own message
        if message.sender_identity != ctx.sender {
            return Err("You can only dismiss your own messages".to_string());
        }
        
        // Delete the message
        ctx.db.sandbox_message().id().delete(message_id);
        log::info!("🗑️ Message {} dismissed by user {:?}", message_id, ctx.sender);
        Ok(())
    } else {
        Err("Message not found".to_string())
    }
}

#[reducer]
pub fn cleanup_old_messages(ctx: &ReducerContext, _arg: CleanupSchedule) -> Result<(), String> {
    // Only allow the module itself to call this reducer
    if ctx.sender != ctx.identity() {
        return Err("Cleanup reducer may only be called by the scheduler".to_string());
    }
    
    log::info!("🧹 Cleanup reducer running at {}", ctx.timestamp.to_micros_since_unix_epoch());
    
    let now = ctx.timestamp;
    
    // Clean up messages based on room TTL settings
    for room in ctx.db.room().iter() {
        if room.message_ttl_seconds == 0 {
            continue; // No TTL for this room
        }
        
        let cutoff_micros = now.to_micros_since_unix_epoch() - ((room.message_ttl_seconds as i64) * 1_000_000);
    let cutoff_timestamp = Timestamp::from_micros_since_unix_epoch(cutoff_micros);
    
        let mut deleted_count = 0;
        for message in ctx.db.sandbox_message().iter().filter(|m| m.room_code == room.code) {
            if message.created_at < cutoff_timestamp {
                ctx.db.sandbox_message().id().delete(message.id);
                deleted_count += 1;
            }
        }
        
        if deleted_count > 0 {
            log::info!("🗑️ Deleted {} old messages from room {}", deleted_count, room.code);
        }
    }
    
    // Clean up old default messages (backwards compatibility)
    let default_cutoff = now.to_micros_since_unix_epoch() - (8 * 1_000_000);
    let default_cutoff_timestamp = Timestamp::from_micros_since_unix_epoch(default_cutoff);
    
    for message in ctx.db.sandbox_message().iter().filter(|m| m.room_code.is_empty()) {
        if message.created_at < default_cutoff_timestamp {
            ctx.db.sandbox_message().id().delete(message.id);
        }
    }
    
    Ok(())
}

#[reducer]
pub fn create_room(ctx: &ReducerContext, room_code: String, password_hash: String, message_ttl_seconds: u32, messages_enabled: bool) -> Result<(), String> {
    if room_code.len() != 6 {
        return Err("Room code must be exactly 6 characters".to_string());
    }
    
    log::info!("🏠 Creating room {} with password_hash length: {}", room_code, password_hash.len());
    log::info!("🏠 Password hash preview: {}", if password_hash.is_empty() { "(empty)".to_string() } else { format!("{}...", &password_hash[..16.min(password_hash.len())]) });
    
    // Password hash can be empty for public rooms
    
    // Ensure user exists
    if ctx.db.sandbox_user().identity().find(ctx.sender).is_none() {
        return Err("User not found".to_string());
    }
    
    // Check if room already exists
    if ctx.db.room().code().find(&room_code).is_some() {
        return Err("Room code already exists".to_string());
    }
    
    // Create room (password_hash is already hashed by client or empty)
    ctx.db.room().insert(Room {
        code: room_code.clone(),
        host_identity: ctx.sender,
        password_hash: password_hash.clone(),
        message_ttl_seconds,
        messages_enabled,
        created_at: ctx.timestamp,
        last_activity: ctx.timestamp,
    });
    
    log::info!("🏠 Room {} created by {:?}", room_code, ctx.sender);
    
    // Auto-join the creator to the room
    join_room_internal(ctx, &room_code)?;
    
    Ok(())
}

#[reducer]
pub fn join_room(ctx: &ReducerContext, room_code: String, password_hash: String) -> Result<(), String> {
    let room = ctx.db.room().code().find(&room_code)
        .ok_or("Room not found")?;
    
    log::info!("🔑 Join attempt for room {}", room_code);
    log::info!("🔑 Provided password_hash length: {}", password_hash.len());
    log::info!("🔑 Provided password_hash preview: {}", if password_hash.is_empty() { "(empty)".to_string() } else { format!("{}...", &password_hash[..16.min(password_hash.len())]) });
    log::info!("🔑 Stored password_hash length: {}", room.password_hash.len());
    log::info!("🔑 Stored password_hash preview: {}", if room.password_hash.is_empty() { "(empty)".to_string() } else { format!("{}...", &room.password_hash[..16.min(room.password_hash.len())]) });
    log::info!("🔑 Hashes match: {}", password_hash == room.password_hash);
    
    // Verify password hash matches (both are already hashed by client)
    if password_hash != room.password_hash {
        log::info!("🔑 Password verification failed for room {}", room_code);
        return Err("Invalid password".to_string());
    }
    
    log::info!("🔑 Password verification successful for room {}", room_code);
    
    join_room_internal(ctx, &room_code)?;
    
    // Update room last activity
    ctx.db.room().code().update(Room {
        last_activity: ctx.timestamp,
        ..room
    });
    
    Ok(())
}

fn join_room_internal(ctx: &ReducerContext, room_code: &str) -> Result<(), String> {
    let mut user = ctx.db.sandbox_user().identity().find(ctx.sender)
        .ok_or("User not found")?;
    
    // Leave current room if in one
    if let Some(current_room) = &user.room_code {
        leave_room_internal(ctx, current_room)?;
    }
    
    // Join new room
    user.room_code = Some(room_code.to_string());
    ctx.db.sandbox_user().identity().update(user);
    
    // Create typing state for this room
    ctx.db.live_typing().insert(LiveTyping {
        identity: ctx.sender,
        text: String::new(),
        position_x: 0.0,
        position_y: 0.0,
        is_typing: false,
        selection_start: 0,
        selection_end: 0,
        updated_at: ctx.timestamp,
        room_code: room_code.to_string(),
    });
    
    log::info!("👤 User {:?} joined room {}", ctx.sender, room_code);
    Ok(())
}

#[reducer]
pub fn leave_room(ctx: &ReducerContext) -> Result<(), String> {
    let user = ctx.db.sandbox_user().identity().find(ctx.sender)
        .ok_or("User not found")?;
    
    if let Some(room_code) = &user.room_code {
        leave_room_internal(ctx, room_code)?;
    }
    
    Ok(())
}

fn leave_room_internal(ctx: &ReducerContext, room_code: &str) -> Result<(), String> {
    // Update user to remove room
    if let Some(mut user) = ctx.db.sandbox_user().identity().find(ctx.sender) {
        user.room_code = None;
        ctx.db.sandbox_user().identity().update(user);
    }
    
    // Remove typing states for this user in this room
    let typing_to_delete: Vec<_> = ctx.db.live_typing().iter()
        .filter(|t| t.identity == ctx.sender && t.room_code == room_code)
        .map(|t| t.identity.clone())
        .collect();
    
    for identity in typing_to_delete {
        ctx.db.live_typing().identity().delete(&identity);
    }
    
    // Delete user's messages in this room
    let messages_to_delete: Vec<_> = ctx.db.sandbox_message().iter()
        .filter(|m| m.sender_identity == ctx.sender && m.room_code == room_code)
        .map(|m| m.id)
        .collect();
    
    for message_id in messages_to_delete {
        ctx.db.sandbox_message().id().delete(&message_id);
    }
    
    log::info!("👤 User {:?} left room {}", ctx.sender, room_code);
    
    // Check if room is now empty
    let users_in_room = ctx.db.sandbox_user().iter()
        .filter(|u| u.room_code.as_ref() == Some(&room_code.to_string()))
        .count();
    
    if users_in_room == 0 {
        // Delete the room and all its data
        if let Some(_room) = ctx.db.room().code().find(&room_code.to_string()) {
            // Delete all messages in room
            let room_messages: Vec<_> = ctx.db.sandbox_message().iter()
                .filter(|m| m.room_code == room_code)
                .map(|m| m.id)
                .collect();
            
            for message_id in room_messages {
                ctx.db.sandbox_message().id().delete(&message_id);
            }
            
            // Delete all typing states in room
            let room_typing: Vec<_> = ctx.db.live_typing().iter()
                .filter(|t| t.room_code == room_code)
                .map(|t| t.identity.clone())
                .collect();
            
            for identity in room_typing {
                ctx.db.live_typing().identity().delete(&identity);
            }
            
            // Delete the room
            ctx.db.room().code().delete(&room_code.to_string());
            log::info!("🏚️ Room {} deleted (empty)", room_code);
        }
    }
    
    Ok(())
}

#[reducer]
pub fn update_room_config(ctx: &ReducerContext, message_ttl_seconds: u32, messages_enabled: bool) -> Result<(), String> {
    let user = ctx.db.sandbox_user().identity().find(ctx.sender)
        .ok_or("User not found")?;
    
    let room_code = user.room_code.ok_or("User not in a room")?;
    
    let mut room = ctx.db.room().code().find(&room_code)
        .ok_or("Room not found")?;
    
    // Only host can update config
    if room.host_identity != ctx.sender {
        return Err("Only the room host can update configuration".to_string());
    }
    
    room.message_ttl_seconds = message_ttl_seconds;
    room.messages_enabled = messages_enabled;
    ctx.db.room().code().update(room);
    
    log::info!("⚙️ Room {} config updated by host", room_code);
    Ok(())
}
