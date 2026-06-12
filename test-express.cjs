const express = require('express');
const app = express();
try {
  app.get('*all', (req, res)=>res.send('hi'));
  console.log('*all works');
} catch (e) {
  console.log('*all error:', e.message);
}
try {
  app.get('*', (req, res)=>res.send('hi'));
  console.log('* works');
} catch (e) {
  console.log('* error:', e.message);
}
try {
  app.get('(.*)', (req, res)=>res.send('hi'));
  console.log('(.*) works');
} catch (e) {
  console.log('(.*) error:', e.message);
}
try {
  app.get('/*', (req, res)=>res.send('hi'));
  console.log('/* works');
} catch (e) {
  console.log('/* error:', e.message);
}
