// Usage: node scripts/hash-password.js "your-chosen-password"
// Paste the output into ADMIN_PASSWORD_HASH in your environment variables.
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js "your-password"');
  process.exit(1);
}

bcrypt.hash(password, 12).then(hash => {
  console.log('\nAdd this to your environment variables as ADMIN_PASSWORD_HASH:\n');
  console.log(hash);
  console.log('');
});
