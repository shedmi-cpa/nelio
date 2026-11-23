// Evaluates the Apps Script defaults (Setup.gs, Messages.gs) and prints them as JSON.
import fs from 'node:fs';
import path from 'node:path';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const src = ['Setup.gs','Messages.gs'].map(f=>fs.readFileSync(path.join(REPO, 'apps-script', f),'utf8')).join('\n');
const CONFIG = {officeEmail:'shedmi.cpa@gmail.com', clientPageUrl:'https://shedmi-cpa.github.io/nelio/', defaultMaxFileMb:10};
const plusAddress_ = t => 'shedmi.cpa+'+t+'@gmail.com';
const fn = new Function('CONFIG','plusAddress_', src.replace(/^const CONFIG[^;]*;/m,'') + '\nreturn {settings:defaultSettings_(),docTypes:defaultDocTypes_(),profiles:defaultProfiles_(),templates:defaultTemplates_()};');
console.log(JSON.stringify(fn(CONFIG, plusAddress_)));
