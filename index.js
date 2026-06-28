require('dotenv').config();
const { startBot } = require('./src/bot');

console.log(`
╔══════════════════════════════════════╗
║   🎩  ChapeauNoir WhatsApp Bot       ║
║   👨‍💻  by Mcamara                     ║
║   🔐  Hacking Ethique Assistant      ║
╚══════════════════════════════════════╝
`);

startBot().catch(function(err) {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
