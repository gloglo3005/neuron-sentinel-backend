// test-connection.js
require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function testConnection() {
  try {
    await client.connect();
    console.log('✅ Connexion réussie à Neon');

    const res = await client.query('SELECT NOW() as heure_actuelle, version() as version_pg');
    console.log('🕒 Heure serveur :', res.rows[0].heure_actuelle);
    console.log('🐘 Version Postgres :', res.rows[0].version_pg);
  } catch (err) {
    console.error('❌ Erreur de connexion :', err.message);
  } finally {
    await client.end();
  }
}

testConnection();