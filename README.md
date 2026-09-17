# personal

Next.js app with TypeScript, Tailwind CSS v4, and the App Router.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |

## Structure

```
src/app/
  layout.tsx    Root layout: fonts, metadata
  page.tsx      Home screen (/)
  globals.css   Tailwind import and theme tokens
public/         Static assets
```
