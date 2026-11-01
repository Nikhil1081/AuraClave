# AuraClave — Frontend Web Client

The React 19 web application for **AuraClave**, an AI-powered, multilingual video collaboration platform.

For full project documentation, architecture, backend setup, and deployment guides, please see the [Root README](../README.md).

## Quick Start (Frontend)

```bash
npm install
npm run dev
```

### Environment Setup

Create `.env.local`:
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_API_URL=http://localhost:5000
```

### Build & Deploy

```bash
npm run build
firebase deploy --only hosting
```
