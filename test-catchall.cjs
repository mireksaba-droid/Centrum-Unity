const express = require('express');
const app = express();
app.get('*all', (req, res) => res.send('caught by *all'));
app.use((req, res) => res.status(404).send('Not Found'));
const server = app.listen(3002, () => {
  fetch('http://localhost:3002/login')
    .then(r => r.text())
    .then(text => {
      console.log('Response for /login:', text);
      server.close();
    }).catch(e => {
      console.error(e);
      server.close();
    });
});
