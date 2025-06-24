// test_app.js
// Script de vérification basique de fonctionnement et sécurité pour votre app Node.js (compatible ES module)

import http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';

const BASE_URL = 'http://localhost:3000'; // Modifiez le port si besoin
const execAsync = promisify(exec);

function testUrl(path, expect200 = true) {
  return new Promise((resolve) => {
    http.get(BASE_URL + path, (res) => {
      const ok = expect200 ? res.statusCode === 200 : res.statusCode !== 200;
      resolve({ path, status: res.statusCode, ok });
    }).on('error', (e) => {
      resolve({ path, status: 'ERR', ok: false });
    });
  });
}

async function runTests() {
  console.log('--- TEST FONCTIONNEMENT ---');
  const main = await testUrl('/');
  console.log(`Page d'accueil: ${main.status} ${main.ok ? 'OK' : 'ECHEC'}`);

  console.log('\n--- TEST FICHIERS SENSIBLES ---');
  const sensitive = await Promise.all([
    testUrl('/config.js', false),
    testUrl('/server.mjs', false),
    testUrl('/logs/log.txt', false),
  ]);
  sensitive.forEach(r => {
    console.log(`${r.path}: ${r.status} ${r.ok ? 'NON accessible' : 'ATTENTION accessible !'}`);
  });

  console.log('\n--- TEST XSS BASIQUE ---');
  // Ce test suppose un formulaire à / (à adapter selon votre app)
  const xssPayload = encodeURIComponent('<script>alert(1)</script>');
  const xssTest = await testUrl('/?test=' + xssPayload);
  console.log(`Injection XSS (GET): ${xssTest.status} (vérifiez manuellement si le script s'exécute dans la page)`);

  console.log('\n--- AUDIT DES DEPENDANCES ---');
  try {
    const { stdout } = await execAsync('npm audit --json');
    const audit = JSON.parse(stdout);
    if (audit.metadata && audit.metadata.vulnerabilities) {
      console.log('Vulnérabilités trouvées:', audit.metadata.vulnerabilities);
    } else {
      console.log('Audit terminé, pas de vulnérabilités critiques.');
    }
  } catch (e) {
    console.log('Erreur audit:', e.message);
  }
}

runTests();
