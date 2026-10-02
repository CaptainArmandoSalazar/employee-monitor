const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const changelogPath = path.join(rootDir, 'changelog.json');
const packageJsonPath = path.join(rootDir, 'package.json');
const loginHtmlPath = path.join(rootDir, 'src', 'renderer', 'login.html');
const releaseConfigPath = path.join(rootDir, 'release.config.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeVersion(rawVersion) {
  if (!rawVersion) return '0.0.0';
  return rawVersion.replace(/^v/i, '').trim();
}

const changelog = readJson(changelogPath);
const releaseConfig = readJson(releaseConfigPath);
const latestEntry = Array.isArray(changelog.history) && changelog.history.length > 0 ? changelog.history[0] : null;
const version = normalizeVersion(latestEntry ? latestEntry.version : '0.0.0');

const pkg = readJson(packageJsonPath);
pkg.version = version;

if (pkg.build && pkg.build.publish && Array.isArray(pkg.build.publish)) {
  pkg.build.publish[0] = {
    ...pkg.build.publish[0],
    provider: 'github',
    owner: releaseConfig.github.owner,
    repo: releaseConfig.github.repo,
    releaseType: releaseConfig.github.releaseType || 'release',
  };
}

if (pkg.build && pkg.build.appId) {
  pkg.build.productName = releaseConfig.app.displayName || releaseConfig.app.name;
}

fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

const loginHtml = fs.readFileSync(loginHtmlPath, 'utf8');
const updatedLoginHtml = loginHtml
  .replace(/__APP_VERSION__/g, version)
  .replace(/(AV DEVS Collab System v)[^<\s]+/g, `$1${version}`);
fs.writeFileSync(loginHtmlPath, updatedLoginHtml);

console.log(`[release-sync] synced version ${version} from changelog and release config`);
