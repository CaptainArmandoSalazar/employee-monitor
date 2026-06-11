# AV DEVS Collab — Employee Monitor

A full-stack employee monitoring system consisting of a **FastAPI backend** and an **Electron desktop app**.

---

## 📁 Repository Structure

Pull the latest code from the **`Latest_version`** branch on Bitbucket:

```bash
git clone https://bitbucket.org/avdevs/collabv2.git
cd collabv2
git checkout Latest_version
```

| Folder | Description |
|--------|-------------|
| [`Desktop_App_Tracking`](https://bitbucket.org/avdevs/collabv2/src/Latest_version/Desktop_App_Tracking/) | FastAPI backend (Python) |
| [`Desktop_App_electron`](https://bitbucket.org/avdevs/collabv2/src/Latest_version/Desktop_App_electron/) | Electron desktop app (TypeScript/Node) |

---

## 🗄️ Database Setup

### Step 1 — Install PostgreSQL

Make sure PostgreSQL is installed on your machine. On Ubuntu:

```bash
sudo apt install postgresql postgresql-contrib
```

### Step 2 — Get the Database Dump

The production database is `employee_monitor`. Get a dump file from the repo :


### Step 3 — Restore on Your Machine

```bash
# Create an empty database first
psql -U postgres -c "CREATE DATABASE employee_monitor;"

# Restore from the dump
pg_restore \
  -U postgres \
  -h localhost \
  -d employee_monitor \
  --no-owner \
  --no-privileges \
  -v \
  employee_monitor_backup.dump
```

### Step 4 — Verify the Restore

```bash
psql -U postgres -d employee_monitor -c "SELECT COUNT(*) FROM employees;"
```



## 🐍 Backend Setup (`Desktop_App_Tracking`)

### Prerequisites

- Python 3.10+
- PostgreSQL running locally

### Step 1 — Navigate to the Backend Folder

```bash
cd Desktop_App_Tracking
```

### Step 2 — Create a Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate        # Linux / macOS
# venv\Scripts\activate         # Windows
```

### Step 3 — Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 4 — Configure Environment Variables

Create a `.env` file in the `Desktop_App_Tracking` folder:

```dotenv
DATABASE_URL=postgresql+psycopg2://postgres:YOUR_PASSWORD@localhost:5432/employee_monitor
SECRET_KEY=your-very-secret-key-change-this-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=43200

DEFAULT_ADMIN_EMAIL=admin@avdevs.com
DEFAULT_ADMIN_PASSWORD=1234
DEFAULT_ADMIN_NAME=Super Admin
DEFAULT_ADMIN_DEPARTMENT=IT
```

### Step 5 — Run the Backend

**For development:**

```bash
python run.py
```

**For production (recommended):**

```bash
gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8000
```


The API will be available at `http://localhost:8000`.  
Swagger docs: `http://localhost:8000/docs`

---

## 🖥️ Electron App Setup (`Desktop_App_electron`)

### Prerequisites

- Node.js 18+
- npm

### Step 1 — Navigate to the Electron Folder

```bash
cd Desktop_App_electron
```

### Step 2 — Install Dependencies

```bash
npm install
```

### Step 3 — Point the App to Your Backend

Open `src/main/services/api.service.ts` and update the `BASE_URL`:

```typescript
const BASE_URL = process.env.API_BASE_URL || 'http://YOUR_BACKEND_IP:8000/api/v1';
```

Replace `YOUR_BACKEND_IP` with `localhost` for local development, or your server's IP for a shared backend.

### Step 4 — Run in Development Mode

```bash
npm run dev
```

This starts both the Vite/TypeScript compiler and the Electron process with hot-reload.

---

## 📦 GitHub Releases & Auto-Update Setup

The app uses `electron-updater` to deliver automatic updates via **GitHub Releases**. You must set this up for your own repo before distributing the app.

### Step 1 — Create a Public GitHub Repository

Go to [github.com/new](https://github.com/new) and create a **public** repository (e.g., `my-org/employee-monitor-releases`).

> It **must be public** so that users can download update files without authentication.

### Step 2 — Replace the Repo Reference in Code

Open `src/main/main.ts` and find this block:

```typescript
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'CaptainArmandoSalazar',
  repo: 'employee-monitor-releases',
});
```

Replace it with your own GitHub username and repo name:

```typescript
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'YOUR_GITHUB_USERNAME',
  repo: 'YOUR_REPO_NAME',
});
```

### Step 3 — Generate a GitHub Personal Access Token

1. Go to **GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)**
2. Click **Generate new token**
3. Give it a name (e.g., `electron-releases`)
4. Select scopes: `repo` (full control of private repositories) — even for a public repo this is needed to **publish** releases
5. Copy the token

### Step 4 — Set the `GH_TOKEN` Environment Variable

The token is used only when **building and publishing** releases — never shipped inside the app.

**On Linux/macOS (for the current terminal session):**

```bash
export GH_TOKEN=ghp_your_token_here
```

**To make it permanent, add it to your shell profile (`~/.bashrc` or `~/.zshrc`):**

```bash
echo 'export GH_TOKEN=ghp_your_token_here' >> ~/.bashrc
source ~/.bashrc
```

**On Windows (PowerShell):**

```powershell
$env:GH_TOKEN = "ghp_your_token_here"
```

### Step 5 — Configure `package.json` for Publishing

Make sure your `package.json` has the correct publish config:

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "YOUR_GITHUB_USERNAME",
      "repo": "YOUR_REPO_NAME"
    }
  }
}
```

### Step 6 — Build and Publish a Release

```bash
# Build and publish to GitHub Releases
npm run publish
# or depending on your package.json scripts:
npm run build -- --publish always
```

This will:
1. Build the Electron app into an installable package (`.deb`, `.exe`, `.dmg`)
2. Create a new GitHub Release tagged with the version from `package.json`
3. Upload the installer files as release assets

### Step 7 — Update the App Version

To release a new version, bump the version in `package.json`:

```json
{
  "version": "1.0.42"
}
```

Then update `changelog.json` (in the project root) with the new version's release notes, and run the publish command again.

---

## 🔐 Default Login Credentials

After restoring the database and running the backend, the default super admin account is:

| Field | Value |
|-------|-------|
| Email | `admin@avdevs.com` |
| Password | `1234` |


---

## 🔑 Reset `admin@avdevs.com` Password

If you need to reset the default admin account password back to `1234`, run the following directly against the database. This bypasses the API's strong-password validator so a short password like `1234` is allowed.

### Step 1 — Connect to the database

```bash
psql "postgresql://postgres:sohamsoni22@localhost:5432/employee_monitor"
```

### Step 2 — Apply the password reset

```sql
UPDATE employees
SET password_hash = '$2b$12$Ny/lJkRx4EljBkXKfc00ZeGc3rPABa94CLg55aBsvqWDQxRE.yDAq'
WHERE email = 'admin@avdevs.com';
```

> This hash is a bcrypt (cost=12) hash of the string `1234`.

### Step 3 — Verify

```sql
SELECT email, password_hash FROM employees WHERE email = 'admin@avdevs.com';
```

### Step 4 — Exit psql

```sql
\q
```

You can now log in to the Electron app with `admin@avdevs.com` / `1234`.


