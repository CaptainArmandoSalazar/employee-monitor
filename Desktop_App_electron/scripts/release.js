const { execSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });
const out = (cmd) => execSync(cmd, { cwd: root }).toString().trim();

// 1. Sync package.json + login.html from changelog.json
require('./sync-release.js');
const version = require('../package.json').version;
const tag = `v${version}`;

// 2. Refuse to reuse a tag that exists locally or on GitHub
if (out(`git tag -l ${tag}`) || out(`git ls-remote --tags source ${tag}`)) {
  console.error(`\n❌ Tag ${tag} already exists. Add a NEW entry at the top of changelog.json first.`);
  process.exit(1);
}

// 3. Commit, tag, push
run('git add .');
run(`git commit -m "Release ${tag}"`);
run(`git tag ${tag}`);
run('git push source HEAD');
run(`git push source ${tag}`);
console.log(`\n✅ Released ${tag}`);