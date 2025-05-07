# Brackeys API Server

This is a Node.js TypeScript API server for querying the Brackeys MariaDB database. It provides RESTful endpoints for accessing and managing the database tables.

## Setup and Installation

1. Install dependencies:
```bash
cd server
npm install
```

2. Configure environment variables:
- Copy `.env.example` to `.env`
- Update the values in `.env` to match your MariaDB configuration

3. Run the server in development mode:
```bash
npm run dev
```

## API Endpoints

### Rules

- `GET /api/guilds/:guildId/rules` - Get all rules for a guild
- `GET /api/guilds/:guildId/rules/:ruleId` - Get a specific rule
- `POST /api/guilds/:guildId/rules` - Create a new rule
- `PUT /api/guilds/:guildId/rules/:ruleId` - Update a rule
- `DELETE /api/guilds/:guildId/rules/:ruleId` - Delete a rule

### Infractions

- `GET /api/guilds/:guildId/infractions` - Get all infractions for a guild
- `GET /api/guilds/infractions/:id` - Get a specific infraction
- `POST /api/guilds/infractions` - Create a new infraction
- `GET /api/guilds/:guildId/users/:userId/infractions/count` - Get infraction count for a user

### Health Check

- `GET /health` - Check if the API is running

## Database Structure

The API is designed to work with the following tables:
- `Rule`
- `Infraction`
- `AltAccount`
- `BlockedReporter`
- `DeletedMessage`
- `MemberNote`
- `Mute`
- `ReportedMessage`
- `StaffMessage`
- `TemporaryBan`
- `TrackedMessages`

## Development

To add support for additional tables, follow these steps:

1. Create a new service in `src/services`
2. Create a new controller in `src/controllers`
3. Create routes in `src/routes`
4. Register the routes in `src/index.ts`
