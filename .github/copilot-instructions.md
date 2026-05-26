# Copilot Instructions - Visita Fácil

## Project Overview
**Visita Fácil** is a Vue 3 application built with Vite, designed for managing and organizing visits efficiently and intuitively.

## Technology Stack
- Vue 3 with Composition API
- Vite (modern build tool)
- TypeScript for type safety
- CSS Modules support

## Project Structure
```
src/
├── components/     # Reusable Vue components
├── App.vue        # Root component
├── main.ts        # Application entry point
├── style.css      # Global styles
public/           # Static assets
vite.config.ts    # Vite configuration
tsconfig.json     # TypeScript configuration
```

## Getting Started

1. **Development Server**
   ```bash
   npm run dev
   ```
   Runs the app in development mode at `http://localhost:5173/`

2. **Build for Production**
   ```bash
   npm run build
   ```

3. **Preview Production Build**
   ```bash
   npm run preview
   ```

## Development Guidelines
- Use Composition API and `<script setup>` for new components
- Keep components focused, reusable, and well-documented
- Use TypeScript for type safety throughout the codebase
- Follow existing code patterns and conventions
- Keep the component hierarchy clean and organized

## Code Style
- Use camelCase for variables and functions
- Use PascalCase for component names
- Place styles in `<style scoped>` within components or use CSS Modules
- Document complex logic with comments

## Key Features to Implement
- Visit tracking and management
- User-friendly interface
- Responsive design
- Data persistence

## Dependencies
- Vue 3: UI framework
- Vite: Build tool and dev server
- TypeScript: Type safety
