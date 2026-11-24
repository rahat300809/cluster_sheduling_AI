// Script to create Firebase Auth user
// Usage: node create_user.js

const https = require('https');

const API_KEY = 'AIzaSyC8O63raCiKZ7DybrX4_24ZDIUyjBOsfYM';
const EMAIL = 'rahat3008096081@gmail.com';
const PASSWORD = '12345678'; // Firebase requires min 6 chars, using 12345678

// ⚠️  NOTE: Firebase requires minimum 6 characters for password.
//    The user requested "1234" but we'll use "12341234" to satisfy Firebase's requirement.
//    Change PASSWORD above if you want a different password.

const data = JSON.stringify({
  email: EMAIL,
  password: PASSWORD,
  returnSecureToken: true,
});

const options = {
  hostname: 'identitytoolkit.googleapis.com',
  path: `/v1/accounts:signUp?key=${API_KEY}`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  },
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    const result = JSON.parse(body);
    if (result.error) {
      if (result.error.message === 'EMAIL_EXISTS') {
        console.log('✅ User already exists! You can sign in with:');
        console.log(`   Email:    ${EMAIL}`);
        console.log(`   Password: ${PASSWORD}`);
      } else {
        console.error('❌ Error:', result.error.message);
      }
    } else {
      console.log('✅ User created successfully!');
      console.log(`   Email:    ${EMAIL}`);
      console.log(`   Password: ${PASSWORD}`);
      console.log(`   UID:      ${result.localId}`);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request error:', e.message);
});

req.write(data);
req.end();
