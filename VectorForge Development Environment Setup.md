# VectorForge Development Environment Setup

Last Updated: June 2026

## Purpose

This document lists all software, services, accounts, environment variables, folders, and startup procedures required to run and develop the VectorForge application.

---

# Current Architecture

VectorForge currently uses:

* Next.js 15
* React 18
* TypeScript
* Prisma ORM
* Neon PostgreSQL
* Clerk Authentication
* BullMQ
* Redis (Memurai on Windows)
* Sharp
* VTracer (wasm_vtracer)
* SVGO
* JSZip

---

# Required Software

## Node.js

Purpose:

* Runs Next.js
* Runs npm packages
* Runs worker processes

Download:
https://nodejs.org

Recommended:

* Current LTS version

Verify:

```powershell
node -v
npm -v
```

---

## Visual Studio Code

Purpose:

* Development environment
* Integrated terminal
* Extensions

Download:
https://code.visualstudio.com

Recommended Extensions:

* ESLint
* Prisma
* Tailwind CSS IntelliSense
* GitLens
* Prettier

---

## Git for Windows

Purpose:

* Source control
* Rollback capability
* Backup changes

Download:
https://git-scm.com/download/win

Verify:

```powershell
git --version
```

Recommended:

```powershell
git init
git add .
git commit -m "Initial working version"
```

---

## Memurai (Redis for Windows)

Purpose:

* BullMQ job queue
* Background processing

Download:
https://www.memurai.com/get-memurai

Verify Service:

```powershell
Get-Service *memurai*
```

Expected:

```text
Status: Running
```

Default Redis URL:

```env
REDIS_URL="redis://localhost:6379"
```

---

## DBeaver (Optional)

Purpose:

* Database management
* View tables
* Run SQL queries

Download:
https://dbeaver.io

Useful for:

* Viewing Neon data
* Debugging Prisma tables

---

## 7-Zip (Optional)

Purpose:

* Inspect ZIP outputs

Download:
https://www.7-zip.org

---

# Online Accounts Required

## Neon PostgreSQL

Purpose:

* Application database

Website:
https://neon.com

Current Usage:

* Cloud-hosted development database

Future:

* Can be replaced with local PostgreSQL

Environment Variable:

```env
DATABASE_URL="postgresql://..."
```

Important:

* Include DATABASE_URL=
* Use sslmode=require

---

## Clerk Authentication

Purpose:

* User login
* User registration
* Session management

Website:
https://clerk.com

Required Variables:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
```

---

# Environment Files

## .env

Required for Prisma

Example:

```env
DATABASE_URL="postgresql://..."
```

Prisma reads this file by default.

---

## .env.local

Application settings

Example:

```env
DATABASE_URL="postgresql://..."
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
REDIS_URL="redis://localhost:6379"

UPLOAD_DIR="./uploads"
OUTPUT_DIR="./output"
BASE_ASSETS_DIR="./base-assets"
LOGS_DIR="./logs"
```

---

# Folder Structure

Current Default:

```text
vectorforge/
├── uploads/
├── output/
├── base-assets/
├── logs/
```

Future Enhancement:

Allow configurable storage locations:

```text
D:\VectorForge\uploads
D:\VectorForge\output
D:\VectorForge\base-assets
D:\VectorForge\logs
```

Eventually make configurable from the application UI.

---

# Daily Startup Procedure

## Terminal 1 – Web Application

```powershell
npm.cmd run dev
```

Expected:

```text
Ready
Local: http://localhost:3000
```

or

```text
Local: http://localhost:3001
```

---

## Terminal 2 – Processing Worker

```powershell
npm.cmd run worker:dev
```

Expected:

```text
Worker: Processing worker started, waiting for jobs...
Redis connected successfully
```

---

# Database Commands

Push Schema:

```powershell
npx prisma db push
```

Generate Prisma Client:

```powershell
npx prisma generate
```

Open Prisma Studio:

```powershell
npm run db:studio
```

---

# Common Troubleshooting

## Redis Connection Error

Error:

```text
ECONNREFUSED 127.0.0.1:6379
```

Fix:

* Ensure Memurai service is running

```powershell
Get-Service *memurai*
```

---

## Prisma EPERM Error

Error:

```text
EPERM rename query_engine-windows.dll.node
```

Fix:

```powershell
taskkill /IM node.exe /F
```

Then:

```powershell
Remove-Item -Recurse -Force node_modules\.prisma
npx prisma generate
```

---

## Port Already In Use

Find:

```powershell
netstat -ano | findstr :3000
```

Kill:

```powershell
taskkill /PID #### /F
```

Or:

```powershell
taskkill /IM node.exe /F
```

---

## PowerShell npm Execution Policy Issue

Use:

```powershell
npm.cmd run dev
```

Instead of:

```powershell
npm run dev
```

if PowerShell blocks npm.ps1.

---

# Current Known Project Fixes Applied

Completed:

* Fixed Redis build-time initialization
* Fixed review → processing routing
* Fixed Next.js 15 Clerk headers() issue
* Fixed mojibake/encoding issues
* Fixed Prisma configuration
* Fixed worker metadata substitution bug
* Connected Redis successfully
* Connected Neon successfully

---

# Future Improvements

## Local PostgreSQL

Replace Neon with:

https://www.postgresql.org/download/windows/

Benefits:

* Fully offline development
* No cloud dependency
* Faster local testing

---

## Configurable Storage Paths

Move from .env configuration to:

Settings Page

Allow:

* Upload Path
* Output Path
* Base Assets Path
* Logs Path

with validation and folder creation.

---

# Recommended Backup Strategy

Before major changes:

```powershell
git add .
git commit -m "Checkpoint before feature changes"
```

Or make a complete copy of the project folder.

Never make multiple major changes without a checkpoint.
