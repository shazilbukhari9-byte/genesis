# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Deployment

This repository is **two** deployables, and the hosted frontend is useless
without the second one:

| Part | What it is | Where it runs |
| --- | --- | --- |
| `frontend/` | TanStack Start app | static host (Vercel, etc.) |
| `backend/` + PostgreSQL | Flask API and the database it reads | needs its own host |

Deploying only the frontend produces a site that appears to work but cannot
load any data. `VITE_API_BASE` is read at **build** time, and when it is unset
the bundle falls back to `http://127.0.0.1:5000` — so a hosted page ends up
calling whatever is on the *visitor's* own machine. The app detects this and
says so explicitly rather than failing as a confusing network error or 401.

To deploy properly:

1. **Host the backend** (`backend/app.py`, any WSGI host) with a PostgreSQL
   database, and apply `database/schema.sql`. Set at least `OG_DB_HOST`,
   `OG_DB_PORT`, `OG_DB_NAME`, `OG_DB_USER`, `OG_DB_PASSWORD` and
   `OG_SECRET_KEY` — see `backend/.env.example`.
2. **Set `OG_CORS_ORIGINS`** on the backend to the frontend's real origin
   (comma-separated). It is not a wildcard; an origin that is not listed is
   refused.
3. **Set `VITE_API_BASE`** in the frontend host's environment variables to the
   deployed backend URL, then **rebuild** — changing it without a rebuild has
   no effect, because the value is baked into the bundle.

### Sessions

Bearer tokens are opaque random strings stored in the `sessions` table with an
`expires_at` (`OG_TOKEN_TTL_HOURS`, 12 hours by default). A token is therefore
only valid against the exact database that issued it — pointing the frontend at
a different backend, or letting a token age out, invalidates it. The app
validates a restored session on boot and signs the user out on any `401`, so an
expired session asks for a fresh sign-in instead of failing every request.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
- Flask + PostgreSQL (`backend/`)
