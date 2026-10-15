# CryptoScope

A mini **cryptographic inventory and risk assessment** platform. It scans TLS endpoints, records which
algorithms, key sizes and protocol versions are in use, scores the risk (including exposure to future
quantum attacks), and shows it all on a dashboard.

> Work in progress — built step by step. See [Roadmap](#roadmap).

## Tech stack

| Layer          | Technology                                 |
| -------------- | ------------------------------------------ |
| Backend API    | NestJS 11 (TypeScript), TypeORM            |
| Frontend       | Next.js 16 (React 19), Tailwind CSS 4      |
| Database       | PostgreSQL 17                              |
| Search / logs  | Elasticsearch 8.19 + Kibana                |
| Queue          | Redis 7 (BullMQ in Step 6)                 |
| Tests          | Jest                                       |

## Repository layout

```
CryptoScope/
├── backend/            NestJS API (port 3001, prefix /api)
├── frontend/           Next.js dashboard (port 3000)
├── scripts/            helper scripts (smoke tests, seeders, log generators)
├── docker-compose.yml  the whole stack
└── .env.example        configuration template
```

## Quick start (everything in Docker)

Requirements: Docker Desktop or Rancher Desktop with **at least 4 GB of memory** for the VM
(Elasticsearch + Kibana are the heavy ones).

```bash
cp .env.example .env
docker compose up --build
```

First start takes a few minutes (image downloads, Elasticsearch boot). Then:

| Service          | URL                                    |
| ---------------- | -------------------------------------- |
| Dashboard        | http://localhost:3000                  |
| API liveness     | http://localhost:3001/api/health       |
| API readiness    | http://localhost:3001/api/health/ready |
| Elasticsearch    | http://localhost:9200                  |
| Kibana           | http://localhost:5601                  |
| PostgreSQL       | `localhost:5433` (user/db from `.env`) |
| Redis            | `localhost:6379`                       |

Check everything at once:

```bash
./scripts/check-health.sh
```

Stop with `docker compose down` (add `-v` to also delete the data volumes).

## Local development (hot reload)

Run only the infrastructure in Docker, and the apps on your machine:

```bash
docker compose up -d postgres redis elasticsearch kibana

cd backend && npm install && npm run start:dev     # http://localhost:3001/api
cd frontend && npm install && npm run dev          # http://localhost:3000
```

The backend reads the root `.env`, where hosts are `localhost`. Inside Docker, `docker-compose.yml`
overrides them with service names (`postgres`, `redis`, `elasticsearch`).

## Tests

```bash
cd backend && npm test
```

## API

| Method | Path                | Description                                                      |
| ------ | ------------------- | ---------------------------------------------------------------- |
| GET    | `/api/health`       | Liveness: the process is up. Used by Docker's healthcheck.       |
| GET    | `/api/health/ready` | Readiness: Postgres, Redis and Elasticsearch reachable (or 503). |

## Roadmap

- [x] Step 1 – Project setup, docker-compose, health checks
- [ ] Step 2 – TLS scanner service
- [ ] Step 3 – Risk scoring engine
- [ ] Step 4 – PostgreSQL data model + query optimization
- [ ] Step 5 – Elasticsearch log analytics
- [ ] Step 6 – Async pipeline (BullMQ) + real-time (Socket.IO)
- [ ] Step 7 – Security (JWT, roles, validation, rate limiting)
- [ ] Step 8 – Dashboard
- [ ] Step 9 – Crypto-agility module
- [ ] Step 10 – Final polish
# CryptoScope
