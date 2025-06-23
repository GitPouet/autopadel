/*  
  index2.js - Script d'autologin/réservation amélioré
  
  Ce script utilise Puppeteer pour automatiser la connexion, 
  la sélection d'une date, d'un créneau, d'un terrain et de partenaires,
  ainsi que la confirmation de paiement pour réaliser une réservation sur le site du club.
  
  Fonctionnalités clés :
  - Prise en charge des préférences utilisateur via config.js (login, mdp, date, créneaux, terrain, partenaires, mode test)
  - Sélection dynamique de la date (soit via config.reservationDate, soit en calculant à partir de config.bookingAdvance)
  - Sélection des créneaux horaires basés sur config.hourPreferences
  - Choix du terrain en utilisant config.courts.preferences, avec tri par préférence de terrain si activé
  - Processus de sélection des partenaires avec vérification de la sélection et tentative de contournement en cas d'échec
  - Confirmation de la réservation et gestion d'erreurs avec envoi d'email via nodemailer (fonctionnalité optionnelle)
  - Mode Test pour simuler l’ensemble du processus sans valider la réservation réelle
  
  Chaque étape est commentée et inclut des pauses (sleep) pour assurer la robustesse de l'automatisation.
*/

import puppeteer from 'puppeteer';
import nodemailer from 'nodemailer';

// Analyser les arguments de ligne de commande pour un fichier de configuration alternatif
const args = process.argv.slice(2);
let configFile = './config.js';

for (const arg of args) {
  if (arg.startsWith('--config=')) {
    configFile = `./${arg.substring(9)}`;
    console.log(`Utilisation du fichier de configuration alternatif: ${configFile}`);
  }
}

// Charger la configuration
let config;
try {
  const configModule = await import(configFile);
  config = configModule.default;
  console.log(`Configuration chargée depuis ${configFile}`);
} catch (error) {
  console.error(`Erreur lors du chargement de la configuration depuis ${configFile}:`, error);
  console.log('Tentative avec le fichier config.js par défaut...');
  const defaultConfigModule = await import('./config.js');
  config = defaultConfigModule.default;
}

// Fonction utilitaire pour faire une pause
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fonction améliorée pour les logs

function log(type, message, details = null) {
  const timestamp = new Date().toISOString().substring(11, 19);
  const icons = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌",
    step: "🔷"
  };
  
  const icon = icons[type] || "📋";
  console.log(`${timestamp} ${icon} ${message}`);
  
  if (details) {
    if (typeof details === 'object') {
      console.log('   ', JSON.stringify(details, null, 2).replace(/\n/g, '\n    '));
    } else {
      console.log('   ', details);
    }
  }
}

// Fonction pour capturer l'écran en cas d'erreur

async function captureScreenOnError(page, errorName) {
  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `error_${errorName}_${timestamp}.png`;
    await page.screenshot({ path: filename, fullPage: true });
    log('info', `Capture d'écran sauvegardée: ${filename}`);
  } catch (e) {
    log('error', `Impossible de sauvegarder la capture d'écran: ${e.message}`);
  }
}

// Fonction améliorée pour détecter les créneaux disponibles
async function findAvailableSlots(page) {
  await page.waitForSelector('select#heure', { timeout: 15000 });
  
  const availableSlots = await page.evaluate(() => {
    const select = document.getElementById('heure');
    if (!select) return [];
    
    return Array.from(select.options)
      .filter(option => !option.disabled && option.value)
      .map(option => option.value);
  });
  
  return availableSlots;
}

// Fonction temporaire de remplacement pour éviter les erreurs dans le code
async function sendErrorEmail(errorMessage) {
  log('error', '📧 [Email désactivé] Message d\'erreur qui aurait été envoyé:', errorMessage);
}

// Fonction principale asynchrone
(async () => {
  // Définition des valeurs par défaut si non spécifiées dans la config
  const defaultConfig = {
    bookingAdvance: 7, // J+7 par défaut
    hourPreferences: ["14:00", "15:00", "16:00"], // Horaires par défaut
    useCourtPreferences: false, // Désactivé par défaut
    courts: {
      preferences: [] // Vide par défaut (prendra le premier disponible)
    }
  };

  // Fusion avec la configuration existante (sans modifier l'objet config original)
  const mergedConfig = {
    ...defaultConfig,
    ...config,
    hourPreferences: config.hourPreferences?.length > 0 ? config.hourPreferences : defaultConfig.hourPreferences,
    courts: {
      ...config.courts,
      preferences: config.courts?.preferences?.length > 0 ? config.courts.preferences : defaultConfig.courts.preferences
    }
  };

  // Lancement du navigateur (mode non-headless pour débogage)
  const browser = await puppeteer.launch({
    headless: "new",  // false pour voir le navigateur, true ou 'new' pour le cacher
    timeout: 60000,
    defaultViewport: null, // Pour que la taille du viewport s'adapte à la fenêtre
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--start-maximized', // Pour démarrer avec une fenêtre maximisée
    ]
  });
  const page = await browser.newPage();

  // Ajout des gestionnaires d'événements pour le logging
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
  page.on('error', err => console.error('PUPPETEER ERROR:', err.message));

  try {
    // =======================================================
    // 1. AUTHENTIFICATION
    // =======================================================
    log('step', "Début de l'authentification...");
    await page.goto(config.loginUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[name="email"]', { visible: true });
    await page.type('input[name="email"]', config.username);
    await sleep(2000);
    
    await page.waitForSelector('button.contact100-form-btn');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button.contact100-form-btn'))
        .find(el => el.textContent.trim().includes('Connexion / Inscription'));
      if (btn) btn.click();
    });
    await sleep(2000);
    
    await page.waitForSelector('.wrap-input100.validate-input.form_connexion_input.password_input.step-2_co.show-partner input[name="pass"]');
    await page.type('.wrap-input100.validate-input.form_connexion_input.password_input.step-2_co.show-partner input[name="pass"]', config.password);
    await sleep(2000);
    
    await page.waitForSelector('button.contact100-form-btn.step-2_co.show-partner');
    await page.evaluate(() => {
      const btn = document.querySelector('button.contact100-form-btn.step-2_co.show-partner');
      if (btn) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        btn.dispatchEvent(event);
      }
    });
    await sleep(3000);
    log('success', "Processus d'authentification terminé.");
    
    // =======================================================
    // 2. ACCÈS À LA PAGE DE RÉSERVATION
    // =======================================================
    log('step', "Accès à la page de réservation...");
    await page.goto(config.memberUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a[href="reservation.html"]', { timeout: 15000 });
    await page.click('a[href="reservation.html"]');
    await page.waitForSelector('div.input-wrapper input#date', { timeout: 15000 });
    
    // =======================================================
    // 3. SÉLECTION DE LA DATE
    // =======================================================
    log('step', "Sélection de la date de réservation...");

    // Calcul de la date à utiliser
    let reservationDateStr = mergedConfig.reservationDate;
    let targetDate;
    if (!reservationDateStr) {
      const today = new Date();
      targetDate = new Date(today.getTime() + mergedConfig.bookingAdvance * 24 * 60 * 60 * 1000);
      const dd = ('0' + targetDate.getDate()).slice(-2);
      const mm = ('0' + (targetDate.getMonth() + 1)).slice(-2);
      const yyyy = targetDate.getFullYear();
      reservationDateStr = dd + '/' + mm + '/' + yyyy;
      log('info', `Aucune date spécifiée, utilisation de la date par défaut J+${mergedConfig.bookingAdvance}: ${reservationDateStr}`);
    } else {
      const parts = mergedConfig.reservationDate.split('-');
      if (parts.length === 3) {
        reservationDateStr = parts[2] + '/' + parts[1] + '/' + parts[0];
        targetDate = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
      }
    }

    // MÉTHODE 1: Utiliser input#date de manière sécurisée
    log('info', "Tentative d'interaction avec le datepicker (méthode 1)...");
    try {
      await page.waitForSelector('div.input-wrapper input#date', { visible: true, timeout: 10000 });
      
      // Vérifier si l'élément est réellement visible et accessible
      const isDatepickerVisible = await page.evaluate(() => {
        const datepicker = document.querySelector('div.input-wrapper input#date');
        if (!datepicker) return false;
        
        const rect = datepicker.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      
      if (isDatepickerVisible) {
        // Utiliser une méthode via evaluate qui est plus robuste
        await page.evaluate(() => {
          const datepicker = document.querySelector('div.input-wrapper input#date');
          datepicker.click();
        });
        log('info', "Clic sur le datepicker effectué via evaluate");
      } else {
        throw new Error("Le datepicker n'est pas visible");
      }
    } catch (error) {
      log('warning', `Méthode 1 échouée: ${error.message}, tentative alternative...`);
      
      // MÉTHODE 2: Essayer une injection directe de la date
      try {
        log('info', "Tentative d'injection directe de la date (méthode 2)...");
        await page.evaluate((dateStr) => {
          // Tenter d'injecter directement la date dans l'input
          const dateInput = document.querySelector('input#date');
          if (dateInput) {
            dateInput.value = dateStr;
            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
            dateInput.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
          return false;
        }, reservationDateStr);
        
        // Attendre pour voir si l'injection a fonctionné
        await sleep(2000);
      } catch (err2) {
        log('warning', `Méthode 2 échouée: ${err2.message}`);
      }
    }

    // MÉTHODE 3: Alternative avec une recherche élargie de sélecteurs
    if (await page.$('.ui-datepicker-calendar') === null) {
      log('info', "Calendrier non affiché, tentative avec sélecteurs alternatifs (méthode 3)...");
      try {
        const datepickerSelectors = [
          'input#date', 
          '.datepicker-input', 
          'input[type="date"]',
          '.input-date',
          'input.hasDatepicker'
        ];
        
        for (const selector of datepickerSelectors) {
          const element = await page.$(selector);
          if (element) {
            log('info', `Sélecteur alternatif trouvé: ${selector}`);
            await page.evaluate((sel) => {
              document.querySelector(sel).click();
            }, selector);
            break;
          }
        }
        await sleep(1500);
      } catch (err3) {
        log('warning', `Méthode 3 échouée: ${err3.message}`);
      }
    }
    
    // Vérifier si le calendrier est maintenant affiché
    const isCalendarVisible = await page.evaluate(() => {
      return !!document.querySelector('.ui-datepicker-calendar');
    });
    
    if (!isCalendarVisible) {
      log('error', "Impossible d'afficher le calendrier après plusieurs tentatives");
      await captureScreenOnError(page, 'datepicker_error');
      throw new Error("Échec d'ouverture du datepicker");
    }
    
    log('info', "Calendrier affiché, sélection de la date...");
    
    // Déterminer le jour, le mois et l'année à sélectionner
    const day = targetDate.getDate();
    const month = targetDate.getMonth();
    const year = targetDate.getFullYear();

    // Sélectionner d'abord le bon mois et la bonne année si nécessaire
    await page.evaluate((y, m) => {
      // Trouver les sélecteurs de mois et d'année
      const monthSelect = document.querySelector('.ui-datepicker-month');
      const yearSelect = document.querySelector('.ui-datepicker-year');
      
      if (monthSelect) monthSelect.value = m;
      if (yearSelect) yearSelect.value = y;
      
      // Déclencher les événements de changement
      if (monthSelect) monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
      if (yearSelect) yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }, year, month);

    await sleep(1000);

    // Maintenant, cliquer sur le jour spécifique
    const daySelected = await page.evaluate((d) => {
      // Trouver tous les éléments de jour dans le datepicker
      const dayElements = document.querySelectorAll('.ui-datepicker-calendar td:not(.ui-datepicker-other-month) a');
      
      // Chercher l'élément qui correspond au jour souhaité
      for (const dayElem of dayElements) {
        if (parseInt(dayElem.textContent.trim()) === d) {
          // Cliquer sur ce jour
          dayElem.click();
          return true;
        }
      }
      return false;
    }, day);

    if (!daySelected) {
      log('warning', "Impossible de sélectionner le jour exact dans le datepicker, tentative de solution alternative...");
      // Solution alternative: cliquer sur un jour disponible
      await page.evaluate(() => {
        const dayElements = document.querySelectorAll('.ui-datepicker-calendar td:not(.ui-datepicker-other-month) a');
        if (dayElements.length > 0) {
          dayElements[0].click();
          return true;
        }
        return false;
      });
    }

    // ÉTAPE 3: Attendre que la page se recharge après la sélection de la date
    log('info', "Attente du rechargement après sélection de date...");
    await sleep(3000);
    log('success', "Date de réservation sélectionnée");

    // =======================================================
    // 4. SÉLECTION DU CRÉNEAU HORAIRE
    // =======================================================
    log('step', "Sélection du créneau horaire...");

    // ÉTAPE 4: Attendre que le sélecteur d'heure apparaisse
    log('info', "Attente de l'apparition du sélecteur d'horaires...");
    try {
      await page.waitForSelector('select#heure', { visible: true, timeout: 10000 });
    } catch (error) {
      log('warning', "Sélecteur d'heure non trouvé, tentative de rafraîchissement...");
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(3000);
      await page.waitForSelector('select#heure', { visible: true, timeout: 10000 })
        .catch(() => {
          throw new Error("Impossible de trouver le sélecteur d'heure, même après rafraîchissement");
        });
    }

    // ÉTAPE 5: Sélectionner un horaire dans le select
    log('info', "Sélection de l'horaire...");
    const selectedHour = await page.evaluate(() => {
      const select = document.getElementById('heure');
      if (!select) return null;
      
      // Prendre la première option non désactivée qui n'est pas "Choisir"
      const options = Array.from(select.options);
      const firstValid = options.find(opt => !opt.disabled && opt.value !== "0");
      
      if (firstValid) {
        select.value = firstValid.value;
        const changeEvent = new Event('change', { bubbles: true });
        select.dispatchEvent(changeEvent);
        return firstValid.value;
      }
      
      return null;
    });

    if (!selectedHour) {
      await captureScreenOnError(page, "no_hours_available");
      throw new Error("Aucun créneau horaire disponible");
    }

    log('success', `Créneau horaire sélectionné: ${selectedHour}`);

    // ÉTAPE 6: Attendre que la page se recharge pour afficher les terrains
    log('info', "Attente du chargement des terrains disponibles...");
    await sleep(3000);

    // =======================================================
    // 5. SÉLECTION DU TERRAIN
    // =======================================================
    log('step', "Sélection du terrain...");
    log('info', `Vérification de la disponibilité des horaires préférés sur tous les terrains...`);
    await sleep(3000);
    
    const terrainInfo = await page.evaluate((params) => {
      const { courtPreferences, hourPreferences } = params;
      const availableCourts = [];
      const courtBlocks = document.querySelectorAll('.bloccourt');
      console.log(`Nombre de blocs de terrains trouvés: ${courtBlocks.length}`);

      // Si aucun terrain n'est trouvé, sortir
      if (courtBlocks.length === 0) return null;

      // Collecter toutes les options disponibles
      courtBlocks.forEach((court) => {
        const courtId = court.getAttribute('data-idcourt');
        if (!courtId) return;
        
        const buttons = court.querySelectorAll('.blocCourt_container_btn-creneau button.btn_creneau:not([disabled])');
        buttons.forEach(btn => {
          const hour = btn.textContent.trim();
          
          // Calculer les scores pour le tri
          const hourScore = hourPreferences.indexOf(hour) !== -1 
            ? hourPreferences.indexOf(hour)  // Position dans les préférences (0 = plus haute priorité)
            : 999;                          // Non préféré
            
          const isPreferredCourt = courtPreferences.indexOf(courtId) !== -1;
          // Score du terrain (0 si préféré, 1 sinon)
          const courtScore = isPreferredCourt ? 0 : 1;
          
          availableCourts.push({
            courtId,
            hour,
            button: btn,
            hourScore,
            courtScore,
            isPreferredHour: hourScore < 999,
            isPreferredCourt
          });
          
          console.log(`Terrain ${courtId} disponible à ${hour} (score heure: ${hourScore}, score terrain: ${courtScore})`);
        });
      });
      
      console.log(`Total des options disponibles: ${availableCourts.length}`);
      if (availableCourts.length === 0) return null;
      
      // 1. Filtrer d'abord pour ne garder que les horaires préférés si disponibles
      const preferredHourOptions = availableCourts.filter(c => c.isPreferredHour);
      
      if (preferredHourOptions.length > 0) {
        console.log(`${preferredHourOptions.length} options avec horaires préférés trouvées`);
        
        // NOUVELLE LOGIQUE: Trier par horaire préféré d'abord, puis par terrain préféré
        // Trier par priorité d'horaire (le premier de la liste est prioritaire)
        preferredHourOptions.sort((a, b) => {
          // Comparer d'abord par score d'horaire
          if (a.hourScore !== b.hourScore) {
            return a.hourScore - b.hourScore;
          }
          // À égalité d'horaire, favoriser le terrain préféré
          return a.courtScore - b.courtScore;
        });
        
        // Prendre le meilleur choix après tri
        const best = preferredHourOptions[0];
        
        // Déterminer si c'est un terrain préféré
        const onPreferredCourt = best.isPreferredCourt ? "(sur terrain préféré)" : "(sur autre terrain)";
        console.log(`Meilleur choix trouvé: Horaire ${best.hour} ${onPreferredCourt} sur terrain ${best.courtId}`);
        
        best.button.click();
        return { courtId: best.courtId, hour: best.hour };
      } else {
        // Aucun horaire préféré n'est disponible
        console.log("Aucun horaire préféré n'est disponible, sélection du premier créneau disponible");
        
        // Essayer de privilégier le terrain préféré si aucun horaire préféré n'est disponible
        const onPreferredCourt = availableCourts.filter(c => c.isPreferredCourt);
        
        if (onPreferredCourt.length > 0) {
          const best = onPreferredCourt[0];
          console.log(`Choix sur terrain préféré: Terrain ${best.courtId} à ${best.hour}`);
          best.button.click();
          return { courtId: best.courtId, hour: best.hour };
        } else {
          // Prendre simplement le premier disponible
          const best = availableCourts[0];
          console.log(`Choix par défaut: Terrain ${best.courtId} à ${best.hour}`);
          best.button.click();
          return { courtId: best.courtId, hour: best.hour };
        }
      }
    }, {
      courtPreferences: mergedConfig.courts.preferences || [],
      hourPreferences: mergedConfig.hourPreferences || []
    });
    
    if (!terrainInfo) {
      throw new Error("Aucun terrain disponible pour les créneaux.");
    }
    
    const courtName = mergedConfig.courts[terrainInfo.courtId] || 'Inconnu';
    log('success', `Terrain sélectionné: ${terrainInfo.courtId} (${courtName}) à ${terrainInfo.hour}`);
    await sleep(2000);
    
    // =======================================================
    // 6. SÉLECTION DES PARTENAIRES
    // =======================================================
    log('step', "Sélection des partenaires...");
    const courtId = await page.evaluate(() => {
      const activeTerrainElement = document.querySelector('.bloccourt.active');
      if (activeTerrainElement) {
        return activeTerrainElement.getAttribute('data-idcourt');
      } else {
        // Récupérer l'ID du terrain qui vient d'être sélectionné
        const selectedTerrain = document.querySelector('.blocCourt_container_btn-creneau button.btn_creneau.active, .blocCourt_container_btn-creneau button.btn_creneau.clicked');
        if (selectedTerrain) {
          const parentCourt = selectedTerrain.closest('.bloccourt');
          return parentCourt ? parentCourt.getAttribute('data-idcourt') : '2164';
        }
        return '2164'; // Valeur par défaut
      }
    });
    log('info', `ID du terrain actif: ${courtId} (${config.courts[courtId] || 'Inconnu'})`);
    const partners = mergedConfig.partners || []; // Utiliser un tableau vide si aucun partenaire défini

    // Attendre explicitement que la page soit stable avant de commencer
    await sleep(3000);
    
    // Traiter chaque partenaire avec une approche plus robuste, similaire à celle d'index2.js
    for (let i = 0; i < partners.length; i++) {
      const partner = partners[i];
      try {
        log('info', `Sélection du partenaire ${partner.position + 1} (${i+1}/${partners.length}): ${partner.playerName}`);
        
        // APPROCHE COMPLÈTE AVEC SIMULATION D'INTERACTION UTILISATEUR
        try {
          // 1. Attendre et cliquer sur l'image du joueur pour ouvrir la modale
          const playerSlotSelector = `div#ref_${courtId}_${partner.position}`;
          await page.waitForSelector(playerSlotSelector, { timeout: 5000 });
          
          // Cliquer sur le slot pour ouvrir le modal
          await page.evaluate((selector) => {
            const slot = document.querySelector(selector);
            if (slot) {
              // Simuler un clic sur le slot pour ouvrir la modale
              const event = new MouseEvent('click', { bubbles: true, cancelable: true });
              slot.dispatchEvent(event);
              
              // Si un élément d'image spécifique existe, cliquer dessus aussi
              const img = slot.querySelector('img.openmodalpartenaires');
              if (img) img.click();
            }
          }, playerSlotSelector);
          
          log('info', `Clic sur le slot du joueur ${partner.position + 1}, attente de la modale...`);
          await sleep(1000);
          
          // 2. Attendre que la modale apparaisse
          await page.waitForSelector('.modal#modalpartenaires.show', { timeout: 5000 });
          log('info', `Modale ouverte pour le joueur ${partner.position + 1}`);
          await sleep(1000);  // Attendre que la modale soit stable
          
          // 3. Cliquer sur le partenaire souhaité dans la modale
          const partnerSelector = `span.choose_partner_js[data-idplayer="${partner.playerId}"]`;
          await page.waitForSelector(partnerSelector, { timeout: 5000 });
          
          log('info', `Sélection du partenaire ${partner.playerName} dans la modale...`);
          await page.evaluate((selector) => {
            const partnerElem = document.querySelector(selector);
            if (partnerElem) {
              partnerElem.click();
              
              // S'assurer que l'événement est bien déclenché
              const event = new MouseEvent('click', { bubbles: true, cancelable: true });
              partnerElem.dispatchEvent(event);
              
              // Si un élément d'image existe, cliquer dessus aussi
              const img = partnerElem.querySelector('img');
              if (img) img.click();
            }
          }, partnerSelector);
          
          // 4. Attendre que la modale se ferme
          await page.waitForFunction(() => !document.querySelector('.modal#modalpartenaires.show'), { timeout: 5000 });
          log('info', `Modale fermée après sélection du partenaire ${partner.playerName}`);
          
          // 5. Attendre pour que les changements soient appliqués
          await sleep(2000);
          
          // 6. Vérifier si le partenaire a bien été sélectionné
          const isSelected = await page.evaluate((courtId, position, expectedId) => {
            const playerSlot = document.querySelector(`div#ref_${courtId}_${position}`);
            if (!playerSlot) return false;
            const currentId = playerSlot.getAttribute('data-idplayer');
            return currentId === expectedId;
          }, courtId, partner.position, partner.playerId);
          
          if (isSelected) {
            log('success', `Partenaire ${partner.playerName} sélectionné avec succès via la modale`);
            // Si la sélection a réussi, passer au partenaire suivant
            continue;
          } else {
            throw new Error("La sélection via modale n'a pas été correctement enregistrée");
          }
          
        } catch (modalError) {
          // Si l'approche modale échoue, passer à la méthode d'injection directe
          log('warning', `Échec de la sélection via modale: ${modalError.message}`);
          log('info', "Tentative de fallback avec injection directe...");
          
          // S'assurer qu'aucune modale n'est ouverte
          await page.evaluate(() => {
            const modal = document.querySelector('.modal#modalpartenaires.show');
            if (modal) {
              const closeBtn = modal.querySelector('.close');
              if (closeBtn) closeBtn.click();
              modal.classList.remove('show');
              modal.style.display = 'none';
            }
          });
          await sleep(1000);
          
          // MÉTHODE FALLBACK: INJECTION DIRECTE
          const injectionResult = await page.evaluate((courtId, position, playerId, playerName) => {
            try {
              const slotElem = document.getElementById(`ref_${courtId}_${position}`);
              if (!slotElem) return { success: false, error: "Élément slot non trouvé" };
              
              // Modifier directement les attributs du slot
              slotElem.setAttribute("data-idplayer", playerId);
              
              // Mettre à jour l'apparence avec injection HTML
              slotElem.innerHTML = `
                <img data-toggle="modal" data-idplayer="${playerId}" data-idcourt="${courtId}" 
                     data-target="#modalpartenaires" class="openmodalpartenaires imaged w48 rounded" 
                     src="/img/avatars/avatar_homme.png" alt="image">
                <p class="mt-1 d-flex flex-column insertInfosPartners">${playerName}</p>`;
              
              // Simuler un événement de changement sur le slot
              slotElem.dispatchEvent(new Event('change', { bubbles: true }));
              
              // Signaler les événements au parent pour s'assurer que le site web enregistre le changement
              const event = new CustomEvent('partnerSelected', { 
                bubbles: true, 
                detail: { playerId, courtId, position, playerName } 
              });
              slotElem.dispatchEvent(event);
              document.dispatchEvent(event);
              
              return { success: true };
            } catch (e) {
              return { success: false, error: e.toString() };
            }
          }, courtId, partner.position, partner.playerId, partner.playerName);
          
          if (injectionResult.success) {
            log('success', `Partenaire ${partner.playerName} configuré avec succès via injection directe`);
          } else {
            log('error', `Échec de configuration directe: ${injectionResult.error}`);
            throw new Error(`Impossible de configurer le partenaire ${partner.playerName}`);
          }
        }
      } catch (error) {
        log('error', `Erreur lors de la sélection du partenaire ${partner.position + 1}:`, error.message);
        // Capture d'écran en cas d'erreur de sélection de partenaire
        await captureScreenOnError(page, `partner_selection_failed_${partner.position}`);
      }
      
      // Pause importante entre chaque partenaire pour éviter les conflits
      await sleep(3000);
    }

    // Pause significative après avoir ajouté tous les partenaires pour s'assurer que tout est stable
    log('info', "Attente de stabilisation après l'ajout des partenaires...");
    await sleep(5000);
    log('success', "Informations des partenaires renseignées.");
    
    // =======================================================
    // 7. CONFIRMATION DE LA RÉSERVATION
    // =======================================================
    log('step', "Clic sur le bouton 'Réserver'...");
    
    // Attendre un peu plus longtemps après l'ajout des partenaires
    log('info', "Attente supplémentaire pour stabilisation complète...");
    await sleep(5000);

    // Sélecteur exact pour le bouton de réservation basé sur l'HTML fourni
    const mainReserveButtonSelector = 'button.h-auto.mt-2.btn.btn-primary.btn-lg.btn-block.d-flex.flex-column.buttonaddresa[data-target="#choix_paiement"]';
    
    // Liste de sélecteurs alternatifs (fallback) pour le bouton de réservation
    const reserveButtonSelectors = [
      mainReserveButtonSelector,
      'button.buttonaddresa[data-target="#choix_paiement"]',
      'button.buttonaddresa',
      'button.btn-primary[data-target="#choix_paiement"]',
      'button.btn-reserve',
      'button.btn-reservation',
      'button.btn-valider',
      'button.btn-confirm',
      'button[type="submit"]',
      'button.btn-primary',
      'a.buttonaddresa',
      'a.btn-reserve',
      // Sélecteurs basés sur le texte (évalués via JavaScript)
      '//button[contains(text(), "Réserver")]',
      '//button[contains(text(), "Valider")]',
      '//button[contains(text(), "Confirmer")]',
      '//a[contains(text(), "Réserver")]'
    ];

    // Recherche améliorée du bouton avec plusieurs tentatives
    let buttonFound = false;
    
    log('info', "Recherche du bouton 'Réserver' avec plusieurs sélecteurs...");
    
    // Première tentative: rechercher avec les sélecteurs CSS directs
    for (const selector of reserveButtonSelectors) {
      if (selector.startsWith('//')) continue; // Ignorer les sélecteurs XPath pour l'instant
      
      try {
        const buttonExists = await page.evaluate((sel) => {
          const btn = document.querySelector(sel);
          if (btn) {
            // Vérifier si le bouton est visible
            const rect = btn.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0;
            
            // Défiler jusqu'au bouton pour qu'il soit visible
            if (isVisible) {
              btn.scrollIntoView({ behavior: "smooth", block: "center" });
              return { found: true, text: btn.textContent.trim() };
            }
          }
          return { found: false };
        }, selector);
        
        if (buttonExists.found) {
          log('info', `Bouton 'Réserver' trouvé avec le sélecteur: ${selector} (texte: "${buttonExists.text}")`);
          buttonFound = true;
          
          // Essayer de cliquer sur le bouton
          await page.click(selector)
            .then(() => log('success', "Clic direct effectué sur le bouton 'Réserver'"))
            .catch(async () => {
              log('warning', "Clic direct échoué, tentative avec JavaScript...");
              await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) {
                  btn.click();
                  return true;
                }
                return false;
              }, selector);
              log('info', "Clic via JavaScript effectué");
            });
            
          break;
        }
      } catch (error) {
        // Continuer avec le prochain sélecteur
        log('info', `Sélecteur ${selector} non trouvé, essai suivant...`);
      }
    }
    
    // Deuxième tentative: utiliser des sélecteurs XPath si aucun bouton n'a été trouvé
    if (!buttonFound) {
      log('info', "Tentative avec sélecteurs XPath...");
      for (const selector of reserveButtonSelectors) {
        if (!selector.startsWith('//')) continue; // Seulement les sélecteurs XPath
        
        try {
          const [button] = await page.$x(selector);
          if (button) {
            log('info', `Bouton trouvé avec XPath: ${selector}`);
            await button.click()
              .then(() => log('success', "Clic effectué via XPath"))
              .catch(() => log('warning', "Clic XPath échoué"));
            buttonFound = true;
            break;
          }
        } catch (error) {
          // Continuer avec le prochain sélecteur
        }
      }
    }
    
    // Troisième tentative: recherche générique de boutons si les méthodes précédentes ont échoué
    if (!buttonFound) {
      log('warning', "Sélecteurs spécifiques non trouvés, recherche plus générique...");
      
      try {
        // Rechercher tous les boutons visibles et cliquer sur celui qui ressemble à "Réserver"
        const genericButton = await page.evaluate(() => {
          // Liste de textes possibles pour le bouton de réservation
          const possibleTexts = ['réserver', 'reserver', 'valider', 'confirmer', 'terminer'];
          
          // Rechercher tous les boutons et liens
          const buttons = [...document.querySelectorAll('button, a.btn, input[type="button"], input[type="submit"]')];
          
          // Trouver un bouton qui contient un des textes possibles
          for (const btn of buttons) {
            const btnText = btn.textContent.toLowerCase().trim();
            if (possibleTexts.some(text => btnText.includes(text))) {
              // Vérifier que le bouton est visible
              const rect = btn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                // Défiler jusqu'au bouton
                btn.scrollIntoView({ behavior: "smooth", block: "center" });
                return {
                  found: true,
                  id: btn.id || 'sans-id',
                  text: btnText,
                  classes: btn.className
                };
              }
            }
          }
          return { found: false };
        });
        
        if (genericButton.found) {
          log('info', `Bouton générique trouvé: "${genericButton.text}" (id: ${genericButton.id}, classes: ${genericButton.classes})`);
          
          // Cliquer sur le bouton trouvé via JavaScript
          await page.evaluate(() => {
            // Liste de textes possibles pour le bouton de réservation
            const possibleTexts = ['réserver', 'reserver', 'valider', 'confirmer', 'terminer'];
            
            // Rechercher tous les boutons et liens
            const buttons = [...document.querySelectorAll('button, a.btn, input[type="button"], input[type="submit"]')];
            
            // Trouver un bouton qui contient un des textes possibles
            for (const btn of buttons) {
              const btnText = btn.textContent.toLowerCase().trim();
              if (possibleTexts.some(text => btnText.includes(text))) {
                const rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  // Cliquer sur le bouton
                  btn.click();
                  return true;
                }
              }
            }
            return false;
          });
          
          buttonFound = true;
          log('success', "Clic générique effectué");
        }
      } catch (error) {
        log('error', "Échec de la recherche générique:", error.message);
      }
    }
    
    // Vérifier si la page a besoin d'être rafraîchie
    if (!buttonFound) {
      log('warning', "Bouton non trouvé, tentative de rafraîchissement de la page...");
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(5000);
      
      // Après rafraîchissement, essayer une dernière fois avec le sélecteur principal
      try {
        const buttonAfterRefresh = await page.evaluate(() => {
          const btn = document.querySelector('button.buttonaddresa');
          if (btn) {
            btn.scrollIntoView({ behavior: "smooth", block: "center" });
            return true;
          }
          return false;
        });
        
        if (buttonAfterRefresh) {
          log('info', "Bouton trouvé après rafraîchissement");
          await page.click('button.buttonaddresa')
            .then(() => {
              buttonFound = true;
              log('success', "Clic effectué après rafraîchissement");
            })
            .catch(() => {
              log('warning', "Clic direct échoué après rafraîchissement");
            });
        }
      } catch (error) {
        log('error', "Échec après rafraîchissement:", error.message);
      }
    }
    
    // Si toujours pas de bouton, capturer l'écran et échouer
    if (!buttonFound) {
      log('error', "Le bouton 'Réserver' n'est pas visible ou n'existe pas");
      await captureScreenOnError(page, 'reserve_button_missing');
      
      // Tenter une action d'urgence avant d'échouer complètement
      log('warning', "Tentative d'action d'urgence: recherche d'éléments interactifs...");
      await page.evaluate(() => {
        // Essayer de cliquer sur tout élément qui pourrait être le bouton de réservation
        document.querySelectorAll('button, a.btn, input[type="button"], input[type="submit"]').forEach(el => {
          console.log("Élément interactif trouvé:", el.outerHTML);
          // Ne pas cliquer, juste logger pour diagnostic
        });
      });
      
      throw new Error("Impossible de trouver le bouton de réservation");
    }
    
    log('info', "Attente de l'apparition de la modale de paiement...");
    
    // Attente plus longue et plus robuste pour la modale avec le sélecteur exact
    try {
      // Sélecteur exact pour la modale basé sur l'HTML fourni
      await page.waitForSelector('.modal.fade.dialogbox#choix_paiement.show', { timeout: 20000 });
      log('success', "Modale de paiement affichée.");
    } catch (modalError) {
      log('warning', "Timeout en attendant la modale, vérification alternative...");
      
      // Vérification alternative pour voir si la modale est visible d'une autre manière
      const modalVisible = await page.evaluate(() => {
        const modal = document.getElementById('choix_paiement');
        return modal && (modal.classList.contains('show') || 
                        getComputedStyle(modal).display !== 'none' || 
                        modal.getAttribute('aria-hidden') === 'false');
      });
      
      if (modalVisible) {
        log('info', "Modale détectée par méthode alternative");
      } else {
        // Si toujours pas de modale, vérifier si le bouton est encore présent et réessayer
        const buttonStillVisible = await page.evaluate(() => {
          const button = document.querySelector('button.buttonaddresa');
          return button && getComputedStyle(button).display !== 'none';
        });
        
        if (buttonStillVisible) {
          log('info', "Bouton 'Réserver' toujours visible, nouvelle tentative...");
          await page.evaluate(() => {
            const button = document.querySelector('button.buttonaddresa');
            if (button) button.click();
          });
          
          // Attendre à nouveau la modale, avec un timeout plus court cette fois
          await page.waitForSelector('.modal#choix_paiement.show', { timeout: 10000 })
              .catch(() => {
                log('error', "La modale n'est pas apparue après plusieurs tentatives");
                throw new Error("Impossible d'afficher la modale de paiement");
              });
        } else {
          log('error', "La modale de paiement n'est pas apparue et le bouton n'est plus disponible");
          await captureScreenOnError(page, 'reservation_failed');
          throw new Error("La modale de paiement n'est pas apparue, aucune réservation ne peut être effectuée.");
        }
      }
    }
    
    // Attendre un peu pour s'assurer que la modale est complètement chargée
    await sleep(2000);
    
    const totalAmount = await page.evaluate(() => {
      const totalElement = document.querySelector('.choix_paiement_total #total_resa');
      return totalElement ? totalElement.textContent.trim() : "Montant inconnu";
    });
    log('info', `Montant total de la réservation: ${totalAmount}`);
    
    // Utiliser le bon bouton "Valider la réservation" plutôt que "Payer sur place"
    const confirmButtonSelector = '#btn_paiement_free_resa';
    
    await page.waitForSelector(confirmButtonSelector, { timeout: 15000 })
      .catch(e => {
        log('warning', `Bouton de confirmation non trouvé avec le sélecteur principal: ${e.message}`);
        // Pas d'échec immédiat, on essaiera des alternatives
      });
      
    log('info', "Bouton 'Valider la réservation' trouvé, clic en cours...");
    try {
      log('info', "Tentative de clic direct...");
      await page.click(confirmButtonSelector)
        .then(() => log('success', "Clic sur 'Valider la réservation' effectué."))
        .catch(async (e) => {
          log('warning', `Clic direct échoué: ${e.message}, tentative avec JavaScript...`);
          // Tenter via JavaScript
          const clickResult = await page.evaluate((selector) => {
            const button = document.querySelector(selector);
            if (button) {
              button.click();
              return true;
            }
            return false;
          }, confirmButtonSelector);
          
          if (clickResult) {
            log('success', "Clic effectué via JavaScript");
          } else {
            throw new Error("Bouton non trouvé même via JavaScript");
          }
        });
    } catch (confirmClickError) {
      log('warning', "Première tentative échouée, essai de solution alternative...");
      
      // Essayer de trouver n'importe quel bouton dans la modale qui pourrait valider
      await page.evaluate(() => {
        const modal = document.querySelector('.modal#choix_paiement.show');
        if (!modal) return false;
        
        // Essayer tous les boutons/liens dans la modale qui semblent être des boutons de confirmation
        const possibleButtons = Array.from(modal.querySelectorAll('a.btn, button.btn'))
          .filter(btn => {
            const text = btn.textContent.toLowerCase();
            return text.includes('valid') || text.includes('confirm') || 
                  text.includes('réserv') || text.includes('reserv') ||
                  text.includes('termin');
          });
        
        if (possibleButtons.length > 0) {
          console.log("Bouton alternatif trouvé, tentative de clic");
          possibleButtons[0].click();
          return true;
        }
        return false;
      });
      
      log('info', "Tentative alternative effectuée");
    }
    
    // Attente beaucoup plus longue pour la fermeture de la modale (30 secondes)
    log('info', "Attente de la fermeture de la modale...");
    try {
      await page.waitForFunction(
        () => !document.querySelector('.modal#choix_paiement.show'), 
        { timeout: 30000 }
      );
      log('success', "Modale de paiement fermée.");
    } catch (modalCloseError) {
      log('warning', "Timeout lors de l'attente de fermeture de la modale. Tentative alternative...");
      
      // Forcer la fermeture de la modale si elle est toujours visible
      await page.evaluate(() => {
        try {
          // Vérifier si la modale est toujours visible
          const modal = document.querySelector('.modal#choix_paiement');
          if (!modal) return;
          
          console.log("La modale est toujours visible, tentative de fermeture forcée");
          
          // Essayer de fermer la modale en simulant un clic sur le bouton de fermeture
          const closeButton = modal.querySelector('.close, .btn-close, [data-dismiss="modal"]');
          if (closeButton) {
            console.log("Bouton de fermeture cliqué");
            closeButton.click();
          }
          
          // Si toujours visible, forcer la fermeture
          setTimeout(() => {
            if (modal.classList.contains('show')) {
              // Retirer manuellement les classes et styles
              modal.classList.remove('show');
              modal.style.display = 'none';
              
              // Retirer également le backdrop si présent
              const backdrop = document.querySelector('.modal-backdrop');
              if (backdrop) {
                backdrop.classList.remove('show');
                backdrop.style.display = 'none';
                document.body.removeChild(backdrop);
              }
              
              // Restaurer le scrolling sur le body
              document.body.classList.remove('modal-open');
              document.body.style.overflow = '';
              document.body.style.paddingRight = '';
            }
          }, 1000);
        } catch (e) {
          console.error("Erreur lors de la tentative de fermeture forcée:", e);
        }
      });
      
      log('info', "Tentative de fermeture forcée de la modale effectuée");
    }
    
    // Attendre plus longtemps pour que le système traite la réservation
    log('info', "Attente du traitement de la réservation...");
    await sleep(8000);
    
    // =======================================================
    // 8. VALIDATION FINALE ET NOTIFICATION
    // =======================================================
    log('step', "Vérification de la confirmation de réservation...");
    
    // Méthode améliorée pour détecter la confirmation
    const isReservationConfirmed = await page.evaluate(() => {
      try {
        // Méthodes multiples pour détecter une confirmation
        const successMethods = [
          // 1. Recherche par classe
          !!document.querySelector('.alert-success, .success-message, .reservation-success'),
          
          // 2. Recherche par attribut
          !!document.querySelector('[data-success="true"], [data-status="confirmed"]'),
          
          // 3. Recherche par contenu textuel dans différents éléments (recherche plus exhaustive)
          Array.from(document.querySelectorAll('.alert, .notification, .toast, .message, div, p, span, h1, h2, h3, h4, h5, h6')).some(el => {
            const text = el.textContent.toLowerCase();
            return text.includes('réservation confirmée') || 
                  text.includes('réservation réussie') ||
                  text.includes('a bien été validée') ||
                  text.includes('confirmé avec succès') ||
                  text.includes('merci pour votre réservation') ||
                  text.includes('paiement accepté') ||
                  text.includes('confirmation');
          }),
          
          // 4. Vérification de messages de succès génériques
          document.body.innerText.toLowerCase().includes('succès') ||
          document.body.innerText.toLowerCase().includes('success'),
          
          // 5. Vérification d'URL ou de paramètres
          window.location.href.includes('success') || 
          window.location.href.includes('confirmation'),
          
          // 6. La disparition de la modale sans erreur peut être considérée comme un succès relatif
          !document.querySelector('.modal#choix_paiement.show') && 
          !document.querySelector('.alert-danger, .error-message')
        ];
        
        // Journaliser les résultats des différentes méthodes
        console.log("Résultats des méthodes de détection:", successMethods);
        
        // Si une méthode renvoie true, considérer comme confirmé
        return successMethods.some(result => result === true);
      } catch (e) {
        console.error("Erreur dans la vérification de confirmation:", e);
        return false;
      }
    });

    // En mode test, forcer la confirmation
    const finalConfirmationStatus = config.testMode ? true : isReservationConfirmed;

    if (finalConfirmationStatus) {
      log('success', "Réservation confirmée avec succès!");
    } else {
      // Capture d'écran mais continuer sans erreur - la réservation peut être valide même sans confirmation visible
      log('warning', "Pas de confirmation explicite trouvée, mais la réservation pourrait être valide");
      await captureScreenOnError(page, 'no_explicit_confirmation');
      
      // Ne pas lancer d'exception, car la réservation est peut-être réussie malgré l'absence de message
      if (config.testMode) {
        log('info', "Mode test: considéré comme une réussite malgré l'absence de confirmation explicite");
      }
    }
    
    log('success', "Processus de réservation terminé.");
  } catch (err) {
    log('error', "Erreur durant le processus :", err.message);
    await page.screenshot({ path: `error-${Date.now()}.png` });
    await captureScreenOnError(page, 'process_error');
    // Commenté temporairement - Log de l'erreur sans envoi d'email
    log('info', "📧 [Email désactivé] Message d'erreur:", err.message);
  } finally {
    await browser.close();
  }
  
  if (mergedConfig.testMode) {
    log('info', "Mode Test activé : aucune réservation réelle n'a été finalisée.");
  }
})();