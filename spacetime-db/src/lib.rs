use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, TimeDuration};

#[table(name = sandbox_user, public)]
pub struct SandboxUser {
    #[primary_key]
    identity: Identity,
    name: Option<String>,
    cursor_x: f32,
    cursor_y: f32,
    color: String,
    last_activity: Timestamp,
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
    });
    
    ctx.db.live_typing().insert(LiveTyping {
        identity: ctx.sender,
        text: String::new(),
        position_x: 0.0,
        position_y: 0.0,
        is_typing: false,
        selection_start: 0,
        selection_end: 0,
        updated_at: ctx.timestamp,
    });
    
    log::info!("User connected: {:?}", ctx.sender);
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    ctx.db.sandbox_user().identity().delete(ctx.sender);
    ctx.db.live_typing().identity().delete(ctx.sender);
    
    // Delete all messages from this user
    for message in ctx.db.sandbox_message().iter().filter(|m| m.sender_identity == ctx.sender) {
        ctx.db.sandbox_message().id().delete(message.id);
    }
    
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
    let text = if text.len() > 200 {
        text.chars().take(200).collect()
    } else {
        text
    };
    
    let is_typing = !text.is_empty();
    
    if let Some(_typing) = ctx.db.live_typing().identity().find(ctx.sender) {
        ctx.db.live_typing().identity().update(LiveTyping {
            identity: ctx.sender,
            text,
            position_x: x,
            position_y: y,
            is_typing,
            selection_start,
            selection_end,
            updated_at: ctx.timestamp,
        });
        Ok(())
    } else {
        Err("Typing state not found".to_string())
    }
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
    
    // Verify user exists
    if ctx.db.sandbox_user().identity().find(ctx.sender).is_none() {
        return Err("User not found in sandbox".to_string());
    }
    
    let message = ctx.db.sandbox_message().insert(SandboxMessage {
        id: 0, // auto_inc will assign actual value
        sender_identity: ctx.sender,
        text: text.clone(),
        position_x: x,
        position_y: y,
        created_at: ctx.timestamp,
    });
    
    log::info!("📩 Message {} sent at {}: '{}'", message.id, ctx.timestamp.to_micros_since_unix_epoch(), text);
    
    // Clear typing state after sending message
    if let Some(_typing) = ctx.db.live_typing().identity().find(ctx.sender) {
        ctx.db.live_typing().identity().update(LiveTyping {
            identity: ctx.sender,
            text: String::new(),
            position_x: 0.0,
            position_y: 0.0,
            is_typing: false,
            selection_start: 0,
            selection_end: 0,
            updated_at: ctx.timestamp,
        });
    }
    
    Ok(())
}

#[reducer]
pub fn cleanup_old_messages(ctx: &ReducerContext, _arg: CleanupSchedule) -> Result<(), String> {
    // Only allow the module itself to call this reducer
    if ctx.sender != ctx.identity() {
        return Err("Cleanup reducer may only be called by the scheduler".to_string());
    }
    
    log::info!("🧹 Cleanup reducer running at {}", ctx.timestamp.to_micros_since_unix_epoch());
    
    // Get current time and calculate cutoff (8 seconds ago)
    let now = ctx.timestamp;
    let cutoff_micros = now.to_micros_since_unix_epoch() - (8 * 1_000_000); // 8 seconds in microseconds
    let cutoff_timestamp = Timestamp::from_micros_since_unix_epoch(cutoff_micros);
    
    log::info!("🕐 Looking for messages older than {}", cutoff_timestamp.to_micros_since_unix_epoch());
    
    let total_messages = ctx.db.sandbox_message().iter().count();
    let mut deleted_count = 0;
    
    for message in ctx.db.sandbox_message().iter() {
        log::debug!("📨 Message {} created at {}, cutoff at {}", 
                   message.id, 
                   message.created_at.to_micros_since_unix_epoch(),
                   cutoff_timestamp.to_micros_since_unix_epoch());
                   
        if message.created_at < cutoff_timestamp {
            log::info!("🗑️ Deleting message {} (age: {} micros)", 
                      message.id,
                      now.to_micros_since_unix_epoch() - message.created_at.to_micros_since_unix_epoch());
            ctx.db.sandbox_message().id().delete(message.id);
            deleted_count += 1;
        }
    }
    
    log::info!("🧹 Cleanup complete: {}/{} messages deleted", deleted_count, total_messages);
    
    Ok(())
}
