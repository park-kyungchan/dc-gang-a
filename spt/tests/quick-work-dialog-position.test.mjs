// Regression for the shipped CSS transform/translate collision in QuickWork.
// Runs actual component/class merging and inspects compiled CSS; this is not
// browser rendering, Safari emulation, or a real iPhone touch/keyboard test.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync, readdirSync} from 'node:fs';
import {build} from 'esbuild';
import postcss from 'postcss';

const bundle = await build({
  stdin: {
    contents: "export {QuickWork} from './app/quick-work'; export {DialogContent} from './components/ui/dialog';",
    resolveDir: process.cwd(),
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{name: 'dialog-component-isolation', setup(b) {
    const modules = {
      react: 'export const useState = value => [value, () => {}]; export const useRef = value => ({current:value}); export function useEffect() {} export function useLayoutEffect() {}',
      'react/jsx-runtime': 'export const jsx = (type, props) => ({type, props}); export const jsxs = jsx; export const Fragment = "Fragment";',
      'radix-ui': 'export const Dialog = Object.fromEntries(["Root","Trigger","Portal","Close","Overlay","Content","Title","Description"].map(name => [name, "Radix" + name])); export const Slot = {Root:"Slot"};',
      'lucide-react': 'export const ArrowLeft="ArrowLeft", UsersRound="UsersRound", XIcon="XIcon";',
    };
    b.onResolve({filter: /^(react(?:\/jsx-runtime)?|radix-ui|lucide-react)$/}, a => ({path:a.path, namespace:'isolated'}));
    b.onLoad({filter: /.*/, namespace:'isolated'}, a => ({contents:modules[a.path]}));
    b.onResolve({filter: /^\.\/(classroom-panels|student-roster)$/}, a => a.importer.replaceAll('\\','/').endsWith('/app/quick-work.tsx') ? {path:a.path, namespace:'child'} : undefined);
    b.onLoad({filter: /.*/, namespace:'child'}, () => ({contents:'export const Activities="Activities", StudentRoster="StudentRoster";'}));
  }}],
});
const ui = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
};
const contentClasses = props => find(ui.DialogContent(props), n => n.props?.['data-slot'] === 'dialog-content').props.className.split(/\s+/);

test('actual QuickWork callsite removes default centering translations through production cn', () => {
  const tree = ui.QuickWork({current:{id:'fixture-a',name:'합성 학생'},date:'2026-09-10',students:[],ledger:[],save:async()=>{},ready:true});
  const content = find(tree, n => n.type === ui.DialogContent);
  assert.ok(content, 'actual QuickWork renders the shared DialogContent');
  const classes = contentClasses(content.props);
  for (const axis of ['x', 'y']) {
    assert.ok(classes.includes(`translate-${axis}-0`), `${axis} position is neutral before custom CSS`);
    assert.ok(!classes.includes(`translate-${axis}-[-50%]`), `${axis} default centering must be removed by actual tailwind-merge`);
  }
  assert.ok(classes.includes('top-0') && classes.includes('left-0'));
  const regular = contentClasses({children:null});
  assert.ok(regular.includes('translate-x-[-50%]') && regular.includes('translate-y-[-50%]'), 'other dialogs retain their normal centering');
});

const assets = 'dist/client/assets';
const cssFiles = readdirSync(assets).filter(name => name.endsWith('.css'));
assert.ok(cssFiles.length, 'run the production build before CSS regression tests');
const roots = cssFiles.map(name => postcss.parse(readFileSync(`${assets}/${name}`, 'utf8'), {from:`${assets}/${name}`}));
const matchingRules = selector => {
  const rules = [];
  for (const root of roots) root.walkRules(rule => {if (rule.selectors.includes(selector)) rules.push(rule);});
  return rules;
};
const quickRules = matchingRules('.quick-work-dialog');
const declarations = (rules, property) => rules.flatMap(rule => rule.nodes.filter(node => node.type === 'decl' && node.prop === property));

test('compiled QuickWork CSS never adds a second transform or translate at any breakpoint', () => {
  assert.ok(quickRules.length, 'compiled CSS contains the QuickWork surface');
  for (const property of ['transform', 'translate']) {
    const collisions = declarations(quickRules, property);
    assert.deepEqual(collisions.map(decl => decl.toString()), [], `${property} must not reintroduce the production double-shift regression`);
  }
});

test('compiled QuickWork positioning retains safe side insets and zero translation utilities', () => {
  for (const side of ['left', 'right']) {
    assert.ok(declarations(quickRules, side).some(decl => decl.value.includes(`env(safe-area-inset-${side}`)), `${side} inset must include the device safe area`);
  }
  assert.ok(declarations(quickRules, 'margin').some(decl => decl.value === 'auto'), 'inset positioning uses automatic margins');
  assert.ok(declarations(quickRules, 'height').some(decl => decl.value === 'fit-content'), 'dialog retains its content height');
  for (const axis of ['x', 'y']) {
    const neutral = declarations(matchingRules(`.translate-${axis}-0`), `--tw-translate-${axis}`);
    assert.ok(neutral.some(decl => /^(?:0(?:px)?|calc\(\s*var\(--spacing\)\s*\*\s*0\s*\))$/.test(decl.value)), `compiled ${axis} utility must set a zero translation`);
  }
});
