import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MetadataHead,ViewportHead,mergeMetadata,mergeViewport} from '../node_modules/vinext/dist/shims/metadata.js';

test('installed app metadata survives the current Vinext head renderer',async()=>{
  const source=(await readFile(new URL('../app/layout.tsx',import.meta.url),'utf8')).replace('import "./globals.css";','');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const layout={};
  new Function('require','exports',compiled)(createRequire(import.meta.url),layout);
  const html=renderToStaticMarkup(React.createElement(layout.default,null,React.createElement(React.Fragment,null,
    React.createElement(MetadataHead,{metadata:mergeMetadata([layout.metadata])}),
    React.createElement(ViewportHead,{viewport:mergeViewport([layout.viewport])}),
  )));
  const viewports=html.match(/<meta\b[^>]*name="viewport"[^>]*>/g)||[];
  assert.equal(viewports.length,1,'Safari must receive one authoritative viewport');
  assert.match(viewports[0],/width=device-width, initial-scale=1, viewport-fit=cover/);
  assert.doesNotMatch(viewports[0],/maximum-scale|user-scalable=no/);
  assert.match(html,/<meta name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html,/<meta name="apple-mobile-web-app-status-bar-style" content="default"/);
  assert.match(html,/<link rel="apple-touch-icon" href="\/apple-touch-icon.png"/);
  assert.match(html,/<link rel="manifest" href="\/manifest.webmanifest" crossorigin="use-credentials"/);
  assert.match(html,/<meta name="robots" content="noindex, nofollow"/);
  const manifest=JSON.parse(await readFile(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/','app launch keeps the existing authenticated entrypoint');
  assert.equal(manifest.scope,'/');
  for(const icon of manifest.icons)assert.ok((await readFile(new URL('../public'+icon.src,import.meta.url))).length>0);
});
