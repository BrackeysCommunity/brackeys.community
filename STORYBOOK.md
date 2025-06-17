# Brackeys UI Components - Storybook

This project uses Storybook to document and showcase our React UI components. Storybook provides an isolated environment for developing components and a comprehensive documentation site.

## 🚀 Quick Start

### Development
```bash
# Install dependencies
bun install

# Start Storybook development server
bun run storybook
```

Visit [http://localhost:6006](http://localhost:6006) to view Storybook locally.

### Building
```bash
# Build static Storybook for production
bun run build-storybook
```

## 📚 What's Included

Our Storybook includes comprehensive documentation and examples for:

- **Button Component** - All variants, sizes, states, and layouts
- **Input Component** - Interactive inputs with icons, validation, and states  
- **Loading Component** - Loading indicators in different sizes
- **Modal Component** - Dialog modals with various configurations
- **Toast Component** - Notification toasts using our custom API
- **Overview** - Complete design system showcase

## 🎨 Features

- **Dark Theme** - Matches our app's design system
- **Interactive Examples** - All components are fully interactive
- **Accessibility Testing** - Built-in a11y addon for testing
- **Responsive Design** - Components work across all screen sizes
- **TypeScript** - Full type safety and IntelliSense

## 🚀 GitHub Pages Deployment

### Automatic Deployment

Storybook is automatically deployed to GitHub Pages when code is pushed to the `main` branch via GitHub Actions.

**Live Storybook:** [https://yourusername.github.io/BrackeysCommunity/brackeys.community/](https://yourusername.github.io/BrackeysCommunity/brackeys.community/)

### Manual Deployment

You can also trigger deployment manually:

1. Go to **Actions** tab in your GitHub repository
2. Select **"Deploy Storybook to GitHub Pages"** workflow
3. Click **"Run workflow"** button
4. Select `main` branch and click **"Run workflow"**

### Setup Requirements

#### 1. GitHub Repository Settings

Navigate to your repository settings:

1. Go to **Settings** → **Pages**
2. Under **Source**, select **"GitHub Actions"**
3. Save the settings

#### 2. Repository Permissions

The workflow requires these permissions (already configured):
- `contents: read` - To checkout the code
- `pages: write` - To deploy to GitHub Pages  
- `id-token: write` - For secure deployment

#### 3. Branch Protection (Optional but Recommended)

To ensure only tested code gets deployed:

1. Go to **Settings** → **Branches**
2. Add rule for `main` branch
3. Enable **"Require status checks to pass before merging"**
4. Select the Storybook build check

## 🛠️ Development Workflow

### Adding New Components

1. Create your component in `src/components/ui/`
2. Create a corresponding story file in `src/stories/`
3. Follow our story patterns:
   ```typescript
   // Basic story structure
   export const Basic: Story = {
     render: () => {
       const [value, setValue] = useState('');
       return <YourComponent value={value} onChange={setValue} />;
     },
   };
   ```

### Story Best Practices

- **Make stories interactive** - Use React state for user input
- **Show all variants** - Document different props and states
- **Add descriptions** - Use `parameters.docs.description` for context
- **Group logically** - Organize stories by functionality
- **Test accessibility** - Use the a11y addon to check compliance

### Updating Themes

The Storybook theme is configured in:
- `.storybook/preview.ts` - Story canvas and docs theme
- `.storybook/manager.ts` - Navigation and UI theme (if needed)

## 📁 File Structure

```
.storybook/
├── main.ts          # Storybook configuration
├── preview.ts       # Global decorators and parameters
└── manager.ts       # Manager UI theme (if exists)

src/stories/
├── Overview.stories.tsx    # Design system overview
├── Button.stories.tsx      # Button component examples
├── Input.stories.tsx       # Input component examples
├── Loading.stories.tsx     # Loading component examples
├── Modal.stories.tsx       # Modal component examples
└── Toast.stories.tsx       # Toast component examples

.github/workflows/
└── deploy-storybook.yml    # GitHub Actions deployment
```

## 🔧 Configuration

### Base URL Configuration

The base URL is automatically configured for GitHub Pages deployment:
- **Local development:** `/` 
- **GitHub Pages:** `/brackeys-web/`

### Build Configuration

Storybook builds to `storybook-static/` directory, which is deployed to GitHub Pages.

## 📝 Troubleshooting

### Common Issues

**Build Fails:**
- Check that all dependencies are installed: `bun install`
- Verify TypeScript types are correct
- Check for linting errors: `bun run lint`

**Deployment Fails:**
- Ensure GitHub Pages is enabled in repository settings
- Check that the Actions have proper permissions
- Verify the workflow file syntax

**Stories Not Interactive:**
- Make sure you're using `render:` with React state
- Add `args: {}` for stories with custom render functions
- Check that onChange handlers are properly connected

### Getting Help

- Check the [Storybook Documentation](https://storybook.js.org/docs)
- Review our component implementations in `src/components/ui/`
- Look at existing story examples for patterns

## 🎯 Next Steps

After deployment, consider:

1. **Custom Domain** - Add a custom domain in GitHub Pages settings
2. **Performance Monitoring** - Track Storybook load times
3. **Component Testing** - Add interaction tests with Storybook Test addon
4. **Design Tokens** - Document color palette and spacing system
5. **Component Guidelines** - Add usage guidelines for each component

---

**Happy Documenting!** 🎉 