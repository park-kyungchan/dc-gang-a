// Compiled CSS regression for layout-wide touch policy overriding gesture controls.
// This checks policy ownership; real browser/device gesture evidence is separate.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import postcss from 'postcss';

const directory='dist/client/assets';
const files=readdirSync(directory).filter(name=>name.endsWith('.css'));
assert.ok(files.length,'build the actual client before checking gesture CSS');
const roots=files.map(name=>postcss.parse(readFileSync(`${directory}/${name}`,'utf8')));
function values(selector,property){
 const found=[];
 for(const root of roots)root.walkRules(rule=>{if(rule.selectors.includes(selector))rule.walkDecls(property,decl=>found.push(decl.value));});
 return found;
}

test('compiled layout styling does not replace dock and card touch policies',()=>{
 assert.ok(values('.touch-recorder-edge','touch-action').includes('none'),'collapsed dragging owns both axes');
 assert.ok(values('.touch-recorder','touch-action').includes('none'),'expanded dragging owns both axes');
 assert.ok(values('.swipe-card .swipe-handle','touch-action').some(value=>value.includes('pan-y')),'card controls preserve vertical scroll');
 assert.deepEqual(values('.a-shell button','touch-action'),[],'layout-wide specificity must not replace interaction-specific policies');
 assert.ok(values('button','touch-action').includes('manipulation'),'the existing base policy still covers ordinary buttons');
});
