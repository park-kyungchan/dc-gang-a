import {fileURLToPath} from 'node:url';

// Test bundles alone replace the empty portable fallback. Production imports never load this file.
const rosterPath=fileURLToPath(new URL('./initial-roster.ts',import.meta.url));
export const syntheticRosterPlugin={name:'synthetic-initial-roster',setup(build){
 build.onResolve({filter:/^\.\/initial-roster$/},args=>
  ['/lib/notebook.ts','/lib/roster-server.ts'].some(path=>args.importer.replaceAll('\\','/').endsWith(path))
   ?{path:rosterPath}:undefined);
}};
