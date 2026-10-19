# Tab Graveyard API

A REST API built with Node.js, Express, and SQLite for tracking buried browser tabs.

## Requirements

- Node.js
- npm

## Setup

```bash
npm install
node server.js
```

The server runs at `http://localhost:3000`.

## Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | Welcome message |
| GET | `/health` | Health check |
| POST | `/bury` | Bury a tab |
| POST | `/graveyard/bulk-bury` | Bury multiple tabs |
| GET | `/graveyard` | List active buried tabs |
| GET | `/graveyard/stats` | Burial statistics |
| GET | `/graveyard/leaderboard` | Rank burial causes |
| GET | `/graveyard/oldest` | Find the oldest active burial |
| GET | `/graveyard/recent` | Get recent active burials |
| GET | `/graveyard/cause/:cause` | Filter by cause |
| GET | `/graveyard/:id` | Get a tab by ID |
| PATCH | `/graveyard/:id` | Update cause or notes |
| POST | `/resurrect/:id` | Resurrect within 24 hours |
| DELETE | `/graveyard/:id` | Delete after the 24-hour grace period |

## Valid Causes

- `DISTRACTION`
- `PRODUCTIVITY`
- `RESEARCH`
- `PROCRASTINATION`
- `OTHER`

## Example Request

Send a `POST` request to `/bury` with a JSON body:

```json
{
  "title": "Learn Express",
  "url": "https://example.com/express",
  "cause": "RESEARCH",
  "notes": "Learning backend development",
  "lifespanMs": 3600000
}
```

The API validates request data and stores records in a local SQLite database.
