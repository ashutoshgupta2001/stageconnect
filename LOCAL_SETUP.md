# StageConnect on this computer

The working project is `/Users/ashutoshgupta/local-development/Stageconnect`, the folder open in VS Code. Source files are inside its `app` directory. Its Express API uses Sequelize and the local PostgreSQL server.

- API base URL: http://localhost:3001/api/v1
- Health check: http://localhost:3001/health
- Development database: `stageconnect_local_01a14e75`
- Test database: `stageconnect_local_01a14e75_test`
- Configuration: `.env` in this folder, excluded from version control. It contains the generated JWT secret and demo password.

## Demo accounts

| Role | Email |
| --- | --- |
| Artist | `artist@stageconnect.test` |
| Client | `client@stageconnect.test` |

Both accounts use the value of `SEED_PASSWORD` in the local `.env` file. No password or signing secret is included in this guide or the downloadable source archive.

Log in through `POST /api/v1/auth/login` with the selected email and password. Send the returned access token as `Authorization: Bearer <token>` to protected endpoints. The artist's ID is included in the artist login response.

## Run and verify

Run these commands from this folder:

```sh
npm run dev
```

If the app is already running on port 3001, restart that instance to load code changes instead of starting a second one. For the compiled server, run `npm run build` before restarting `npm start`. Business requests use `/api/v1`; the old unversioned business URLs are no longer registered. The app provides a JSON API; there is no frontend screen at `/`.

```sh
npm run check
```

This checks TypeScript, runs the middleware, integration, and input-validation tests (using the separate test database for integration tests), and builds the production application. The full API contract is in `docs/openapi.json`; setup and architecture details are in `README.md`.

The existing database named `stageconnect` was not modified. These two dedicated databases and the demo accounts are retained so this local app can be used and tested again.

The local configuration uses port 3001 because the earlier output-folder instance still occupies port 3000. Requests to port 3001 use this VS Code project.
