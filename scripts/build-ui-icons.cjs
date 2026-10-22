const fs = require('fs');
const path = require('path');

const packageDir = path.dirname(require.resolve('lucide-static/package.json'));
const targetDir = path.join(__dirname, '../public/assets/icons');
const names = ['trophy', 'gamepad-2', 'flame', 'utensils', 'ticket', 'user-round',
  'log-in', 'log-out', 'pencil', 'clipboard-list', 'credit-card', 'message-square',
  'settings', 'users', 'chef-hat', 'gift', 'house', 'circle-help', 'calendar-days',
  'history', 'circle-pause', 'leaf', 'soup', 'beef', 'chevron-down', 'plus'];
fs.mkdirSync(targetDir, { recursive: true });
const symbols = names.map((name) => {
  const source = fs.readFileSync(path.join(packageDir, 'icons', `${name}.svg`), 'utf8');
  const body = source.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
  return `<symbol id="${name}" viewBox="0 0 24 24">${body}</symbol>`;
});
fs.writeFileSync(path.join(targetDir, 'lucide.svg'), `<svg xmlns="http://www.w3.org/2000/svg">\n${symbols.join('\n')}\n</svg>\n`);
fs.copyFileSync(path.join(packageDir, 'LICENSE'), path.join(targetDir, 'lucide-LICENSE'));
console.log(`Generated ${names.length} local Lucide icons.`);
