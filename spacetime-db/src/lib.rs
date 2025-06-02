use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp};

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

fn get_user_color(index: u32) -> String {
    let colors = vec![
        "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", 
        "#FECA57", "#FF9FF3", "#54A0FF", "#48DBFB"
    ];
    colors[(index as usize) % colors.len()].to_string()
}

#[reducer(init)]
pub fn init(_ctx: &ReducerContext) {
    log::info!("Sandbox module initialized");
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
