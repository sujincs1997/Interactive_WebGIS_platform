// test_forgotPassword.js
const fetch = require('node-fetch');
const email = 'testuser@example.com';
// Use IPv4 loopback to avoid IPv6 binding issues
const url = 'http://127.0.0.1:5003/api/auth/forgot-password';

(async () => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await response.json();
    console.log('Response:', data);
  } catch (err) {
    console.error('Error:', err);
  }
})();
