import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import schedule from 'node-schedule';
import cors from 'cors';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000; // Changer 3000 par un autre port (3001, 3002, 8080, etc.)

// File d'exécution pour garantir qu'un seul script index.mjs tourne à la fois
const JOB_DELAY_BETWEEN_RUNS = 500; // ms entre deux exécutions pour laisser le système respirer
let executionQueue = Promise.resolve();

function enqueueRun(configFileName, contextDescription = '') {
  executionQueue = executionQueue
    .catch((error) => {
      console.error('Erreur précédente dans la file d\'exécution:', error);
    })
    .then(() => runQueuedJob(configFileName, contextDescription));

  return executionQueue;
}

function runQueuedJob(configFileName, contextDescription) {
  return new Promise((resolve) => {
    const args = [path.resolve(__dirname, 'index.mjs')];
    if (configFileName) {
      args.push(`--config=${configFileName}`);
    }

    const child = spawn('node', args, {
      stdio: 'inherit',
      env: { ...process.env, NODE_PATH: process.cwd() }
    });

    const contextInfo = contextDescription ? ` (${contextDescription})` : '';
    const configInfo = configFileName || 'config par défaut';
    let finished = false;

    const finalize = () => {
      if (finished) return;
      finished = true;
      setTimeout(resolve, JOB_DELAY_BETWEEN_RUNS);
    };

    child.on('error', (error) => {
      console.error(`Erreur lors du lancement de index.mjs${contextInfo} [${configInfo}]:`, error);
      finalize();
    });

    child.on('close', (code, signal) => {
      const exitLabel = signal ? `signal ${signal}` : `code ${code}`;
      console.log(`index.mjs${contextInfo} terminé avec ${exitLabel} [${configInfo}]`);
      finalize();
    });
  });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Gestion des erreurs globales
process.on('uncaughtException', (err) => {
  console.error('Erreur non gérée:', err);
  // Éventuellement notifier par email
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promesse non gérée:', reason);
});

// Fonction utilitaire pour échapper les chaînes sûrement
function escapeJSString(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

app.post('/start', (req, res) => {
  try {
    // S'assurer que req.body existe
    if (!req.body) {
      return res.status(400).json({ message: 'Aucune donnée reçue' });
    }

    // Destructurer les données avec des valeurs par défaut
    const {
      username = '',
      password = '',
      preferredCourt = '',
      dateMethod = 'specific',
      reservationDate = '',
      multipleDates = [],
      preferredHour1 = '',
      preferredHour2 = '',
      preferredHour3 = '',
      testMode = false
    } = req.body;

    // Vérification supplémentaire pour éviter les opérations sur undefined
    if (!username || !password) {
      return res.status(400).json({ message: 'Identifiants manquants' });
    }

    // Vérification immédiate des données essentielles
    console.log("Données reçues:", { 
      username: username || 'non défini', 
      preferredCourt: preferredCourt || 'non défini', 
      dateMethod,
      reservationDate: reservationDate || 'non défini',
      multipleDates: multipleDates.length > 0 ? `${multipleDates.length} dates` : 'aucune',
      testMode: testMode || false
    });
    
    // Construire un tableau d'horaires préférés avec une protection robuste
    const rawHours = [];
    if (preferredHour1) rawHours.push(preferredHour1);
    if (preferredHour2) rawHours.push(preferredHour2);
    if (preferredHour3) rawHours.push(preferredHour3);
    
    const hourPreferences = rawHours
      .filter(hour => hour !== undefined && hour !== null && hour !== '') 
      .map(hour => typeof hour === 'string' ? hour.trim() : String(hour));

    console.log("Préférences d'horaires formatées:", hourPreferences);

    // Construire l'objet de configuration de base
    const baseConfigObject = {
      loginUrl: 'https://centralsportclub.gestion-sports.com/connexion.php?',
      memberUrl: 'https://centralsportclub.gestion-sports.com/membre/',
      username: username,
      password: password,
      useCourtPreferences: Boolean(preferredCourt && preferredCourt !== ''),
      courts: {
        '1455': 'ADN Family',
        '1456': 'Agence Donibane',
        '1692': 'AU P\'TIT DOLMEN crêperie',
        '2164': 'Médiaclinic',
        preferences: preferredCourt && preferredCourt !== '' ? [preferredCourt] : []
      },
      partners: [
        { position: 0, playerId: "148146", playerName: "Joueur INVITE1" },
        { position: 1, playerId: "148147", playerName: "Joueur INVITE2" },
        { position: 2, playerId: "148148", playerName: "Joueur INVITE3" }
      ],
      testMode: Boolean(testMode === true || testMode === 'true')
    };

    // Traiter selon la méthode choisie
    if (dateMethod === 'specific' && reservationDate) {
      // Option 1: Date spécifique (lancement 7 jours avant)
      try {
        const targetDate = new Date(reservationDate);
        // Calculer 7 jours avant
        const executionDate = new Date(targetDate);
        executionDate.setDate(executionDate.getDate() - 7);
        executionDate.setHours(0, 1, 0, 0); // Minuit et 1 minute
        
        if (executionDate < new Date()) {
          // Si la date d'exécution est déjà passée, prévoir à 5 secondes dans le futur
          executionDate.setTime(Date.now() + 5000);
        }
        
        const configObject = {
          ...baseConfigObject,
          hourPreferences: hourPreferences,
          reservationDate: reservationDate,
          bookingAdvance: 0
        };
        
        writeConfigAndSchedule(configObject, executionDate, testMode, res);
      } catch(e) {
        console.error("Erreur lors du traitement de la date:", e);
        return res.status(400).json({ message: `Format de date incorrect: ${e.message}` });
      }
    }
    else if (dateMethod === 'multiple' && Array.isArray(multipleDates) && multipleDates.length > 0) {
      // Option 2: Dates multiples avec horaires spécifiques
      const scheduledDates = [];
      multipleDates.sort((a, b) => a.date.localeCompare(b.date));
      multipleDates.forEach((dateItem) => {
        try {
          const dateStr = dateItem.date;
          const dateHours = Array.isArray(dateItem.hours) ? dateItem.hours : [];
          if (!dateStr || dateHours.length === 0) {
            console.warn(`Date ${dateStr} ignorée: format incorrect ou horaires manquants`);
            return;
          }
          // Correction: conversion robuste de la date (YYYY-MM-DD ou DD/MM/YYYY)
          let targetDate;
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            // Format YYYY-MM-DD
            targetDate = new Date(dateStr);
          } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
            // Format DD/MM/YYYY
            const [d, m, y] = dateStr.split('/');
            targetDate = new Date(`${y}-${m}-${d}`);
          } else {
            throw new Error('Format de date non reconnu: ' + dateStr);
          }
          // Ajout log de debug
          console.log(`[DEBUG] dateStr: ${dateStr}, targetDate:`, targetDate, 'isNaN:', isNaN(targetDate.getTime()));
          if (isNaN(targetDate.getTime())) {
            throw new Error('Date invalide après parsing: ' + dateStr);
          }
          // Calculer 7 jours avant
          const executionDate = new Date(targetDate);
          executionDate.setDate(executionDate.getDate() - 7);
          executionDate.setHours(0, 1, 0, 0);
          if (executionDate < new Date()) {
            executionDate.setTime(Date.now() + 5000);
          }
          const configObject = {
            ...baseConfigObject,
            hourPreferences: dateHours,
            reservationDate: dateStr,
            bookingAdvance: 0
          };
          // Générer un nom de fichier unique basé sur la date
          const configFileName = `config_${dateStr.replace(/-/g, '')}.js`;
          const configPath = path.resolve(__dirname, configFileName);
          const configContent = `// ${configFileName}\nexport default ${JSON.stringify(configObject, null, 2)};`;
          fs.writeFileSync(configPath, configContent, 'utf8');
          scheduledDates.push({
            date: dateStr,
            executionDate: executionDate.toLocaleString(),
            hours: dateHours
          });
          // Correction: lancer le script pour CHAQUE date en mode test
          if (testMode) {
            console.log(`Mode test activé, exécution immédiate pour ${dateStr} avec horaires ${dateHours.join(', ')}...`);
            enqueueRun(configFileName, `test ${dateStr}`);
          } else {
            // Programmation avec node-schedule
            schedule.scheduleJob(executionDate, function() {
              console.log(`Exécution planifiée pour ${dateStr} démarrée à ${new Date().toLocaleString()}`);
              enqueueRun(configFileName, `planifié ${dateStr}`);
            });
          }
        } catch(e) {
          console.error(`Erreur lors du traitement de la date ${dateItem.date}:`, e);
        }
      });
      
      // Écrire également la configuration standard pour la compatibilité
      const firstDate = multipleDates[0];
      const configObject = {
        ...baseConfigObject,
        hourPreferences: firstDate && firstDate.hours ? firstDate.hours : hourPreferences,
        reservationDate: firstDate ? firstDate.date : '',
        bookingAdvance: 0
      };
      
      const configPath = path.resolve(__dirname, 'config.js');
      const configContent = `// config.js\nexport default ${JSON.stringify(configObject, null, 2)};`;
      fs.writeFileSync(configPath, configContent, 'utf8');
      
      let message = "";
      if (testMode) {
        message = `${scheduledDates.length} réservation(s) programmée(s). Mode test activé pour la première date.`;
      } else {
        message = `${scheduledDates.length} réservation(s) programmée(s) pour exécution automatique 7 jours avant chaque date à minuit.`;
      }
      
      return res.json({ 
        message: message,
        scheduledDates: scheduledDates
      });
    } 
    else {
      return res.status(400).json({ message: 'Méthode de date invalide ou données manquantes' });
    }
  } catch (error) {
    console.error('Erreur détaillée:', error);
    
    // Créer une réponse d'erreur plus détaillée
    let errorMessage;
    if (error.message.includes("split")) {
      errorMessage = "Erreur de format des données (problème avec la date ou les horaires)";
    } else {
      errorMessage = `Erreur de configuration: ${error.message}`;
    }
    
    return res.status(500).json({ 
      message: errorMessage,
      details: error.toString(),
      stack: error.stack
    });
  }
});

// Fonction utilitaire pour écrire la configuration et programmer l'exécution
function writeConfigAndSchedule(configObject, executionTime, testMode, res) {
  const configPath = path.resolve(__dirname, 'config.js');
  const configContent = `// config.js
export default ${JSON.stringify(configObject, null, 2)};`;

  // Écrire le fichier de configuration
  fs.writeFileSync(configPath, configContent, 'utf8');
  console.log('config.js mis à jour avec succès.');
  console.log(`Script programmé pour exécution le: ${executionTime.toLocaleString()}`);
  
  // Option pour lancer immédiatement en mode test
  if (testMode) {
    console.log("Mode test activé, exécution immédiate...");
    enqueueRun(undefined, 'mode test immédiat');

    return res.json({ message: `Script lancé en mode test. Vérifiez la console pour les détails.` });
  } else {
    // Programmation avec node-schedule
    schedule.scheduleJob(executionTime, function() {
      console.log(`Exécution planifiée démarrée à ${new Date().toLocaleString()}`);
      enqueueRun(undefined, `planifié ${configObject.reservationDate}`);
    });
    
    let message = "";
    const targetDate = new Date(configObject.reservationDate);
    const formattedDate = `${targetDate.getDate().toString().padStart(2, '0')}/${(targetDate.getMonth()+1).toString().padStart(2, '0')}/${targetDate.getFullYear()}`;
    message = `Réservation programmée pour le ${formattedDate}.<br>L'exécution se déclenchera automatiquement le ${executionTime.toLocaleString()} (7 jours avant).`;
    
    return res.json({ 
      message: message,
      scheduledDates: [{
        date: configObject.reservationDate,
        executionDate: executionTime.toLocaleString(),
        hours: configObject.hourPreferences
      }]
    });
  }
}

// Dans server.cjs, ajouter une fonction de nettoyage périodique
function cleanupTempFiles() {
  try {
    const tempFiles = fs.readdirSync(__dirname).filter(f => 
      f.startsWith('config_') || f.startsWith('error_')
    );
    
    tempFiles.forEach(file => {
      try {
        const stats = fs.statSync(path.join(__dirname, file));
        const fileAge = (new Date() - stats.mtime) / 1000 / 60 / 60; // en heures
        
        if (fileAge > 24) { // Supprime les fichiers de plus de 24h
          fs.unlinkSync(path.join(__dirname, file));
          console.log(`Fichier temporaire nettoyé: ${file}`);
        }
      } catch (fileError) {
        console.error(`Erreur lors du traitement du fichier ${file}:`, fileError);
      }
    });
  } catch (error) {
    console.error('Erreur lors du nettoyage des fichiers temporaires:', error);
  }
}

// Exécuter tous les jours à minuit
schedule.scheduleJob('0 0 * * *', cleanupTempFiles);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
}).on('error', function(err) {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} déjà utilisé, tentative sur le port ${PORT+1}`);
    app.listen(PORT+1, () => {
      console.log(`Server running at http://localhost:${PORT+1}`);
    });
  } else {
    console.error('Erreur lors du démarrage du serveur:', err);
  }
});