# Tournament Fixture Feed API

A read-only JSON API for displaying tournament fixture data on your brand website.

## Quick Start

1. Open your tournament in the CheersAI dashboard
2. Click the settings icon and scroll to "API Feed"
3. Click "Enable Feed" to generate an API key
4. Use the key to fetch fixtures:

```javascript
const response = await fetch(
  'https://your-cheersai-domain.com/api/feed/YOUR_TOURNAMENT_ID',
  { headers: { 'x-api-key': 'YOUR_API_KEY' } }
);
const data = await response.json();
console.log(data.fixtures);
```

## Authentication

Every request must include an `x-api-key` header with your tournament's API key.

The API key is a public access token — it is safe to use from browser-side JavaScript. It identifies your site and prevents casual scraping, but it does not protect confidential data (the fixture data is inherently public).

## Endpoint

### `GET /api/feed/{tournamentId}`

Returns tournament metadata and fixtures.

### Query Parameters

All parameters are optional.

| Parameter   | Type      | Default | Description                                                        |
| ----------- | --------- | ------- | ------------------------------------------------------------------ |
| `showing`   | boolean   | `true`  | Filter by whether the venue is screening the fixture.              |
| `round`     | string    | —       | Filter by round (see values below)                                 |
| `group`     | string    | —       | Filter by group name, e.g. `Group A`                               |
| `from`      | ISO 8601  | —       | Return fixtures with kick-off at or after this time (UTC)          |
| `to`        | ISO 8601  | —       | Return fixtures with kick-off at or before this time (UTC)         |
| `confirmed` | boolean   | —       | Filter by whether teams are confirmed                              |

**Valid round values:** `group_stage`, `round_of_32`, `round_of_16`, `quarter_final`, `semi_final`, `third_place`, `final`

### Example: Get all group stage fixtures being shown

```
GET /api/feed/{id}?round=group_stage&showing=true
```

### Example: Get fixtures for a specific date range

```
GET /api/feed/{id}?from=2026-06-11T00:00:00Z&to=2026-06-15T23:59:59Z
```

### Example: Get all fixtures regardless of showing status

```
GET /api/feed/{id}?showing=false
```

## Response Format

### Success (200)

```json
{
  "tournament": {
    "id": "f40ef35f-...",
    "name": "FIFA World Cup 2026",
    "slug": "fifa-world-cup-2026",
    "status": "active"
  },
  "fixtures": [
    {
      "id": "abc123...",
      "matchNumber": 1,
      "round": "group_stage",
      "groupName": "Group A",
      "teamA": "Mexico",
      "teamB": "South Africa",
      "teamsConfirmed": true,
      "kickOffAt": "2026-06-11T19:00:00Z",
      "venueCity": "Mexico City",
      "showing": true,
      "showingNote": "Big screen in the beer garden",
      "bookingUrl": "https://example.com/book"
    }
  ],
  "meta": {
    "total": 48,
    "generatedAt": "2026-05-10T14:30:00Z"
  }
}
```

### Fixture Fields

| Field           | Type             | Description                                        |
| --------------- | ---------------- | -------------------------------------------------- |
| `id`            | string           | Unique fixture identifier                          |
| `matchNumber`   | number           | Match number within the tournament                 |
| `round`         | string           | Tournament round                                   |
| `groupName`     | string or null   | Group name (null for knockout rounds)              |
| `teamA`         | string           | Home team name                                     |
| `teamB`         | string           | Away team name                                     |
| `teamsConfirmed`| boolean          | Whether final team names are confirmed             |
| `kickOffAt`     | string           | Kick-off time in ISO 8601 UTC                      |
| `venueCity`     | string or null   | City where the match is played                     |
| `showing`       | boolean          | Whether the venue is screening this fixture        |
| `showingNote`   | string or null   | Optional note about the screening                  |
| `bookingUrl`    | string or null   | Link to book a table/spot for this fixture         |

## Errors

| Status | Meaning                                            |
| ------ | -------------------------------------------------- |
| 400    | Invalid tournament ID format or invalid query parameters |
| 401    | Missing or invalid API key                         |
| 404    | Tournament not found or feed not enabled           |
| 429    | Rate limit exceeded (60 requests per minute per IP)|
| 500    | Internal server error                              |

Error responses include an `error` field:

```json
{ "error": "Missing or invalid API key" }
```

For query parameter errors, a `details` array lists each issue:

```json
{
  "error": "Invalid query parameters",
  "details": ["showing must be \"true\" or \"false\""]
}
```

## Rate Limiting

The feed allows **60 requests per minute** per IP address per tournament. If you exceed this, you will receive a 429 response. Poll no more frequently than once per minute.

## Caching

Successful responses are cached for up to 5 minutes at the CDN level (`s-maxage=300`). Changes to fixtures (team names, kick-off times, showing status) will be reflected within 5 minutes.

Error responses are never cached.

## Managing Your API Key

- **Enable**: Click "Enable Feed" in tournament settings to generate a key
- **Regenerate**: Click "Regenerate Key" to create a new key. The old key stops working immediately.
- **Disable**: Click "Disable Feed" to turn off the API. All requests will return 404.

## CORS

The API supports cross-origin requests from any domain. You can call it directly from browser JavaScript on your website. The `x-api-key` header is allowed via CORS preflight.
