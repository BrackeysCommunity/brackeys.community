# SSR Configuration Guide

This document explains how to configure Server-Side Rendering (SSR) for routes in the Brackeys Community application built with TanStack Start.

## SSR Modes

TanStack Start supports three rendering strategies:

### 1. Full SSR (Default)

**When to use**: SEO-critical pages, public content, initial page loads

**Configuration**:
```typescript
export const Route = createFileRoute('/my-route')({
  component: MyComponent,
  loader: async () => {
    // Data fetched server-side and included in HTML
    return await fetchData();
  },
});
```

**Behavior**:
- Server renders complete HTML with data
- Client hydrates the pre-rendered HTML
- Best for SEO and initial load performance
- Larger HTML payload

**Example Routes**:
- `/` - Home page
- `/resources` - Games & tools listing
- `/collaborations/` - Collaboration posts

### 2. Data-Only SSR

**When to use**: Interactive pages where SEO matters but UI is complex

**Configuration**:
```typescript
export const Route = createFileRoute('/my-route')({
  ssr: 'data-only',
  component: MyComponent,
  loader: async () => {
    // Data fetched server-side, but UI rendered client-side
    return await fetchData();
  },
});
```

**Behavior**:
- Server fetches data and sends in initial payload
- Client receives data and renders UI
- Good balance between performance and interactivity
- Smaller HTML payload than full SSR

**Example Routes**:
- `/profile` - User profile with complex UI
- `/collaboration-hub` - Dashboard with many interactions

### 3. SPA Mode (Client-Only)

**When to use**: Fully interactive apps, authenticated areas, real-time features

**Configuration**:
```typescript
export const Route = createFileRoute('/my-route')({
  ssr: false,
  component: MyComponent,
  // No loader - data fetched client-side
});
```

**Behavior**:
- No server rendering
- Client fetches all data after page load
- Best for highly interactive features
- No SEO benefits

**Example Routes**:
- `/sandbox` - Real-time multiplayer canvas
- Authenticated user dashboards
- Admin panels

## Server Functions

Server functions enable type-safe server-side code execution. They work with all SSR modes.

### Creating a Server Function

```typescript
// src/server/my-feature/getData.ts
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

export const getData = createServerFn({ method: 'GET' })
  .validator(z.object({
    id: z.string(),
  }))
  .handler(async ({ data }) => {
    // This code runs ONLY on the server
    // You can access environment variables, databases, etc.
    const result = await database.query('SELECT * FROM table WHERE id = $1', [data.id]);
    return result;
  });
```

### Using in a Route Loader

```typescript
// src/routes/my-route.tsx
import { createFileRoute } from '@tanstack/react-router';
import { getData } from '@/server/my-feature/getData';

export const Route = createFileRoute('/my-route')({
  component: MyComponent,
  loader: async () => {
    const data = await getData({ data: { id: '123' } });
    return data;
  },
});

function MyComponent() {
  const data = Route.useLoaderData();
  return <div>{/* Use data */}</div>;
}
```

### Using on the Client

Server functions can also be called from client components:

```typescript
import { getData } from '@/server/my-feature/getData';

function MyComponent() {
  const handleClick = async () => {
    const data = await getData({ data: { id: '123' } });
    console.log(data);
  };

  return <button onClick={handleClick}>Fetch Data</button>;
}
```

## GraphQL with SSR

For GraphQL queries, create server function wrappers:

```typescript
// src/server/graphql/collaboration-posts.ts
import { createServerFn } from '@tanstack/react-start';
import { request } from 'graphql-request';
import { CollaborationPosts } from '@/lib/gql/operations';
import { z } from 'zod';

export const getCollaborationPosts = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      filters: z.object({
        typeId: z.string(),
        hiringStatusId: z.string(),
        searchQuery: z.string(),
        sortBy: z.string(),
      }),
    })
  )
  .handler(async ({ data }) => {
    const hasuraUrl = process.env.VITE_HASURA_GRAPHQL_URL;
    const variables = {
      where: {
        statusId: { _eq: 2 },
        ...(data.filters.typeId !== 'all' && {
          collaborationTypeId: { _eq: data.filters.typeId },
        }),
      },
    };

    return await request({
      url: hasuraUrl,
      document: CollaborationPosts,
      variables,
    });
  });
```

Then use in a route:

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { getCollaborationPosts } from '@/server/graphql/collaboration-posts';
import { z } from 'zod';

export const Route = createFileRoute('/collaborations/')({
  component: Collaborations,
  validateSearch: z.object({
    typeId: z.string().optional().default('all'),
    hiringStatusId: z.string().optional().default('all'),
    searchQuery: z.string().optional().default(''),
    sortBy: z.string().optional().default('recent'),
  }),
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps }) => {
    return await getCollaborationPosts({
      data: { filters: deps.search },
    });
  },
});
```

## Authentication with SSR

Use `beforeLoad` to protect routes:

```typescript
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/protected')({
  component: ProtectedPage,
  beforeLoad: async ({ context }) => {
    // Check auth in context (from middleware)
    if (!context.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: async ({ context }) => {
    // Fetch user-specific data server-side
    return await getUserData(context.user.id);
  },
});
```

## Performance Considerations

### Full SSR
- **Pros**: Best SEO, fastest initial render, works without JavaScript
- **Cons**: Larger HTML payload, slower time-to-interactive
- **Best for**: Marketing pages, blog posts, documentation

### Data-Only SSR
- **Pros**: Good SEO, smaller HTML, faster time-to-interactive
- **Cons**: Requires JavaScript for rendering
- **Best for**: Dashboards, admin panels, user pages

### SPA Mode
- **Pros**: Fastest interactivity, simplest implementation
- **Cons**: No SEO, slower initial load, requires JavaScript
- **Best for**: Sandboxes, real-time apps, authenticated areas

## Debugging SSR

### Check what's rendering where:

```typescript
export const Route = createFileRoute('/debug')({
  component: DebugComponent,
  loader: async () => {
    console.log('This runs on the SERVER');
    return { timestamp: new Date().toISOString() };
  },
});

function DebugComponent() {
  console.log('This runs on SERVER (initial) and CLIENT (hydration)');
  
  useEffect(() => {
    console.log('This runs ONLY on the CLIENT');
  }, []);

  return <div>Check your console logs!</div>;
}
```

### View rendered HTML:

```bash
# Build and preview
bun run build
bun run serve

# View page source in browser - you should see rendered content
```

## Migration from Traditional React

If migrating from client-only React:

1. **Start with SPA mode** (`ssr: false`) for all routes
2. **Add loaders gradually** where you need server-side data
3. **Enable data-only SSR** for routes with loaders
4. **Switch to full SSR** for public pages needing SEO

## Learn More

- [TanStack Start Docs](https://tanstack.com/start)
- [TanStack Router SSR Guide](https://tanstack.com/router/latest/docs/framework/react/guide/server-side-rendering)
- [Server Functions](https://tanstack.com/router/latest/docs/framework/react/guide/server-functions)

