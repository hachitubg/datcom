const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content
    .replace(/\r/g, '')
    .split(/\n|\\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  lines.forEach((line) => {
    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) {
      return;
    }

    const key = line.slice(0, equalIndex).trim();
    const value = line.slice(equalIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

loadEnvFile();
